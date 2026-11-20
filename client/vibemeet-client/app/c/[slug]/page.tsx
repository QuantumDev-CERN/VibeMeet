'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import * as api from '@/lib/api';
import type { Community, Thread } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import SectionHead from '@/components/SectionHead';
import EmptyState from '@/components/EmptyState';
import ThreadRow from '@/components/ThreadRow';

export default function CommunityPage() {
  const params = useParams();
  const slug = Array.isArray(params.slug) ? params.slug[0] : (params.slug as string);
  const { token, user, ready } = useAuth();
  const router = useRouter();

  const [community, setCommunity] = useState<Community | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinMsg, setJoinMsg] = useState('');

  useEffect(() => {
    if (ready && (!user || !token)) router.replace(`/login?next=/c/${slug}`);
  }, [ready, user, token, router, slug]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .getCommunity(slug, token)
      .then(async ({ community }) => {
        if (cancelled) return;
        setCommunity(community);
        try {
          const { threads } = await api.listThreads(community.id);
          if (cancelled) return;
          setThreads(threads);
          const entries = await Promise.all(
            threads.map(async (t) => {
              try {
                const { photos } = await api.listThreadPhotos(token, t.id);
                return [t.id, photos.length] as const;
              } catch {
                return [t.id, null] as const;
              }
            })
          );
          if (!cancelled) {
            const map: Record<string, number> = {};
            for (const [id, n] of entries) if (n != null) map[id] = n;
            setCounts(map);
          }
        } catch (err) {
          if (!cancelled)
            setError(err instanceof Error ? err.message : 'Could not load threads');
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Community not found');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, token]);

  async function handleJoin() {
    if (!token || !community || joinBusy) return;
    setJoinBusy(true);
    setJoinMsg('');
    try {
      const data = await api.joinCommunity(token, community.id);
      setJoinMsg(data.message);
      setCommunity({ ...community, is_member: true, role: 'member', member_count: community.member_count + 1 });
    } catch (err) {
      setJoinMsg(err instanceof Error ? err.message : 'Could not join');
    } finally {
      setJoinBusy(false);
    }
  }

  async function handleLeave() {
    if (!token || !community || joinBusy) return;
    setJoinBusy(true);
    setJoinMsg('');
    try {
      const data = await api.leaveCommunity(token, community.id);
      setJoinMsg(data.message);
      setCommunity({ ...community, is_member: false, role: null, member_count: community.member_count - 1 });
    } catch (err) {
      setJoinMsg(err instanceof Error ? err.message : 'Could not leave');
    } finally {
      setJoinBusy(false);
    }
  }

  return (
    <section className="section section--tight">
      <div className="container">
        {error && !community && <p className="alert alert--error">{error}</p>}
        {loading && !community ? (
          <p className="loading-line">Loading…</p>
        ) : community ? (
          <>
            <SectionHead no="No. 03" label="COMMUNITY" />
            <div className="page-head">
              <div className="page-head__main">
                <h1 className="display display--page">{community.name}</h1>
                <p className="lede" style={{ marginTop: 16, fontSize: 17 }}>
                  {community.description || 'A gathering with no filing card yet.'}
                </p>
                <div className="meta-row">
                  <div className="meta-item--inline">
                    <span className="meta-item__label">Members</span>
                    <span className="meta-item__value">{community.member_count}</span>
                  </div>
                  <div className="meta-item--inline">
                    <span className="meta-item__label">Evenings filed</span>
                    <span className="meta-item__value">{threads.length}</span>
                  </div>
                </div>
              </div>
              <div className="page-head__actions">
                {community.role === 'member' ? (
                  <button type="button" className="btn" onClick={handleLeave} disabled={joinBusy}>
                    {joinBusy ? 'Leaving…' : 'Leave community'}
                  </button>
                ) : community.role === 'admin' ? null : (
                  <button type="button" className="btn" onClick={handleJoin} disabled={joinBusy}>
                    {joinBusy ? 'Joining…' : 'Join community'}
                  </button>
                )}
                <Link href={`/c/${community.slug}/new-thread`} className="btn btn--dark">
                  File a new evening
                </Link>
              </div>
            </div>
            {joinMsg && (
              <p className="alert alert--success" style={{ marginTop: 24, maxWidth: 620 }}>
                {joinMsg}
              </p>
            )}

            <div style={{ marginTop: 48 }}>
              <SectionHead label="THREADS — THE EVENINGS" />
              {error && <p className="alert alert--error">{error}</p>}
              {threads.length === 0 ? (
                <EmptyState title="No threads filed yet.">
                  <p>
                    Event threads are where the photographs live. Start the
                    first one for the evening&rsquo;s roll.
                  </p>
                  <Link href={`/c/${community.slug}/new-thread`} className="btn">
                    File a new evening
                  </Link>
                </EmptyState>
              ) : (
                <div className="index-rows">
                  {threads.map((t, i) => (
                    <ThreadRow
                      key={t.id}
                      thread={t}
                      communitySlug={community.slug}
                      index={i}
                      photoCount={counts[t.id]}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
