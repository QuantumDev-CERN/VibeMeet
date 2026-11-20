'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import * as api from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import SectionHead from '@/components/SectionHead';

export default function NewCommunityPage() {
  const router = useRouter();
  const { token, user, ready } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && !user) router.replace('/login?next=/communities/new');
  }, [ready, user, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || busy) return;
    setError('');
    setBusy(true);
    try {
      const { community } = await api.createCommunity(token, {
        name: name.trim(),
        description: description.trim(),
      });
      router.push(`/c/${community.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create community');
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !user) return null;

  return (
    <section className="section section--tight">
      <div className="container container--narrow">
        <SectionHead label="New community" />
        <h1 className="display display--page">Found a gathering.</h1>
        <p className="lede" style={{ marginTop: 16, fontSize: 17 }}>
          Give it a name and a line or two. The URL slug follows the name, so
          choose one you&rsquo;d be happy to say out loud.
        </p>

        <form className="form-plate" onSubmit={handleSubmit}>
          {error && <p className="alert alert--error">{error}</p>}

          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Midnight Runners"
            />
          </div>

          <div className="field">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What brings this crowd together?"
            />
          </div>

          <button type="submit" className="btn btn--dark btn--full" disabled={busy}>
            {busy ? 'Founding…' : 'Found the community'}
          </button>

          <p className="field-hint" style={{ marginTop: 16 }}>
            <Link href="/communities" className="link-underline">
              Back to the index
            </Link>
          </p>
        </form>
      </div>
    </section>
  );
}
