/**
 * TvScreen — full-screen call display for waiting rooms (TV-001 + AdZone).
 *
 * Présentation « salle d'attente premium » sur grand écran mural 16:9 :
 * - État APPEL (`mode="call"`) : en-tête banque (logo/nom thémable + horloge),
 *   scène principale = guichet + numéro géant appelé (halo or, entrée « ding »),
 *   rail latéral persistant = derniers appelés (en retrait) + longueur de file.
 * - État REPOS (`mode="rest"`) : {@link AdZone} plein écran (carrousel média
 *   banque) au lieu d'un écran vide.
 *
 * Présentationnel : piloté entièrement par {@link TvState} + `mode`. La logique
 * temps réel (consommation d'événements / sync / contrat) est INCHANGÉE : ce
 * composant ne fait qu'afficher. Tokens uniquement — aucune couleur/taille en dur.
 * @module components/tv/tv-screen
 */
"use client";

import type { CSSProperties, ReactElement } from "react";
import { t, type Locale } from "@/lib/i18n";
import type { TvState, TvCall } from "@/lib/tv-state";
import { TV_PREVIOUS_COUNT } from "@/lib/tv-state";
import { AdZone } from "./ad-zone";
import type { AdSlide } from "@/lib/ad-slides";
import type { TvMode } from "@/lib/use-tv-mode";

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
  /**
   * Top-level mode: `rest` shows the AdZone, `call` shows the call scene.
   * Defaults to `call` when a hero is present, else `rest` (backward-compatible).
   */
  mode?: TvMode;
  /** Configurable ad slides for the rest-state AdZone (defaults to demo slides). */
  adSlides?: readonly AdSlide[];
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
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "var(--space-4)",
        padding: "var(--space-3) 0",
        borderBottom: "1px solid var(--tv-separator)",
        fontSize: "var(--display-tv)",
        lineHeight: "var(--leading-tight)",
        color: "var(--ink-inverse-soft)",
      }}
    >
      <span
        style={{
          fontSize: "var(--display-tv)",
          fontFamily: "var(--font-display)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "var(--tracking-numeric)",
          color: "var(--ink-inverse-soft)",
        }}
      >
        {call.displayNumber}
      </span>
      <span style={{ fontSize: "var(--text-lg)", color: "var(--ink-inverse-soft)" }}>{call.counterLabel}</span>
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
  mode,
  adSlides,
}: TvScreenProps): ReactElement {
  const isEmpty = state.hero === null;
  // Mode par défaut : `call` s'il y a un héros (rétro-compatible avec TV-001),
  // sinon `rest`. Le loading garde la priorité (skeleton).
  const resolvedMode: TvMode = mode ?? (isEmpty ? "rest" : "call");
  const showAdZone = !loading && resolvedMode === "rest";

  return (
    <div
      data-testid="tv-screen"
      data-mode={loading ? "loading" : resolvedMode}
      data-state={loading ? "loading" : isEmpty ? "empty" : "nominal"}
      style={screenStyle}
    >
      {loading ? (
        <>
          <TvHeader tenantName={tenantName} locale={locale} clock={clock} />
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
        </>
      ) : showAdZone ? (
        <AdZone
          slides={adSlides}
          locale={locale}
          tenantName={tenantName}
          clock={clock}
          active
          reducedMotion={reducedMotion}
        />
      ) : (
        <>
          <TvHeader tenantName={tenantName} locale={locale} clock={clock} />
          <main style={{ flex: 1, display: "flex", minHeight: 0 }}>
            {/* Scène principale — le « Moment Ticket » : guichet + numéro géant */}
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
                backgroundColor: celebration ? "var(--brand)" : "var(--surface-screen)",
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
                      // Halo « Moment Ticket » — cerclage or premium (« ding » visuel).
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

            {/* Rail latéral persistant — derniers appelés + longueur de file */}
            <aside
              data-testid="tv-rail"
              style={{
                width: "22vw",
                minWidth: "var(--space-24)",
                borderLeft: "1px solid var(--tv-separator)",
                display: "flex",
                flexDirection: "column",
                padding: "var(--space-8) var(--space-8)",
                gap: "var(--space-6)",
                flexShrink: 0,
              }}
            >
              <section data-testid="tv-previous" aria-label={t("tv.recent_calls", locale)}>
                <div
                  style={{
                    fontSize: "var(--text-md)",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--ink-inverse-soft)",
                    marginBottom: "var(--space-3)",
                  }}
                >
                  {t("tv.recent_calls", locale)}
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {state.previous.map((call) => (
                    <PreviousCard key={`${call.displayNumber}-${call.calledAt}`} call={call} />
                  ))}
                </div>
              </section>

              {/* Longueur de file — encre secondaire, valeur mise en avant */}
              <section
                data-testid="tv-queue"
                aria-label={t("tv.waiting", locale)}
                style={{ marginTop: "auto", borderTop: "1px solid var(--tv-separator)", paddingTop: "var(--space-6)" }}
              >
                <div
                  style={{
                    fontSize: "var(--text-md)",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--ink-inverse-soft)",
                  }}
                >
                  {t("tv.waiting", locale)}
                </div>
                <div
                  data-testid="tv-queue-count"
                  style={{
                    fontSize: "var(--display-tv-counter)",
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                    lineHeight: "var(--leading-tight)",
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: "var(--tracking-numeric)",
                    color: "var(--gold)",
                  }}
                >
                  {state.queue.length}
                </div>
              </section>
            </aside>
          </main>
        </>
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

/** Bank header — logo mark (thémable --brand) + name + clock, en retrait. */
function TvHeader({
  tenantName,
  locale,
  clock,
}: {
  tenantName: string;
  locale: Locale;
  clock: string;
}): ReactElement {
  return (
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
      <span style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        {/* Pastille logo — accent marque thémable par banque */}
        <span
          data-testid="tv-brand-mark"
          aria-hidden="true"
          style={{
            width: "var(--space-6)",
            height: "var(--space-6)",
            borderRadius: "var(--r-full)",
            backgroundColor: "var(--brand)",
            boxShadow: "var(--shadow-gold)",
          }}
        />
        <span style={{ fontWeight: 600, color: "var(--ink-inverse)" }}>{tenantName}</span>
      </span>
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
  );
}
