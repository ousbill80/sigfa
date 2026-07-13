/**
 * NOTIF-005-B — client wrapper for the public ticket PWA route.
 *
 * Thin client boundary: the server page resolves the token + base URL and hands
 * them to {@link PwaShell}. No auth, no cookie, no PII in the RSC payload.
 *
 * @module app/q/[token]/pwa-page-client
 */
"use client";

import type { ReactElement } from "react";
import { PwaShell } from "@/components/pwa/PwaShell";
import type { PwaLocale } from "@/lib/pwa/pwa-i18n";

/** Props injected by the server page. */
export interface PwaPageClientProps {
  readonly token: string;
  readonly baseUrl: string;
  readonly initialLocale: PwaLocale;
}

/**
 * Renders the PWA shell for the resolved token.
 *
 * @param props - Token, base URL, initial locale.
 * @returns The client element.
 */
export function PwaPageClient({ token, baseUrl, initialLocale }: PwaPageClientProps): ReactElement {
  return <PwaShell token={token} baseUrl={baseUrl} initialLocale={initialLocale} />;
}
