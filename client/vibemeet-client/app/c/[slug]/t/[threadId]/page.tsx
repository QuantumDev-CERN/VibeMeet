'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import * as api from '@/lib/api';
import type { Photo, SearchMatch, Thread } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { formatDate } from '@/lib/format';
import SectionHead from '@/components/SectionHead';
import EmptyState from '@/components/EmptyState';
import Pagination from '@/components/Pagination';
import UploadPanel from '@/components/UploadPanel';
import ContactSheet from '@/components/ContactSheet';
import Lightbox from '@/components/Lightbox';
import FindMePanel from '@/components/FindMePanel';

const PAGE_SIZE = 24;

export default function ThreadPage() {
  const params = useParams();
  const slug = Array.isArray(params.slug) ? params.slug[0] : (params.slug as string);
  const threadId = Array.isArray(params.threadId)
    ? params.threadId[0]
    : (params.threadId as string);
  const { token, user } = useAuth();

  const [thread, setThread] = useState<Thread | null>(null);
  const [communityName, setCommunityName] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [indexedCount, setIndexedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [searchKey, setSearchKey] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [takingSelected, setTakingSelected] = useState(false);
  const [takeSelectedError, setTakeSelectedError] = useState('');

  const loadPhotos = useCallback(async () => {
  if (!token) return;
  const { photos, indexed_count, total_count } = await api.listThreadPhotos(token, threadId);
  setPhotos(photos);
  setIndexedCount(indexed_count);
  setTotalCount(total_count);
  }, [token, threadId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    if (token) {
      api
        .getCommunity(slug, token)
        .then(({ community }) => {
          if (!cancelled) setCommunityName(community.name);
        })
        .catch(() => {
        });
    }
    api
      .getThread(threadId)
      .then(async ({ thread }) => {
        if (cancelled) return;
        setThread(thread);
        if (token) {
          try {
            const { photos, indexed_count, total_count } = await api.listThreadPhotos(token, threadId);
            if (!cancelled) {
              setPhotos(photos);
              setIndexedCount(indexed_count);
              setTotalCount(total_count);
            }
          } catch (err) {
            if (!cancelled)
              setError(err instanceof Error ? err.message : 'Could not load photographs');
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Thread not found');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, threadId, token]);

  const totalPages = Math.max(1, Math.ceil(photos.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagePhotos = useMemo(
    () => photos.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [photos, safePage]
  );

    const matchedPhotos = useMemo(
      () => matches.map((m) => m.photo).filter((p): p is Photo => Boolean(p)),
      [matches]
    );
    function frameNumber(photoId: string) {
      const inSheet = photos.findIndex((p) => p.id === photoId);
      if (inSheet !== -1) return inSheet + 1;
      const inMatches = matches.findIndex((m) => m.photo_id === photoId);
      return inMatches !== -1 ? inMatches + 1 : 0;
    }

  function handleMatches(next: SearchMatch[], key: string | null) {
    setMatches(next);
    setSearchKey(key);
    setHasSearched(true);
    setSelected(new Set(next.map((m) => m.photo_id)));
    setPage(1);
  }

  function toggleSelect(photoId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }

  async function handleTakeSelected() {
    if (!token || !searchKey || selected.size === 0 || takingSelected) return;
    setTakingSelected(true);
    setTakeSelectedError('');
    try {
      await api.downloadZip(token, searchKey, Array.from(selected));
    } catch (err) {
      setTakeSelectedError(
        err instanceof Error ? err.message : 'Could not download selected photos'
      );
    } finally {
      setTakingSelected(false);
    }
  }

  const date = thread ? formatDate(thread.event_date) : null;
  const uploadCount = useCallback(() => {
    void loadPhotos().catch((err) =>
      setError(err instanceof Error ? err.message : 'Could not refresh photographs')
    );
  }, [loadPhotos]);

  function renderContactSheet() {
    return (
      <>
        <SectionHead label="THE CONTACT SHEET" />
        {error && <p className="alert alert--error">{error}</p>}

        {photos.length === 0 ? (
          <EmptyState title="No photographs on the sheet yet.">
            <p>
              {token
                ? 'Drop the evening’s roll into the tray above — this is where the frames appear.'
                : 'Sign in and join the community to see and file the evening’s photographs.'}
            </p>
            {!token && (
              <Link href="/login" className="btn">
                Sign in
              </Link>
            )}
          </EmptyState>
        ) : (
          <>
            <ContactSheet
              photos={pagePhotos}
              matches={matches}
              offset={(safePage - 1) * PAGE_SIZE}
              onOpen={setLightboxPhoto}
              selectMode={false}
              selected={selected}
              onToggleSelect={toggleSelect}
              showScores={false}
            />
            <Pagination
              pagination={{
                page: safePage,
                total_pages: totalPages,
                total: photos.length,
                has_next: safePage < totalPages,
                has_prev: safePage > 1,
              }}
              onPage={(p) => {
                setPage(p);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              itemWord="frames"
            />
          </>
        )}
      </>
    );
  }

  function renderYourFrames() {
    return (
      <>
        <SectionHead label="YOUR FRAMES" />
        {matchedPhotos.length === 0 ? (
          <EmptyState title="No matches in this thread.">
            <p>
              The contact sheet is below — your frames will appear here after
              your next search.
            </p>
          </EmptyState>
        ) : (
          <ContactSheet
            photos={matchedPhotos}
            matches={matches}
            numberOf={(photo) => frameNumber(photo.id)}
            onOpen={setLightboxPhoto}
            selectMode={true}
            selected={selected}
            onToggleSelect={toggleSelect}
          />
        )}
      </>
    );
  }

  return (
    <section className="section section--tight">
      <div className="container">
        {loading && !thread ? (
          <p className="loading-line">Loading…</p>
        ) : !thread ? (
          <p className="alert alert--error">{error || 'Thread not found'}</p>
        ) : (
          <>
            {}
            <SectionHead
              label={communityName ? `THREAD — ${communityName.toUpperCase()}` : 'THREAD'}
            />
            <h1 className="display display--page">{thread.title}</h1>
            {thread.description && (
              <p className="lede" style={{ marginTop: 16, fontSize: 17 }}>
                {thread.description}
              </p>
            )}
            <div className="thread-meta">
              {date && (
                <div className="meta-item--inline">
                  <span className="meta-item__label">Date</span>
                  <span className="meta-item__value">{date}</span>
                </div>
              )}
              {thread.location && (
                <div className="meta-item--inline">
                  <span className="meta-item__label">Venue</span>
                  <span className="meta-item__value">{thread.location}</span>
                </div>
              )}
              {token && (
                <div className="meta-item--inline">
                  <span className="meta-item__label">Photographs</span>
                  <span className="meta-item__value">{totalCount}</span>
                </div>
              )}
            </div>

            {}
            {token && (
              <UploadPanel token={token} threadId={threadId} onUploaded={uploadCount} />
            )}

            {/* ── Top grid: contact sheet before search, your frames after ── */}
            <div style={{ marginTop: 44 }}>
              {!hasSearched ? renderContactSheet() : renderYourFrames()}
            </div>

            {}
            <FindMePanel
              token={token}
              userId={user?.id ?? null}
              threadId={threadId}
              photoCount={indexedCount}
              onBeforeSearch={loadPhotos}
              onMatches={handleMatches}
              searchKey={searchKey}
              selectedPhotoIds={Array.from(selected)}
              onTakeSelected={handleTakeSelected}
              takingSelected={takingSelected}
              takeSelectedError={takeSelectedError}
            />

            {}
            {hasSearched && (
              <div style={{ marginTop: 48 }}>{renderContactSheet()}</div>
            )}
          </>
        )}
      </div>

      {lightboxPhoto && token && (
        <Lightbox
          token={token}
          photo={lightboxPhoto}
          frameNo={frameNumber(lightboxPhoto.id)}
          dateLabel={date}
          threadTitle={thread?.title ?? ''}
          communityName={communityName ?? ''}
          onClose={() => setLightboxPhoto(null)}
        />
      )}
    </section>
  );
}
