import type { NextConfig } from "next";
import { resolve } from "node:path";

/** Minimal webpack config surface we mutate (avoids a direct `webpack` dep). */
interface WebpackConfigLike {
  resolve?: { alias?: Record<string, string> };
}

/**
 * The @sigfa/contracts package barrel re-exports OPENAPI_PATHS, which pulls in
 * node:url / node:path and cannot be bundled for the browser. Alias the bare
 * specifier to a browser-safe entry re-exporting only the realtime events +
 * typed client factory (both node-free). (turbo builds ^contracts before web.)
 */
const CONTRACTS_ENTRY = resolve(__dirname, "./src/lib/contracts-entry.ts");

const nextConfig: NextConfig = {
  // Strict mode for React 19
  reactStrictMode: true,
  // Experimental features for Next.js 15
  experimental: {
    // Server actions enabled by default in Next.js 15
  },
  webpack(config: WebpackConfigLike): WebpackConfigLike {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@sigfa/contracts": CONTRACTS_ENTRY,
    };
    return config;
  },
};

export default nextConfig;
