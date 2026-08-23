/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@storywriter/types'],
  async rewrites() {
    // Server-side proxy target. In Docker this must be the api service name
    // (INTERNAL_API_URL), while the browser uses NEXT_PUBLIC_API_URL directly.
    const api =
      process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    return [
      {
        source: '/api/:path*',
        destination: `${api}/:path*`,
      },
    ];
  },
};

export default nextConfig;
