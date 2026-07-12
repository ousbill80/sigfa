/**
 * KIOSK-001 — next.config.ts
 * Configuration Next.js 15 avec next-intl et output export pour Electron.
 *
 * STRATÉGIE D'IMPORTS (fix KIOSK-001):
 * Tous les imports internes de l'app utilisent la convention Next.js standard :
 * PAS d'extension .js sur les imports de modules TypeScript locaux.
 * Raison : le bundler Next.js 15 (webpack / turbopack) ne résout PAS .js → .ts/.tsx
 * comme le fait Node.js en mode NodeNext/ESM. L'extension .js est réservée aux
 * fichiers vraiment compilés en JS (dist/). Pour les sources TypeScript, on omit
 * l'extension et le bundler résout automatiquement .ts / .tsx / /index.ts.
 * Référence : https://nextjs.org/docs/app/building-your-application/configuring/typescript
 */
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * En mode test visuel Playwright, on désactive output:"export" et trailingSlash
 * pour que le middleware next-intl fonctionne correctement.
 * Invoquer avec SIGFA_PLAYWRIGHT=1 pnpm dev (ou via playwright.config.ts webServer).
 */
const isPlaywrightMode = process.env.SIGFA_PLAYWRIGHT === "1";

const nextConfig: NextConfig = {
  ...(isPlaywrightMode ? {} : { output: "export", trailingSlash: true }),
  // @sigfa/ui ships TypeScript source (source-exported workspace package) plus
  // CSS + self-hosted woff2 fonts; Next must transpile it (like apps/web).
  transpilePackages: ["@sigfa/ui"],
  images: {
    unoptimized: true,
  },
  webpack(config) {
    // Alias @sigfa/contracts to the compiled client.js for webpack bundler
    // (same resolution as vitest alias in vitest.config.ts)
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
