/**
 * KIOSK-001 — middleware.ts
 * Middleware next-intl pour la gestion des locales.
 */
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing.js";

export default createMiddleware(routing);

export const config = {
  matcher: [
    // Paths qui nécessitent la localisation
    "/((?!_next|_vercel|.*\\..*).*)",
  ],
};
