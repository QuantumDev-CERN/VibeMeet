'use client';

import { use, useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import * as api from '@/lib/api';
import UploadPanel from '@/components/UploadPanel';
import EmptyState from '@/components/EmptyState';

function formatDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function ThreadPage({ params }) {
  // Next 16: params is a Promise in client components — must unwrap with use().
  const { slug, threadId } = use(params);
  const { user, token, ready } = useAuth();

  const [community, setCommunity] = useState(null);
  const [thread, setThread] = useState(null);
  const [photos, setPhotos] = useState(null);
  const [loadError, setLoadError] = useState('');

  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchMeta, setSearchMeta] = useState(null); // { notMember, noFace, rateLimited }
  const [result, setResult] = useState(null); // { search_key, matches, total }
  const [selected, setSelected] = useState(new Set());
  const [zipLoading, setZipLoading] = useState(false);
  const [selLoading, setSelLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);

  const loadPhotos = useCallback(() => {
    api
      .listThreadPhotos(threadId)
      .then((data) => setPhotos(data.photos))
      .catch((err) => setLoadError(err.message));
  }, [threadId]);

  useEffect(() => {
    let cancelled = false;
    api
      .getThread(threadId)
      .then((data) => !cancelled && setThread(data.thread))
      .catch((err) => !cancelled && setLoadError(err.message));
    api
      .getCommunity(slug)
      .then((data) => !cancelled && setCommunity(data.community))
      .catch(() => {});
    loadPhotos();
    return () => {
      cancelled = true;
    };
  }, [threadId, slug, loadPhotos]);

  const matchByPhotoId = useMemo(() => {
    const map = new Map();
    result?.matches.forEach((m) => map.set(m.photo_id, m));
    return map;
  }, [result]);

  async function runSearch() {
    setSearchError('');
    setSearchMeta(null);
    setResult(null);
    setSearching(true);
    try {
      const data = await api.searchFaces(token, threadId);
      setResult(data);
      setSelected(new Set(data.matches.map((m) => m.photo_id)));
    } catch (err) {
      if (err.status === 422) {
        setSearchMeta({ noFace: true });
        setSearchError(err.message);
      } else if (err.status === 403) {
        setSearchMeta({ notMember: true });
        setSearchError(err.message);
      } else if (err.status === 429) {
        setSearchMeta({ rateLimited: true, retryAfter: err.body?.retry_after });
        setSearchError(err.message);
      } else {
        setSearchError(err.message);
      }
    } finally {
      setSearching(false);
    }
  }

  async function handleJoinThenSearch() {
    if (!community) return;
    setJoinLoading(true);
    try {
      await api.joinCommunity(token, community.id);
      await runSearch();
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setJoinLoading(false);
    }
  }

  function toggleSelected(photoId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }

  async function handleDownloadZip() {
    if (!result?.search_key) return;
    setZipLoading(true);
    setSearchError('');
    try {
      await api.downloadZip(token, result.search_key);
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setZipLoading(false);
    }
  }

  async function handleDownloadSelected() {
    if (!result?.search_key || selected.size === 0) return;
    setSelLoading(true);
    setSearchError('');
    try {
      const data = await api.getDownloadUrls(token, result.search_key, [...selected]);
      data.downloads.forEach((d, i) => {
        setTimeout(() => {
          const a = document.createElement('a');
          a.href = d.download_url;
          a.target = '_blank';
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          a.remove();
        }, i * 250);
      });
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setSelLoading(false);
    }
  }

  if (loadError && !thread) {
    return (
      <div className="container section">
        <EmptyState title="Thread not found">
          <p>{loadError}</p>
          <Link href={`/c/${slug}`} className="btn btn--sm">
            Back to community
          </Link>
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      <section className="container section--tight">
        <p className="field-hint" style={{ marginBottom: 10 }}>
          <Link href={`/c/${slug}`}>{community ? community.name : 'Back to community'}</Link>
        </p>
        {!thread ? (
          <p className="loading-line">Loading thread…</p>
        ) : (
          <div className="section-head">
            <div>
              <h2>{thread.title}</h2>
              {thread.description && <p>{thread.description}</p>}
              <div className="tag-row" style={{ marginTop: 10 }}>
                {formatDate(thread.event_date) && <span className="tag">{formatDate(thread.event_date)}</span>}
                {thread.location && <span className="tag">{thread.location}</span>}
              </div>
            </div>
          </div>
        )}
      </section>

      {user && thread && (
        <section className="container section--tight">
          <UploadPanel token={token} threadId={thread.id} onUploaded={loadPhotos} />
        </section>
      )}

      {thread && (
        <section className="container section--tight">
          <div className="search-panel">
            <div className="search-panel__head">
              <h3>Search for me in this thread</h3>
            </div>
            {!ready ? null : !user ? (
              <p className="field-hint">
                <Link href="/login">Log in</Link> to search this thread for photos you appear in.
              </p>
            ) : (
              <>
                <p className="field-hint">
                  Runs a face match against every indexed photo here, scoped to this thread only.
                </p>

                {searchError && (
                  <p className="alert" style={{ marginTop: 14 }}>
                    {searchError}
                    {searchMeta?.noFace && (
                      <>
                        {' '}
                        <Link href="/me">Register your face</Link> first.
                      </>
                    )}
                  </p>
                )}

                <div className="search-panel__actions">
                  {searchMeta?.notMember ? (
                    <button className="btn btn--primary" onClick={handleJoinThenSearch} disabled={joinLoading}>
                      {joinLoading ? 'Joining…' : 'Join community & search'}
                    </button>
                  ) : (
                    <button className="btn btn--primary" onClick={runSearch} disabled={searching}>
                      {searching ? 'Searching…' : 'Search my face'}
                    </button>
                  )}
                </div>

                {result && result.total === 0 && (
                  <p className="alert" style={{ marginTop: 16 }}>
                    No matches yet in this thread. Try again once more photos are uploaded and indexed.
                  </p>
                )}

                {result && result.total > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <p className="field-hint">
                      You appear in {result.total} {result.total === 1 ? 'photo' : 'photos'}, highlighted below.
                    </p>
                    <div className="search-panel__actions">
                      <button className="btn btn--primary" onClick={handleDownloadZip} disabled={zipLoading}>
                        {zipLoading ? 'Zipping…' : 'Download all as .zip'}
                      </button>
                      <button
                        className="btn"
                        onClick={handleDownloadSelected}
                        disabled={selLoading || selected.size === 0}
                      >
                        {selLoading ? 'Preparing…' : `Download selected (${selected.size})`}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}

      <section className="container section">
        <div className="section-head">
          <div>
            <h2 style={{ fontSize: 24 }}>Photos</h2>
            <p>{photos ? `${photos.length} uploaded` : 'Loading…'}</p>
          </div>
        </div>

        {photos && photos.length === 0 && (
          <EmptyState title="No photos yet">
            <p>Once photos from this event are uploaded, they&apos;ll show up here as a contact sheet.</p>
          </EmptyState>
        )}

        {photos && photos.length > 0 && (
          <>
            <div className="sprocket-strip" />
            <div className="photo-grid">
              {photos.map((photo, i) => {
                const match = matchByPhotoId.get(photo.id);
                return (
                  <div
                    key={photo.id}
                    className={`photo-frame ${match ? 'photo-frame--match' : ''}`}
                  >
                    <span className="photo-frame__index">{String(i + 1).padStart(2, '0')}</span>
                    {match && (
                      <input
                        type="checkbox"
                        className="photo-frame__check"
                        checked={selected.has(photo.id)}
                        onChange={() => toggleSelected(photo.id)}
                        aria-label={`Include photo ${i + 1} in download`}
                      />
                    )}
                    {photo.thumbnail_url ? (
                      <img src={photo.thumbnail_url} alt={`Event photo ${i + 1}`} loading="lazy" />
                    ) : (
                      <div className="photo-frame__pending">Preview unavailable</div>
                    )}
                    {!photo.indexed && (
                      <span className="photo-frame__similarity" style={{ color: 'var(--ink-dim)' }}>
                        Indexing…
                      </span>
                    )}
                    {match && (
                      <span className="photo-frame__similarity">
                        {Math.round(match.similarity * 100)}% match
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="sprocket-strip" />
          </>
        )}
      </section>
    </>
  );
}
