'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import * as api from '@/lib/api';
import FaceRegistrationPanel from '@/components/FaceRegistrationPanel';
import MatchCard from '@/components/MatchCard';
import EmptyState from '@/components/EmptyState';

export default function ProfilePage() {
  const { user, token, ready } = useAuth();
  const router = useRouter();

  const [photos, setPhotos] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (ready && !user) router.push('/login');
  }, [ready, user, router]);

  const loadPhotos = useCallback(
    (p) => {
      if (!token) return;
      api
        .getMyPhotos(token, { page: p, limit: 20 })
        .then((data) => {
          setPhotos(data.photos);
          setPagination(data.pagination);
        })
        .catch((err) => setError(err.message));
    },
    [token]
  );

  useEffect(() => {
    if (token) loadPhotos(page);
  }, [token, page, loadPhotos]);

  async function handleConfirm(photoId) {
    setBusyId(photoId);
    try {
      await api.confirmMatch(token, photoId, 'confirm');
      loadPhotos(page);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(photoId) {
    setBusyId(photoId);
    try {
      await api.confirmMatch(token, photoId, 'reject');
      loadPhotos(page);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (!ready || !user) return null;

  return (
    <div className="container section">
      <div className="section-head">
        <div>
          <h2>My photos</h2>
          <p>Manage your face registration and every match found across the threads you&apos;ve searched.</p>
        </div>
      </div>

      <div className="profile-grid">
        <FaceRegistrationPanel token={token} />

        <div>
          {error && <p className="alert">{error}</p>}

          {photos === null && <p className="loading-line">Loading your photo history…</p>}

          {photos && photos.length === 0 && (
            <EmptyState title="No matches yet">
              <p>
                Once you search a thread you&apos;re a member of, any photos you appear in will
                show up here for review.
              </p>
            </EmptyState>
          )}

          {photos && photos.length > 0 && (
            <>
              <div className="card-grid">
                {photos.map((m) => (
                  <MatchCard
                    key={m.photo_id}
                    match={m}
                    onConfirm={handleConfirm}
                    onReject={handleReject}
                    busy={busyId === m.photo_id}
                  />
                ))}
              </div>

              {pagination && pagination.total_pages > 1 && (
                <div className="pagination">
                  <button
                    className="btn btn--sm"
                    disabled={!pagination.has_prev}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    Page {pagination.page} of {pagination.total_pages}
                  </span>
                  <button
                    className="btn btn--sm"
                    disabled={!pagination.has_next}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
