/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '9000' },
      { protocol: 'http', hostname: '127.0.0.1', port: '9000' },
      { protocol: 'https', hostname: '**.backblazeb2.com' },

      { protocol: 'https', hostname: '**' }, 
    ],
  },
};

module.exports = nextConfig;
