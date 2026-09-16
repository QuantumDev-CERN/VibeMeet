'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import * as api from '@/lib/api';

export default function NewThreadPage({ params }) {
  // Next 16: params is a Promise in client components — must unwrap with use().
  const { slug } = use(params);
  const { user, token, ready } = useAuth();
  const router = useRouter();

  const [community, setCommunity] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (ready && !user) router.push('/login');
  }, [ready, user, router]);

  useEffect(() => {
    api.getCommunity(slug).then((data) => setCommunity(data.community)).catch((err) => setError(err.message));
  }, [slug]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!community) return;
    setError('');
    setLoading(true);
    try {
      const data = await api.createThread(token, community.id, {
        title,
        description: description || null,
        event_date: eventDate || null,
        location: location || null,
      });
      router.push(`/c/${slug}/t/${data.thread.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!ready || !user) return null;

  return (
    <div className="container container--narrow section">
      <div className="section-head">
        <div>
          <h2>New thread</h2>
          <p>{community ? `Inside ${community.name}` : 'Loading community…'}</p>
        </div>
      </div>

      <form className="form-card" onSubmit={handleSubmit}>
        {error && <p className="alert">{error}</p>}

        <div className="field">
          <label htmlFor="title">Title</label>
          <input
            id="title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Farewell Party, March 15"
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="event_date">Date</label>
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
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Campus lawn"
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Anything attendees should know before they upload or search photos"
          />
        </div>

        <button className="btn btn--primary btn--full" type="submit" disabled={loading || !community}>
          {loading ? 'Creating…' : 'Create thread'}
        </button>
      </form>
    </div>
  );
}
