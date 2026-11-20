'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export default function Nav() {
  const { user, ready, logout } = useAuth();
  const router = useRouter();

  function handleSignOut() {
    logout();
    router.replace('/');
  }

  return (
    <header className="masthead">
      <div className="container masthead__row">
        <div>
          <Link href="/" className="wordmark">
            VibeMeet
          </Link>
          <div className="masthead__tag">A photographic index of the night</div>
        </div>
        <nav className="masthead__nav" aria-label="Primary">
          <Link href="/communities" className="masthead__link">
            Index
          </Link>
          {ready && user && (
            <Link href="/me" className="masthead__link">
              My Photos
            </Link>
          )}
          {ready && user ? (
            <>
              <span className="masthead__divider" aria-hidden="true" />
              <span className="masthead__account">
                <span className="masthead__avatar" aria-hidden="true">
                  {user.username.charAt(0).toUpperCase()}
                </span>
                <span className="masthead__name">{user.username}</span>
              </span>
              <button className="masthead__signout" onClick={handleSignOut} type="button">
                Sign out
              </button>
            </>
          ) : ready ? (
            <>
              <Link href="/register" className="btn btn--dark btn--sm">
                Join
              </Link>
              <Link href="/login" className="masthead__link">
                Sign in
              </Link>
            </>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
