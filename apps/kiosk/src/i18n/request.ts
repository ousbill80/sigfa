/**
 * KIOSK-001 — i18n/request.ts
 * Configuration de next-intl pour les Server Components.
 */
import { getRequestConfig } from "next-intl/server";
import type { AbstractIntlMessages } from "next-intl";
import { routing } from "./routing.js";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  // Valider que la locale est supportée
  if (!locale || !routing.locales.includes(locale as (typeof routing.locales)[number])) {
    locale = routing.defaultLocale;
  }

  const messages = (
    await import(`../../messages/${locale}.json`, { with: { type: "json" } })
  ).default as AbstractIntlMessages;

  return {
    locale,
    messages,
  };
});
