/**
 * KIOSK-001 — middleware.ts
 * Middleware next-intl pour la gestion des locales.
 */
import createMiddleware from "next-intl/middleware";
// Import sans extension .js — convention Next.js 15 (bundler ne résout pas .js→.ts)
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  matcher: [
    // Paths qui nécessitent la localisation
    "/((?!_next|_vercel|.*\\..*).*)",
  ],
};
