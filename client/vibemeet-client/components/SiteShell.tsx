'use client';

import { usePathname } from 'next/navigation';
import Nav from '@/components/Nav';

export default function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === '/register/verify') {
    return <main className="page-main">{children}</main>;
  }

  return (
    <div className="page-shell">
      <Nav />
      <main className="page-main">{children}</main>
      <footer className="colophon">
        <div className="container colophon__row">
          <span className="colophon__mark">VibeMeet — a photographic index of the night</span>
          <span className="colophon__note">Set in Fraunces &middot; Paper, ink and oxblood</span>
        </div>
      </footer>
    </div>
  );
}
