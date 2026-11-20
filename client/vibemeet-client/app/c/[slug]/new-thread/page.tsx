'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import * as api from '@/lib/api';
import type { Community } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import SectionHead from '@/components/SectionHead';

export default function NewThreadPage() {
  const params = useParams();
  const slug = Array.isArray(params.slug) ? params.slug[0] : (params.slug as string);
  const router = useRouter();
  const { token, user, ready } = useAuth();

  const [community, setCommunity] = useState<Community | null>(null);
  const [loadError, setLoadError] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && !user) router.replace('/login');
  }, [ready, user, router]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .getCommunity(slug, token)
      .then(({ community }) => {
        if (!cancelled) setCommunity(community);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Community not found');
      });
    return () => {
      cancelled = true;
    };
  }, [slug, token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !community || busy) return;
    setError('');
    setBusy(true);
    try {
      const { thread } = await api.createThread(token, community.id, {
        title: title.trim(),
        description: description.trim() || null,
        event_date: eventDate || null,
        location: location.trim() || null,
      });
      router.push(`/c/${community.slug}/t/${thread.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create thread');
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !user) return null;

  return (
    <section className="section section--tight">
      <div className="container container--narrow">
        <SectionHead label="New event thread" />
        <h1 className="display display--page">Open a thread.</h1>
        <p className="lede" style={{ marginTop: 16, fontSize: 17 }}>
          A thread is one evening&rsquo;s roll of film
          {community ? (
            <>
              {' '}for <em>{community.name}</em>
            </>
          ) : (
            ''
          )}
          . Name the night; the photographs follow.
        </p>

        {loadError && <p className="alert alert--error" style={{ marginTop: 16 }}>{loadError}</p>}

        <form className="form-plate" onSubmit={handleSubmit}>
          {error && <p className="alert alert--error">{error}</p>}

          <div className="field">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Rooftop Session — September"
            />
          </div>

          <div className="field">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One or two lines about the evening."
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="event_date">Event date</label>
              <input
                id="event_date"
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="location">Location</label>
              <input
                id="location"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Bandra Social"
              />
            </div>
          </div>

          <button type="submit" className="btn btn--dark btn--full" disabled={busy || !community}>
            {busy ? 'Opening…' : 'Open the thread'}
          </button>

          <p className="field-hint" style={{ marginTop: 16 }}>
            {community ? (
              <Link href={`/c/${community.slug}`} className="link-underline">
                Back to {community.name}
              </Link>
            ) : (
              <Link href="/communities" className="link-underline">
                Back to the index
              </Link>
            )}
          </p>
        </form>
      </div>
    </section>
  );
}
