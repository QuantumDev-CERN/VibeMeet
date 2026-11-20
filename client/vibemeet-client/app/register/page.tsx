'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import SectionHead from '@/components/SectionHead';

export default function RegisterPage() {
  const router = useRouter();
  const { requestRegister } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const { email: sentTo } = await requestRegister(username.trim(), email.trim(), password);
      router.push(`/register/verify?email=${encodeURIComponent(sentTo)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section section--tight">
      <div className="container container--narrow">
        <SectionHead label="Join" />
        <h1 className="display display--page">Take your seat.</h1>
        <p className="lede" style={{ marginTop: 16, fontSize: 17 }}>
          One account keeps your face on file, your matches gathered, and your
          downloads ready — across every community you join.
        </p>

        <form className="form-plate" onSubmit={handleSubmit}>
          {error && <p className="alert alert--error">{error}</p>}

          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="field-hint">At least 6 characters.</p>
          </div>

          <button type="submit" className="btn btn--dark btn--full" disabled={busy}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
          <p className="field-hint" style={{ marginTop: 16 }}>
            We&apos;ll email you a 6-digit code — your account is created only
            once you enter it.
          </p>

          <p className="field-hint" style={{ marginTop: 16 }}>
            Already in the index?{' '}
            <Link href="/login" className="link-underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </section>
  );
}
