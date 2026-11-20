'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';
import type { MyPhoto, Pagination as PaginationType } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import SectionHead from '@/components/SectionHead';
import EmptyState from '@/components/EmptyState';
import MatchCard from '@/components/MatchCard';
import FacePanel from '@/components/FacePanel';
import Pagination from '@/components/Pagination';

const PAGE_SIZE = 12;

export default function MePage() {
  const router = useRouter();
  const { token, user, ready } = useAuth();

  const [photos, setPhotos] = useState<MyPhoto[]>([]);
  const [pagination, setPagination] = useState<PaginationType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [rejected, setRejected] = useState<MyPhoto[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (ready && (!user || !token)) router.replace('/login?next=/me');
  }, [ready, user, token, router]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .getMyPhotos(token, { page, limit: PAGE_SIZE })
      .then((data) => {
        if (cancelled) return;
        setPhotos(data.photos);
        setPagination(data.pagination);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your photographs');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, page]);

  async function handleVerdict(photo: MyPhoto, action: 'confirm' | 'reject') {
    if (!token || busyId) return;
    setBusyId(photo.photo_id);
    setError('');
    try {
      await api.confirmMatch(token, photo.photo_id, action);
      if (action === 'reject') {
        setPhotos((prev) => prev.filter((p) => p.photo_id !== photo.photo_id));
        setRejected((prev) =>
          prev.some((p) => p.photo_id === photo.photo_id) ? prev : [...prev, photo]
        );
      } else {
        const updated = { ...photo, confirmed: true as const };
        setRejected((prev) => prev.filter((p) => p.photo_id !== photo.photo_id));
        setPhotos((prev) =>
          prev.some((p) => p.photo_id === photo.photo_id)
            ? prev.map((p) => (p.photo_id === photo.photo_id ? updated : p))
            : [updated, ...prev]
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your verdict');
    } finally {
      setBusyId(null);
    }
  }

  if (!ready || !user || !token) return null;

  const inReviewBand = (p: MyPhoto) =>
    p.confidence == null || (p.confidence > 0.33 && p.confidence < 0.5);
  const reviewPhotos = photos.filter((p) => !p.confirmed && inReviewBand(p));
  const confirmedPhotos = photos.filter((p) => p.confirmed);
  const trustedPhotos = photos.filter((p) => !p.confirmed && !inReviewBand(p));
  const hasAny =
    reviewPhotos.length > 0 ||
    trustedPhotos.length > 0 ||
    confirmedPhotos.length > 0 ||
    rejected.length > 0;

  return (
    <section className="section section--tight">
      <div className="container">
        <SectionHead no="No. 04" label="THE READER'S ALBUM" />
        <h1 className="display display--page">My photos</h1>
        <p className="lede" style={{ marginTop: 16, fontSize: 17 }}>
          Your portrait, and every frame the search has found you in — yours to
          confirm, dismiss, or keep.
        </p>

        <div className="album-grid">
          <FacePanel token={token} userId={user.id} />

          <div>
            {error && <p className="alert alert--error">{error}</p>}

            {loading && !hasAny ? (
              <p className="loading-line">Loading…</p>
            ) : !hasAny ? (
              <EmptyState title="No matches yet.">
                <p>
                  Run Find Me inside a thread —{' '}
                  <Link href="/communities" className="link-underline">
                    browse the index
                  </Link>
                  , open an evening&rsquo;s photographs, and search. Your
                  matches will gather here.
                </p>
              </EmptyState>
            ) : (
              <>
                <div className="match-grid">
                  {reviewPhotos.map((p) => (
                    <MatchCard
                      key={p.photo_id}
                      photo={p}
                      status="pending"
                      busy={busyId === p.photo_id}
                      onConfirm={() => handleVerdict(p, 'confirm')}
                      onReject={() => handleVerdict(p, 'reject')}
                      onRestore={() => handleVerdict(p, 'confirm')}
                    />
                  ))}
                  {trustedPhotos.map((p) => (
                    <MatchCard
                      key={p.photo_id}
                      photo={p}
                      status="trusted"
                      busy={busyId === p.photo_id}
                      onConfirm={() => handleVerdict(p, 'confirm')}
                      onReject={() => handleVerdict(p, 'reject')}
                      onRestore={() => handleVerdict(p, 'confirm')}
                    />
                  ))}
                  {confirmedPhotos.map((p) => (
                    <MatchCard
                      key={p.photo_id}
                      photo={p}
                      status="confirmed"
                      busy={busyId === p.photo_id}
                      onConfirm={() => handleVerdict(p, 'confirm')}
                      onReject={() => handleVerdict(p, 'reject')}
                      onRestore={() => handleVerdict(p, 'confirm')}
                    />
                  ))}
                  {rejected.map((p) => (
                    <MatchCard
                      key={p.photo_id}
                      photo={p}
                      status="rejected"
                      busy={busyId === p.photo_id}
                      onConfirm={() => handleVerdict(p, 'confirm')}
                      onReject={() => handleVerdict(p, 'reject')}
                      onRestore={() => handleVerdict(p, 'confirm')}
                    />
                  ))}
                </div>
                <Pagination
                  pagination={pagination}
                  onPage={setPage}
                  itemWord="photographs"
                />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
