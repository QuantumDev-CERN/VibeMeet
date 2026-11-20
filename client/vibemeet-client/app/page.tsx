'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import SectionHead from '@/components/SectionHead';
import { listCommunities } from '@/lib/api';

export default function HomePage() {
  const [communityCount, setCommunityCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCommunities()
      .then(({ communities }) => {
        if (!cancelled) setCommunityCount(communities.length);
      })
      .catch(() => {
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {}
      <section className="section">
        <div className="container">
          <SectionHead no="No. 01" label="THE PREMISE" />
          <h1 className="display display--hero">
            Find yourself
            <br />
            in the crowd.
          </h1>
          <p className="lede" style={{ marginTop: 24 }}>
            VibeMeet files event photographs by community and by night. Sit for
            a few portraits once, and the next time somebody uploads a roll
            from an evening you attended, you can pull exactly the frames you
            appear in — no more paging through three hundred photographs of
            other people.
          </p>
          <div className="hero__actions">
            <Link href="/communities" className="btn btn--dark">
              Browse the index
            </Link>
            <Link href="/communities/new" className="btn">
              Start a community
            </Link>
          </div>

          <div className="hero__stats">
            <div>
              <div className="hero__stat-num">
                {communityCount === null ? '–' : communityCount}
              </div>
              <div className="hero__stat-label">communities on file</div>
            </div>
            <div>
              <div className="hero__stat-num">3</div>
              <div className="hero__stat-label">
                steps from upload to your face
              </div>
            </div>
            <div>
              <div className="hero__stat-num">0</div>
              <div className="hero__stat-label">global lookups, ever</div>
            </div>
          </div>
        </div>
      </section>

      {}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <SectionHead no="No. 02" label="THE METHOD" />
          <div className="method-grid">
            <div className="method-card">
              <span className="method-card__step">Step one</span>
              <h3>Join a community</h3>
              <p>
                A class, a friend circle, a regular haunt. Communities are where
                evenings are filed.
              </p>
            </div>
            <div className="method-card">
              <span className="method-card__step">Step two</span>
              <h3>Sit for your portrait</h3>
              <p>
                Submit a few selfies once. They become your private reference —
                searched only when you ask.
              </p>
            </div>
            <div className="method-card">
              <span className="method-card__step">Step three</span>
              <h3>Pull your frames</h3>
              <p>
                Open any thread, run Find Me, and collect your photographs —
                the keepers, or the roll as a zip.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
