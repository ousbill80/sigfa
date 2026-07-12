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

/**
 * Root screen surface — v2 « Sérénité Premium » projected board.
 * Background sits on --night-2 (max-contrast dark) but keeps a --surface-screen
 * fallback so the token contract (and the "no white flash" guarantee) holds.
 */
const screenStyle: CSSProperties = {
  backgroundColor: "var(--night-2, var(--surface-screen))",
  color: "var(--ink-inverse)",
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  fontFamily: "var(--font-text)",
};

/**
 * Renders a single previous-call card at the mandated --display-tv size.
 * Recent calls are in retreat: --ink-inverse-soft, tabular --font-display digits.
 * @param call - The previous call to render.
 * @returns The card element.
 */
function PreviousCard({ call }: { call: TvCall }): ReactElement {
  return (
    <div
      data-testid="tv-previous-card"
      style={{
        borderRight: "1px solid var(--tv-separator)",
        padding: "0 var(--space-8)",
        fontSize: "var(--display-tv)",
        lineHeight: "var(--leading-tight)",
        color: "var(--ink-inverse-soft)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
      }}
    >
      <div
        style={{
          fontSize: "var(--display-tv)",
          fontFamily: "var(--font-display)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "var(--tracking-numeric)",
          color: "var(--ink-inverse-soft)",
        }}
      >
        {call.displayNumber}
      </div>
      <div style={{ fontSize: "var(--text-lg)", color: "var(--ink-inverse-soft)" }}>{call.counterLabel}</div>
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
      {/* Header — sobre, en retrait sur le fond nuit */}
      <header
        data-testid="tv-header"
        style={{
          height: "var(--tv-header-height)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-12)",
          borderBottom: "1px solid var(--tv-separator)",
          color: "var(--ink-inverse-soft)",
          fontSize: "var(--text-lg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--ink-inverse)" }}>{tenantName}</span>
        <span style={{ letterSpacing: "0.18em", textTransform: "uppercase", fontSize: "var(--text-md)" }}>
          {t("tv.title", locale)}
        </span>
        <span
          data-testid="tv-clock"
          aria-hidden={clock === ""}
          style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "var(--tracking-numeric)" }}
        >
          {clock}
        </span>
      </header>

      {loading ? (
        <div
          data-testid="tv-skeleton"
          aria-busy="true"
          style={{
            flex: 1,
            backgroundColor: "var(--night-2, var(--surface-screen))",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-6)",
            padding: "var(--space-12)",
          }}
        >
          <div
            data-testid="tv-skeleton-hero"
            style={{
              height: "var(--display-tv-hero)",
              backgroundColor: "var(--tv-separator)",
              borderRadius: "var(--r-xl)",
            }}
          />
          <div style={{ display: "flex", gap: "var(--space-6)" }}>
            {Array.from({ length: TV_PREVIOUS_COUNT }).map((_, i) => (
              <div
                key={i}
                style={{
                  height: "var(--display-tv-counter)",
                  flex: 1,
                  backgroundColor: "var(--tv-separator)",
                  borderRadius: "var(--r-lg)",
                }}
              />
            ))}
          </div>
        </div>
      ) : (
        <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* Hero — le « Moment Ticket » : numéro servi géant en --brand,
              cerclé d'un halo --gold (--shadow-gold) pour l'instant fort. */}
          <section
            data-testid="tv-hero"
            data-celebration={celebration ? "on" : "off"}
            aria-live="polite"
            style={{
              flex: 1,
              minHeight: "var(--display-tv-hero)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--space-4)",
              padding: "var(--space-12) var(--space-8)",
              // TV-002: flash --brand pendant la fenêtre de célébration, sinon
              // retour au fond nuit (--surface-screen conservé pour le contrat).
              backgroundColor: celebration ? "var(--brand)" : "var(--surface-screen)",
              // TV-002: glissement héros→précédents ; désactivé si reduced-motion.
              transition: reducedMotion
                ? "none"
                : "background-color var(--duration-celebration) linear, transform var(--tv-slide-duration) var(--tv-slide-ease)",
            }}
          >
            {isEmpty ? (
              <div
                data-testid="tv-empty"
                style={{
                  fontSize: "var(--display-tv)",
                  color: "var(--ink-inverse-soft)",
                  textAlign: "center",
                  fontFamily: "var(--font-display)",
                }}
              >
                {t("tv.empty", locale)}
              </div>
            ) : (
              <>
                <div
                  style={{
                    fontSize: "var(--text-3xl)",
                    fontWeight: 600,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: celebration ? "var(--ink-inverse)" : "var(--gold)",
                  }}
                >
                  {state.hero!.counterLabel} — {t("tv.now_serving", locale)}
                </div>
                <div
                  data-testid="tv-hero-number"
                  style={{
                    fontSize: "var(--display-tv-hero)",
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                    lineHeight: "var(--leading-tight)",
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: "var(--tracking-numeric)",
                    color: celebration ? "var(--ink-inverse)" : "var(--brand)",
                    padding: "var(--space-6) var(--space-16)",
                    borderRadius: "var(--r-xl)",
                    // Halo « Moment Ticket » — cerclage or premium.
                    boxShadow: "var(--shadow-gold)",
                  }}
                >
                  {state.hero!.displayNumber}
                </div>
                <div style={{ fontSize: "var(--text-3xl)", color: "var(--ink-inverse-soft)" }}>
                  {t("tv.please_proceed", locale)} {state.hero!.counterLabel}
                </div>
              </>
            )}
          </section>

          {/* Previous calls — en retrait (--ink-inverse-soft), structure préservée */}
          <section
            data-testid="tv-previous"
            aria-label={t("tv.recent_calls", locale)}
            style={{ borderTop: "1px solid var(--tv-separator)", paddingTop: "var(--space-6)" }}
          >
            <div
              style={{
                padding: "0 var(--space-12)",
                fontSize: "var(--text-md)",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--ink-inverse-soft)",
              }}
            >
              {t("tv.recent_calls", locale)}
            </div>
            <div
              style={{
                display: "flex",
                minHeight: "var(--display-tv-counter)",
                alignItems: "center",
                padding: "0 var(--space-4)",
              }}
            >
              {state.previous.map((call) => (
                <PreviousCard key={`${call.displayNumber}-${call.calledAt}`} call={call} />
              ))}
            </div>
          </section>

          {/* Queue — file d'attente, encre secondaire discrète */}
          <section
            data-testid="tv-queue"
            aria-label={t("tv.waiting", locale)}
            style={{
              borderTop: "1px solid var(--tv-separator)",
              paddingTop: "var(--space-6)",
              paddingBottom: "var(--space-8)",
            }}
          >
            <div
              style={{
                padding: "0 var(--space-12)",
                fontSize: "var(--text-md)",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--ink-inverse-soft)",
              }}
            >
              {t("tv.waiting", locale)} ({state.queue.length})
            </div>
            <div
              style={{
                display: "flex",
                gap: "var(--space-8)",
                padding: "var(--space-4) var(--space-12) 0",
                fontSize: "var(--display-tv)",
                fontFamily: "var(--font-display)",
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "var(--tracking-numeric)",
                color: "var(--ink-inverse-soft)",
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

      {/* Offline banner — discret, --info neutre, dernier état conservé */}
      {state.connection === "offline" && (
        <div
          data-testid="tv-offline-banner"
          role="status"
          aria-live="polite"
          style={{
            padding: "var(--space-2) var(--space-4)",
            backgroundColor: "var(--info)",
            color: "var(--ink-inverse)",
            textAlign: "center",
            fontSize: "var(--text-md)",
            letterSpacing: "0.08em",
            flexShrink: 0,
          }}
        >
          {t("tv.offline", locale)}
        </div>
      )}
    </div>
  );
}
