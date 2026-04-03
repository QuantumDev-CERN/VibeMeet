export const metadata = {
  title: "VibeMeet",
  description: "Community meetups and photo discovery platform."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
