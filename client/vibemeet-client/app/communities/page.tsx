'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import * as api from '@/lib/api';
import type { Community } from '@/lib/api';
import SectionHead from '@/components/SectionHead';
import EmptyState from '@/components/EmptyState';
import { useAuth } from '@/components/AuthProvider';

export default function CommunitiesPage() {
  const { user } = useAuth();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .listCommunities()
      .then(({ communities }) => {
        if (!cancelled) setCommunities(communities);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load communities');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="section section--tight">
      <div className="container">
        <SectionHead no="No. 01" label="The index" />
        <div className="page-head">
          <div className="page-head__main">
            <h1 className="display display--page">Communities</h1>
            <p className="lede" style={{ marginTop: 16, fontSize: 17 }}>
              Every gathering in the index, filed in one place. Open one to see
              its event threads — or start your own.
            </p>
          </div>
          <div className="page-head__actions">
            {user ? (
              <Link href="/communities/new" className="btn">
                New community
              </Link>
            ) : (
              <Link href="/login" className="btn">
                Sign in to start one
              </Link>
            )}
          </div>
        </div>

        <div style={{ marginTop: 40 }}>
          {error && <p className="alert alert--error">{error}</p>}
          {loading ? (
            <p className="loading-line">Loading…</p>
          ) : communities.length === 0 ? (
            <EmptyState title="The index is empty — for now.">
              <p>
                No communities yet. Start the first one and the night&rsquo;s
                photographs will have somewhere to live.
              </p>
              {user ? (
                <Link href="/communities/new" className="btn">
                  New community
                </Link>
              ) : (
                <Link href="/login" className="btn">
                  Sign in to start one
                </Link>
              )}
            </EmptyState>
          ) : (
            <div className="index-rows">
              {communities.map((c, i) => (
                <Link key={c.id} href={`/c/${c.slug}`} className="index-row">
                  <span className="index-row__no">{String(i + 1).padStart(2, '0')}</span>
                  <span>
                    <span className="index-row__name">{c.name}</span>
                    <span className="index-row__meta">
                      <span>{c.slug}</span>
                      <span>
                        {c.member_count} {c.member_count === 1 ? 'member' : 'members'}
                      </span>
                    </span>
                  </span>
                  <span className="index-row__arrow" aria-hidden="true">
                    &rarr;
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
