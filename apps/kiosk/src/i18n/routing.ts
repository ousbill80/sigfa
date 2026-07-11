/**
 * KIOSK-001 — i18n/routing.ts
 * Configuration du routage next-intl pour les 4 langues SIGFA.
 */
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["fr", "dioula", "baoule", "en"] as const,
  defaultLocale: "fr",
});

export type Locale = (typeof routing.locales)[number];
