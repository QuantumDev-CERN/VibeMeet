'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import * as api from '@/lib/api';
import ThreadRow from '@/components/ThreadRow';
import EmptyState from '@/components/EmptyState';

export default function CommunityPage({ params }) {
  const { slug } = params;
  const { user, token, ready } = useAuth();

  const [community, setCommunity] = useState(null);
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState('');
  const [joinState, setJoinState] = useState('idle'); // idle | joining | joined

  useEffect(() => {
    let cancelled = false;
    api
      .getCommunity(slug)
      .then((data) => {
        if (cancelled) return;
        setCommunity(data.community);
        return api.listThreads(data.community.id);
      })
      .then((data) => {
        if (cancelled || !data) return;
        setThreads(data.threads);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function handleJoin() {
    if (!token || !community) return;
    setJoinState('joining');
    try {
      await api.joinCommunity(token, community.id);
      setJoinState('joined');
    } catch (err) {
      setError(err.message);
      setJoinState('idle');
    }
  }

  if (error && !community) {
    return (
      <div className="container section">
        <EmptyState title="Community not found">
          <p>{error}</p>
          <Link href="/" className="btn btn--sm">
            Back to communities
          </Link>
        </EmptyState>
      </div>
    );
  }

  if (!community) {
    return (
      <div className="container section">
        <p className="loading-line">Loading community…</p>
      </div>
    );
  }

  return (
    <>
      <section className="container section--tight">
        <div className="section-head">
          <div>
            <h2>{community.name}</h2>
            <p>{community.description}</p>
            <div className="tag-row" style={{ marginTop: 12 }}>
              <span className="tag tag--gold">
                {community.member_count} {community.member_count === 1 ? 'member' : 'members'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {ready && user && (
              <button
                className="btn"
                onClick={handleJoin}
                disabled={joinState !== 'idle'}
                type="button"
              >
                {joinState === 'joined' ? 'Joined' : joinState === 'joining' ? 'Joining…' : 'Join community'}
              </button>
            )}
            {ready && user && (
              <Link href={`/c/${slug}/new-thread`} className="btn btn--primary">
                New thread
              </Link>
            )}
          </div>
        </div>
        {error && <p className="alert">{error}</p>}
      </section>

      <section className="container section--tight">
        <div className="section-head">
          <div>
            <h2 style={{ fontSize: 24 }}>Threads</h2>
            <p>Each thread is one event — photos and face search live inside it.</p>
          </div>
        </div>

        {threads === null && <p className="loading-line">Loading threads…</p>}

        {threads && threads.length === 0 && (
          <EmptyState title="No threads yet">
            <p>The first event for this community hasn&apos;t been posted. Start one to begin collecting photos.</p>
            {ready && user ? (
              <Link href={`/c/${slug}/new-thread`} className="btn btn--primary btn--sm">
                New thread
              </Link>
            ) : (
              <Link href="/login" className="btn btn--sm">
                Log in to post one
              </Link>
            )}
          </EmptyState>
        )}

        {threads && threads.length > 0 && (
          <div>
            {threads.map((t) => (
              <ThreadRow key={t.id} thread={t} communitySlug={slug} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
