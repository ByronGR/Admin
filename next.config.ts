import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Server-enabled Next.js (not static export) so /api routes work on Vercel.
  // Pages remain client-rendered ('use client'); only /api/* become serverless
  // functions — currently 1 (send-invite), well within Vercel limits.
  trailingSlash: false,
};

export default nextConfig;
