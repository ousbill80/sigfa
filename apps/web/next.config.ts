import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Strict mode for React 19
  reactStrictMode: true,
  // Experimental features for Next.js 15
  experimental: {
    // Server actions enabled by default in Next.js 15
  },
};

export default nextConfig;
