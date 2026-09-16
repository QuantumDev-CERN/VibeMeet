import { Barlow_Condensed, Work_Sans } from 'next/font/google';
import { AuthProvider } from '@/components/AuthProvider';
import Nav from '@/components/Nav';
import './globals.css';

const display = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-display',
  display: 'swap',
});

const body = Work_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata = {
  title: 'VibeMeet',
  description: 'Find yourself in the crowd. Community event photos, searchable by face.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <AuthProvider>
          <div className="page-shell">
            <Nav />
            <main className="page-main">{children}</main>
            <footer className="site-footer">
              <span>VibeMeet</span>
              <span className="site-footer__sep" aria-hidden="true" />
              <span>Your face never leaves a thread it wasn&apos;t searched in.</span>
            </footer>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
