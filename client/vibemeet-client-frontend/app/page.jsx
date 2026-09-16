'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import * as api from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import CommunityCard from '@/components/CommunityCard';
import EmptyState from '@/components/EmptyState';

const FRAME_COLORS = ['#4a231b', '#3a3226', '#c9a227', '#2b2419', '#e8402b', '#221d16'];

export default function HomePage() {
  const { user, ready } = useAuth();
  const [communities, setCommunities] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .listCommunities()
      .then((data) => setCommunities(data.communities))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <section className="container hero">
        <div>
          <h1>Find yourself in the crowd.</h1>
          <p className="hero__lede">
            VibeMeet organizes event photos by community and by night. Submit a couple of
            selfies, and the next time someone uploads a batch from the thread you were at,
            you can search for exactly the frames you&apos;re in — no more scrolling
            through three hundred photos of other people.
          </p>
          <div className="hero__actions">
            <a href="#communities" className="btn btn--primary">
              Browse communities
            </a>
            {ready && !user && (
              <Link href="/register" className="btn">
                Create an account
              </Link>
            )}
          </div>
        </div>
        <div className="contact-sheet" aria-hidden="true">
          <div className="contact-sheet__grid">
            {FRAME_COLORS.map((color, i) => (
              <div
                key={i}
                className="contact-sheet__frame"
                data-frame={String(i + 1).padStart(2, '0')}
                style={{ '--frame-color': color }}
              />
            ))}
          </div>
          <div className="sprocket-strip" />
        </div>
      </section>

      <section className="container section" id="communities">
        <div className="section-head">
          <div>
            <h2>Communities</h2>
            <p>Groups of people and places — join one to see its threads.</p>
          </div>
          {ready && user && (
            <Link href="/communities/new" className="btn btn--primary btn--sm">
              Start a community
            </Link>
          )}
        </div>

        {error && <p className="alert">{error}</p>}

        {communities === null && !error && <p className="loading-line">Loading communities…</p>}

        {communities && communities.length === 0 && (
          <EmptyState title="No communities yet">
            <p>
              Be the first to start one — a class, a friend group, a regular spot. Threads and
              photo search live inside communities once they exist.
            </p>
            {ready && user ? (
              <Link href="/communities/new" className="btn btn--primary btn--sm">
                Start a community
              </Link>
            ) : (
              <Link href="/register" className="btn btn--primary btn--sm">
                Sign up to start one
              </Link>
            )}
          </EmptyState>
        )}

        {communities && communities.length > 0 && (
          <div className="card-grid">
            {communities.map((c) => (
              <CommunityCard key={c.id} community={c} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
