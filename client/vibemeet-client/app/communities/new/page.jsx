'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import * as api from '@/lib/api';

export default function NewCommunityPage() {
  const { user, token, ready } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (ready && !user) router.push('/login');
  }, [ready, user, router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.createCommunity(token, { name, description });
      router.push(`/c/${data.community.slug}`);
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
          <h2>Start a community</h2>
          <p>A persistent group for a class, a friend circle, or a regular spot.</p>
        </div>
      </div>

      <form className="form-card" onSubmit={handleSubmit}>
        {error && <p className="alert">{error}</p>}

        <div className="field">
          <label htmlFor="name">Name</label>
          <input
            id="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="IIIT Sonepat CS 2027"
          />
          <p className="field-hint">This becomes your community&apos;s URL, so keep it recognizable.</p>
        </div>

        <div className="field">
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Who's this for, and what kind of events will show up here?"
          />
        </div>

        <button className="btn btn--primary btn--full" type="submit" disabled={loading}>
          {loading ? 'Creating…' : 'Create community'}
        </button>
      </form>
    </div>
  );
}
