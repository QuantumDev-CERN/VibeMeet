'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import * as api from '@/lib/api';
import type { SearchMatch } from '@/lib/api';
import { ApiError } from '@/lib/api';
import { hasFaceOnFile, fetchFaceOnFile, clearFaceOnFile } from '@/lib/faceStatus';
import SectionHead from '@/components/SectionHead';

interface FindMePanelProps {
  token: string | null;
  userId: string | null;
  threadId: string;
  photoCount: number;
  onMatches: (matches: SearchMatch[], searchKey: string | null) => void;
  onBeforeSearch?: () => Promise<void>;
  searchKey: string | null;
  selectedPhotoIds: string[];
  onTakeSelected: () => void;
  takingSelected: boolean;
  takeSelectedError: string;
}

export default function FindMePanel({
  token,
  userId,
  threadId,
  photoCount,
  onMatches,
  onBeforeSearch,
  searchKey,
  selectedPhotoIds,
  onTakeSelected,
  takingSelected,
  takeSelectedError,
}: FindMePanelProps) {
  const [status, setStatus] = useState<'idle' | 'searching'>('idle');
  const [error, setError] = useState('');
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [zipping, setZipping] = useState(false);

  const signedIn = Boolean(token && userId);
  const [faceKnown, setFaceKnown] = useState(userId ? hasFaceOnFile(userId) : false);

  useEffect(() => {
    if (!token || !userId) return;
    let cancelled = false;
    fetchFaceOnFile(token, userId)
      .then((registered) => {
        if (!cancelled) setFaceKnown(registered);
      })
      .catch(() => {
      });
    return () => {
      cancelled = true;
    };
  }, [token, userId]);

  async function handleSearch() {
    if (!token || !userId) return;
    setStatus('searching');
    setError('');
    setMatchCount(null);
    try {
      await onBeforeSearch?.();
    } catch {
    }
    try {
      const data = await api.searchFaces(token, threadId);
      const matches = data.matches || [];
      onMatches(matches, data.search_key);
      setMatchCount(matches.length);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        clearFaceOnFile(userId);
        setFaceKnown(false);
        setError('No face on file — sit for your portrait in My Photos first.');
      } else {
        setError(err instanceof Error ? err.message : 'Search failed');
      }
    } finally {
      setStatus('idle');
    }
  }

  async function handleZip() {
    if (!token || !searchKey) return;
    setZipping(true);
    setError('');
    try {
      await api.downloadZip(token, searchKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Zip download failed');
    } finally {
      setZipping(false);
    }
  }

  return (
    <section className="findme" aria-label="Find me in this thread">
      <SectionHead label="FIND ME" onDark />
      <h2 className="findme__title">Are you in this roll?</h2>
      <p className="findme__lede">
        Run your portrait against every indexed photograph in this thread —
        and only this thread. Matches are filed to My Photos for your review.
      </p>

      <div className="findme__steps">
        <div className="findme__step">
          <span className="findme__step-head">First —</span>
          <p>Sit for your portrait in My Photos.</p>
          <p>Two to five clear selfies; once is enough.</p>
        </div>
        <div className="findme__step">
          <span className="findme__step-head">Then —</span>
          <p>Press the button. The search reads this thread&rsquo;s indexed faces and no one else&rsquo;s.</p>
        </div>
        <div className="findme__step">
          <span className="findme__step-head">Finally —</span>
          <p>Collect your frames above — take the keepers, or the whole roll as a zip.</p>
        </div>
      </div>

      {(error || takeSelectedError) && (
        <p className="alert alert--error alert--on-dark">
          {error || takeSelectedError}
        </p>
      )}

      <div className="findme__actions">
        {!signedIn ? (
          <Link href="/login" className="btn btn--on-dark">
            Sign in to search
          </Link>
        ) : !faceKnown ? (
          <Link href="/me" className="btn btn--on-dark">
            Sit for your portrait
          </Link>
        ) : (
          <>
            <button
              type="button"
              className="btn btn--oxblood"
              onClick={handleSearch}
              disabled={status === 'searching' || photoCount === 0}
            >
              {status === 'searching' ? 'Searching…' : 'Search my face'}
            </button>
            {searchKey && (
              <>
                <button
                  type="button"
                  className="btn btn--on-dark"
                  onClick={handleZip}
                  disabled={zipping}
                >
                  {zipping ? 'Packing…' : 'Take all as a .zip'}
                </button>
                <button
                  type="button"
                  className="btn btn--on-dark"
                  onClick={onTakeSelected}
                  disabled={takingSelected || selectedPhotoIds.length === 0}
                >
                  {takingSelected
                    ? 'Fetching…'
                    : `Take selected (${selectedPhotoIds.length})`}
                </button>
              </>
            )}
          </>
        )}
      </div>

      {matchCount !== null && (
        <p className="findme__result">
          {matchCount > 0
            ? `You appear in ${matchCount} ${matchCount === 1 ? 'frame' : 'frames'} — marked in oxblood in your frames above.`
            : 'No matches in this thread.'}
        </p>
      )}
    </section>
  );
}
