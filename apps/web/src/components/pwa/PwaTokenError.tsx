/**
 * NOTIF-005-B — humane error screen for an invalid or expired QR token.
 *
 * The signed agency token is verified server-side on emission; this screen is
 * the CLIENT-side humane fallback (no white screen) when the token is obviously
 * malformed or past its `exp`. Zero PII, zero stack trace.
 *
 * @module components/pwa/PwaTokenError
 */
"use client";

import type { ReactElement } from "react";
import { EmptyState } from "@sigfa/ui";
import { pt, type PwaLocale } from "@/lib/pwa/pwa-i18n";

/** Which token problem to communicate. */
export type TokenErrorKind = "invalid" | "expired";

/** Props for {@link PwaTokenError}. */
export interface PwaTokenErrorProps {
  readonly kind: TokenErrorKind;
  readonly locale: PwaLocale;
}

/**
 * Renders the QR token error screen.
 *
 * @param props - Error kind + locale.
 * @returns The error element.
 */
export function PwaTokenError({ kind, locale }: PwaTokenErrorProps): ReactElement {
  const titleKey = kind === "expired" ? "pwa.token.expired_title" : "pwa.token.invalid_title";
  const bodyKey = kind === "expired" ? "pwa.token.expired_body" : "pwa.token.invalid_body";
  return (
    <main
      data-testid="pwa-token-error"
      role="main"
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-6)",
        backgroundColor: "var(--paper)",
      }}
    >
      <EmptyState
        title={pt(titleKey, locale)}
        description={pt(bodyKey, locale)}
        style={{ maxWidth: "28rem" }}
      />
    </main>
  );
}
