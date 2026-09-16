'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';

export default function Nav() {
  const { user, ready, logout } = useAuth();

  return (
    <header className="nav">
      <div className="container nav__row">
        <Link href="/" className="nav__mark">
          Vibe<span>Meet</span>
        </Link>
        <nav className="nav__links">
          <Link href="/" className="nav__link">
            Communities
          </Link>
          {ready && user && (
            <Link href="/me" className="nav__link">
              My photos
            </Link>
          )}
          {ready && user ? (
            <>
              <span className="nav__user">
                Signed in as <strong>{user.username}</strong>
              </span>
              <button className="btn btn--ghost btn--sm" onClick={logout} type="button">
                Log out
              </button>
            </>
          ) : ready ? (
            <>
              <Link href="/login" className="nav__link">
                Log in
              </Link>
              <Link href="/register" className="btn btn--primary btn--sm">
                Sign up
              </Link>
            </>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
