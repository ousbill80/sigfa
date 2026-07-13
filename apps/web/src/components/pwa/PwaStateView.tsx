/**
 * NOTIF-005-B — canonical 5-state view for the PWA (design v2).
 *
 * Renders the loading / empty / error / offline states with premium tokens from
 * `@sigfa/ui`. The nominal state is rendered by each screen directly; this
 * component covers the four non-nominal states so every screen honours the
 * "5 états" design rule with humane, localized copy. Zero emoji.
 *
 * @module components/pwa/PwaStateView
 */
"use client";

import type { ReactElement } from "react";
import { Button, EmptyState, OfflineBanner, Skeleton } from "@sigfa/ui";
import { pt, type PwaLocale } from "@/lib/pwa/pwa-i18n";

/** Non-nominal states this component can render. */
export type PwaViewState = "loading" | "empty" | "error" | "offline";

/** Props for {@link PwaStateView}. */
export interface PwaStateViewProps {
  readonly state: PwaViewState;
  readonly locale: PwaLocale;
  /** Retry handler for the error state (renders the retry button when set). */
  readonly onRetry?: () => void;
}

/**
 * Renders a non-nominal PWA state.
 *
 * @param props - State, locale, optional retry.
 * @returns The state element.
 */
export function PwaStateView({ state, locale, onRetry }: PwaStateViewProps): ReactElement {
  if (state === "loading") {
    return (
      <div data-testid="pwa-state-loading" role="status" aria-live="polite" aria-busy="true">
        <span
          style={{
            display: "block",
            marginBottom: "var(--space-4)",
            color: "var(--ink-soft)",
            fontSize: "var(--text-md)",
          }}
        >
          {pt("pwa.state.loading", locale)}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <Skeleton height="1.5rem" width="60%" />
          <Skeleton height="4rem" />
          <Skeleton height="2.5rem" width="80%" />
        </div>
      </div>
    );
  }

  if (state === "offline") {
    return (
      <OfflineBanner data-testid="pwa-state-offline" message={pt("pwa.state.offline", locale)}>
        <span style={{ color: "var(--ink-soft)", fontSize: "var(--text-sm)" }}>
          {pt("pwa.state.offline_hint", locale)}
        </span>
      </OfflineBanner>
    );
  }

  if (state === "error") {
    return (
      <div data-testid="pwa-state-error" role="alert">
        <EmptyState
          title={pt("pwa.state.error", locale)}
          action={
            onRetry ? (
              <Button variant="primary" onClick={onRetry}>
                {pt("pwa.state.error_action", locale)}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  // empty
  return (
    <div data-testid="pwa-state-empty">
      <EmptyState title={pt("pwa.state.empty", locale)} />
    </div>
  );
}
