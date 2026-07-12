/**
 * KIOSK-001 — i18n/routing.ts
 * Configuration du routage next-intl pour les 2 langues SIGFA (décision PO :
 * FR/EN uniquement ; Dioula et Baoulé retirés).
 */
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["fr", "en"] as const,
  defaultLocale: "fr",
});

export type Locale = (typeof routing.locales)[number];
