/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      // Cloudflare R2 signed URLs — pattern covers any *.r2.dev / r2.cloudflarestorage.com host.
      { protocol: 'https', hostname: '**.r2.dev' },
      { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
      { protocol: 'https', hostname: '**' }, // R2_PUBLIC_URL is a custom domain, so keep this permissive in dev
    ],
  },
};

module.exports = nextConfig;
