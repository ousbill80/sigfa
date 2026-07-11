/**
 * TvScreen — full-screen call display for waiting rooms (TV-001).
 * Presentational: driven entirely by {@link TvState}; realtime is simulated
 * (RT-001 keeps sockets inactive). Tokens only — no hard-coded colours/sizes.
 * @module components/tv/tv-screen
 */
"use client";

import type { CSSProperties, ReactElement } from "react";
import { t, type Locale } from "@/lib/i18n";
import type { TvState, TvCall } from "@/lib/tv-state";
import { TV_PREVIOUS_COUNT } from "@/lib/tv-state";

/** Visible lifecycle state of the TV screen. */
export type TvViewState = "nominal" | "loading" | "empty";

/** Props for {@link TvScreen}. */
export interface TvScreenProps {
  /** Reduced state model driving the display. */
  state: TvState;
  /** Active locale for header/labels. */
  locale?: Locale;
  /** Tenant display name shown in the header. */
  tenantName?: string;
  /** Current wall-clock time rendered in the header (kept out of the component for testability). */
  clock?: string;
  /** Loading flag — renders a full-screen skeleton without a white flash. */
  loading?: boolean;
  /** TV-002: brand flash active on the hero for the celebration window. */
  celebration?: boolean;
  /** TV-002: reduced motion — disables the slide transition (instant swap). */
  reducedMotion?: boolean;
}

/** Root screen surface style — always on --surface-screen. */
const screenStyle: CSSProperties = {
  backgroundColor: "var(--surface-screen)",
  color: "var(--ink-inverse)",
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
};

/**
 * Renders a single previous-call card at the mandated --display-tv size.
 * @param call - The previous call to render.
 * @returns The card element.
 */
function PreviousCard({ call }: { call: TvCall }): ReactElement {
  return (
    <div
      data-testid="tv-previous-card"
      style={{
        borderRight: "1px solid var(--tv-separator)",
        padding: "0 2rem",
        fontSize: "var(--display-tv)",
        lineHeight: 1.1,
        color: "var(--ink-inverse)",
      }}
    >
      <div style={{ fontSize: "var(--display-tv)" }}>{call.displayNumber}</div>
      <div style={{ fontSize: "var(--caption)", color: "var(--ink-inverse)" }}>{call.counterLabel}</div>
    </div>
  );
}

/**
 * Full-screen TV call display.
 * @param props - {@link TvScreenProps}.
 * @returns The screen element.
 */
export function TvScreen({
  state,
  locale = "fr",
  tenantName = "",
  clock = "",
  loading = false,
  celebration = false,
  reducedMotion = false,
}: TvScreenProps): ReactElement {
  const isEmpty = state.hero === null;

  return (
    <div
      data-testid="tv-screen"
      data-state={loading ? "loading" : isEmpty ? "empty" : "nominal"}
      style={screenStyle}
    >
      {/* Header */}
      <header
        data-testid="tv-header"
        style={{
          height: "var(--tv-header-height)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 2rem",
          borderBottom: "1px solid var(--tv-separator)",
        }}
      >
        <span style={{ fontWeight: 600 }}>{tenantName}</span>
        <span style={{ letterSpacing: "0.1em" }}>{t("tv.title", locale)}</span>
        <span data-testid="tv-clock" aria-hidden={clock === ""}>
          {clock}
        </span>
      </header>

      {loading ? (
        <div
          data-testid="tv-skeleton"
          aria-busy="true"
          style={{
            flex: 1,
            backgroundColor: "var(--surface-screen)",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            padding: "2rem",
          }}
        >
          <div
            data-testid="tv-skeleton-hero"
            style={{
              height: "var(--display-tv-hero)",
              backgroundColor: "var(--tv-separator)",
              borderRadius: "0.5rem",
            }}
          />
          <div style={{ display: "flex", gap: "1rem" }}>
            {Array.from({ length: TV_PREVIOUS_COUNT }).map((_, i) => (
              <div
                key={i}
                style={{
                  height: "var(--display-tv-counter)",
                  flex: 1,
                  backgroundColor: "var(--tv-separator)",
                  borderRadius: "0.5rem",
                }}
              />
            ))}
          </div>
        </div>
      ) : (
        <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* Hero */}
          <section
            data-testid="tv-hero"
            data-celebration={celebration ? "on" : "off"}
            aria-live="polite"
            style={{
              minHeight: "var(--display-tv-hero)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              // TV-002: flash --brand pendant la fenêtre de célébration, sinon
              // retour à --surface-screen. Couleur 100% tokenisée (aucun dur).
              backgroundColor: celebration ? "var(--brand)" : "var(--surface-screen)",
              // TV-002: glissement héros→précédents en 250ms ; désactivé si
              // reduced-motion (changement d'état instantané).
              transition: reducedMotion
                ? "none"
                : "background-color var(--duration-celebration) linear, transform var(--tv-slide-duration) var(--tv-slide-ease)",
            }}
          >
            {isEmpty ? (
              <div
                data-testid="tv-empty"
                style={{ fontSize: "var(--display-tv)", color: "var(--ink-inverse)", textAlign: "center" }}
              >
                {t("tv.empty", locale)}
              </div>
            ) : (
              <>
                <div style={{ fontSize: "var(--display-tv-counter)", fontWeight: 600 }}>
                  {state.hero!.counterLabel} — {t("tv.now_serving", locale)}
                </div>
                <div
                  data-testid="tv-hero-number"
                  style={{ fontSize: "var(--display-tv-hero)", fontWeight: 600, lineHeight: 1 }}
                >
                  {state.hero!.displayNumber}
                </div>
                <div style={{ fontSize: "var(--display-tv)" }}>
                  {t("tv.please_proceed", locale)} {state.hero!.counterLabel}
                </div>
              </>
            )}
          </section>

          {/* Previous calls — always rendered at --display-tv, structure preserved */}
          <section data-testid="tv-previous" aria-label={t("tv.recent_calls", locale)}>
            <div style={{ padding: "0 2rem", fontSize: "var(--caption)" }}>{t("tv.recent_calls", locale)}</div>
            <div
              style={{
                display: "flex",
                minHeight: "var(--display-tv-counter)",
                alignItems: "center",
              }}
            >
              {state.previous.map((call) => (
                <PreviousCard key={`${call.displayNumber}-${call.calledAt}`} call={call} />
              ))}
            </div>
          </section>

          {/* Queue */}
          <section data-testid="tv-queue" aria-label={t("tv.waiting", locale)}>
            <div style={{ padding: "0 2rem", fontSize: "var(--caption)" }}>
              {t("tv.waiting", locale)} ({state.queue.length})
            </div>
            <div
              style={{
                display: "flex",
                gap: "1.5rem",
                padding: "0 2rem",
                fontSize: "var(--display-tv)",
                overflow: "hidden",
              }}
            >
              {state.queue.map((n) => (
                <span key={n}>{n}</span>
              ))}
            </div>
          </section>
        </main>
      )}

      {/* Offline banner — discreet, keeps last known state visible */}
      {state.connection === "offline" && (
        <div
          data-testid="tv-offline-banner"
          role="status"
          aria-live="polite"
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "var(--warning)",
            color: "var(--surface-screen)",
            textAlign: "center",
            fontSize: "var(--caption)",
          }}
        >
          {t("tv.offline", locale)}
        </div>
      )}
    </div>
  );
}
