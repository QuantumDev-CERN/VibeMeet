/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      // Local MinIO (docker-compose) serves over plain http on :9000.
      // The '**' https pattern below does NOT cover it — next/image matches on
      // protocol too, so without these two entries every dev thumbnail 400s
      // with "hostname is not configured under images".
      { protocol: 'http', hostname: 'localhost', port: '9000' },
      { protocol: 'http', hostname: '127.0.0.1', port: '9000' },

      // Backblaze B2: f00X.backblazeb2.com serves public objects,
      // s3.<region>.backblazeb2.com serves presigned URLs.
      { protocol: 'https', hostname: '**.backblazeb2.com' },

      { protocol: 'https', hostname: '**' }, // S3_PUBLIC_URL may be a custom domain — permissive in dev
    ],
  },
};

module.exports = nextConfig;
