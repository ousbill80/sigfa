/**
 * KIOSK-005 — next.config.playwright.ts
 * Configuration Next.js pour les tests visuels Playwright.
 *
 * DIFFÉRENCES avec next.config.ts :
 *   - output: "export" supprimé → le serveur de dev/tests fonctionne avec middleware
 *   - trailingSlash: false → URLs sans slash final (cohérent avec Playwright)
 *
 * Utilisé UNIQUEMENT par `pnpm test:visual` via NEXT_CONFIG=playwright.
 */
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Pas d'output export — le serveur dev Playwright doit fonctionner avec middleware
  images: {
    unoptimized: true,
  },
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, string>),
      "@sigfa/contracts": resolve(
        __dirname,
        "../../packages/contracts/dist/src/client.js"
      ),
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
