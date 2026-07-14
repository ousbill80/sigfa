/**
 * NOTIF-005-B — public PWA route `/q/[token]` (reached via the agency QR).
 *
 * PUBLIC, NO AUTH: the `[token]` segment is the signed agency token encoded in
 * the QR (`qrUrl`, NOTIF-005-A). The server never reads a cookie or JWT here —
 * the token is passed to the client shell which resolves it (humane error on
 * invalid/expired) and drives the 3-step flow against the public API. The
 * internal ticket uuid is never exposed; only the trackingId is used.
 *
 * @module app/q/[token]/page
 */
import type { ReactElement } from "react";
import type { Metadata } from "next";
import { PwaPageClient } from "@/app/q/[token]/pwa-page-client";
import { PWA_LOCALES, type PwaLocale } from "@/lib/pwa/pwa-i18n";
import { BROWSER_API_BASE } from "@/lib/browser-api";

/** PWA metadata + manifest link (installable, never required). */
export const metadata: Metadata = {
  title: "SIGFA — Mon ticket",
  description: "Prenez et suivez votre ticket en agence.",
  manifest: "/manifest.webmanifest",
  themeColor: "#C25A16",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "SIGFA" },
};

/**
 * Public API base for the browser: ALWAYS the same-origin `/api/rt` proxy
 * (lib/browser-api). The public flow carries no cookie, so the proxy forwards
 * without a Bearer in real mode — and rebases onto the Prism mock in mock
 * mode. Direct cross-origin calls are forbidden (no CORS on the real API).
 */
function resolveBaseUrl(): string {
  return BROWSER_API_BASE;
}

/** Normalizes the optional `?lang=` query into a supported locale. */
function resolveLocale(raw: string | string[] | undefined): PwaLocale {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return PWA_LOCALES.includes(value as PwaLocale) ? (value as PwaLocale) : "fr";
}

/**
 * Public PWA page.
 *
 * @param props - Route params (token) + search params (optional lang).
 * @returns The page element.
 */
export default async function PwaTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const { token } = await params;
  const search = await searchParams;
  return (
    <PwaPageClient
      token={decodeURIComponent(token)}
      baseUrl={resolveBaseUrl()}
      initialLocale={resolveLocale(search.lang)}
    />
  );
}
