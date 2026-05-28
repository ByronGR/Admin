import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export', // static export — zero Next.js serverless functions (stays within Vercel Hobby 12-function limit)
  trailingSlash: false,
};

export default nextConfig;
