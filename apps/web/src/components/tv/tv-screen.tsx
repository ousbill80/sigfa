/**
 * TvScreen — écran TV « split permanent » pour salles d'attente (TV v3).
 *
 * Design-gate PO 2026-07-13 (photo de référence BNI, option « flash dans la
 * colonne ») : plus de modes exclusifs appel/pub — les deux zones vivent
 * ensemble en permanence :
 * - **Bandeau haut** (--tv-header-height, fond --brand) : pastille logo + nom
 *   banque/agence à gauche · date complète FR/EN au centre · horloge en bloc
 *   contrasté à droite (grande, tabular-nums).
 * - **Zone gauche ~75 %** : {@link AdZone} (carrousel banque) active EN
 *   PERMANENCE — la pub n'est JAMAIS interrompue par un appel.
 * - **Colonne droite ~25 %** (fond --night-2) : carte appel courant (flash
 *   --brand + halo pendant la fenêtre de célébration TV-002), derniers appelés
 *   en retrait, longueur de file en bas.
 *
 * TV-V3-FIX (retour visuel PO sur capture réelle 16:9) : le numéro courant
 * tient sur UNE ligne (clamp sur la largeur de colonne, bornes en tokens),
 * l'historique est DISCRET (une ligne « OC-046 · Guichet 1 », --text-2xl /
 * --text-md), la liste est bornée dans un espace flexible (overflow hidden) et
 * « En attente » est ancré en bas dans son espace réservé — aucun
 * chevauchement, la colonne ne scrolle jamais (720p → 4K).
 *
 * Présentationnel : piloté entièrement par {@link TvState}. La logique temps
 * réel (consommation d'événements / sync / contrat) est INCHANGÉE : ce
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
  /** Full localized date (FR/EN) shown at the center of the top banner. */
  dateLabel?: string;
  /** Loading flag — renders a split-adapted skeleton without a white flash. */
  loading?: boolean;
  /** TV-002: brand flash active on the current-call card for the celebration window. */
  celebration?: boolean;
  /** TV-002: reduced motion — disables transitions (instant swap). */
  reducedMotion?: boolean;
  /** Configurable ad slides for the permanent AdZone (defaults to demo slides). */
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
  height: "100vh",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  fontFamily: "var(--font-text)",
};

/** Split permanent : pub ~75 % à gauche, colonne d'appels ~25 % à droite. */
const splitStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1fr)",
};

/**
 * Colonne d'appels — fond sombre dédié + séparateur token.
 * TV-V3-FIX : conteneur de taille (`container-type: inline-size`) — le numéro
 * courant se clampe sur la largeur RÉELLE de la colonne (unités cqw), donc une
 * seule ligne à 720p comme en 4K. `overflow: hidden` : la colonne ne scrolle
 * jamais, rien ne peut déborder de l'écran.
 */
const columnStyle: CSSProperties = {
  backgroundColor: "var(--night-2, var(--surface-screen))",
  borderLeft: "1px solid var(--tv-separator)",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  padding: "var(--space-6)",
  gap: "var(--space-6)",
  overflow: "hidden",
  containerType: "inline-size",
};

/**
 * TV-V3-FIX (retour visuel PO) : taille du numéro courant ADAPTÉE à la largeur
 * de colonne — bornes en tokens (`--text-4xl` plancher de lisibilité, plafond
 * `--display-tv-counter`), pente en largeur de conteneur : « XX-999 » tient
 * toujours sur UNE ligne dans la colonne ~25 %, tout en restant l'info
 * dominante de l'écran (lisible à 6-8 m).
 */
const HERO_NUMBER_FONT_SIZE = "clamp(var(--text-4xl), 22cqw, var(--display-tv-counter))";

/**
 * Renders a single previous-call entry — DISCRÈTE (retour visuel PO, réf. BNI) :
 * une seule ligne « OC-046 · Guichet 1 », numéro en --text-2xl max, guichet en
 * --text-md, le tout en retrait (--ink-inverse-soft). L'appel courant reste le
 * seul élément dominant de la colonne.
 * @param call - The previous call to render.
 * @returns The card element.
 */
function PreviousCard({ call }: { call: TvCall }): ReactElement {
  return (
    <div
      data-testid="tv-previous-card"
      style={{
        padding: "var(--space-2) 0",
        borderBottom: "1px solid var(--tv-separator)",
        lineHeight: "var(--leading-tight)",
        color: "var(--ink-inverse-soft)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        flexShrink: 0,
      }}
    >
      <span
        data-testid="tv-previous-number"
        style={{
          fontSize: "var(--text-2xl)",
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "var(--tracking-numeric)",
          color: "var(--ink-inverse-soft)",
        }}
      >
        {call.displayNumber}
      </span>
      <span aria-hidden="true" style={{ color: "var(--ink-inverse-soft)" }}>
        {" · "}
      </span>
      <span data-testid="tv-previous-counter" style={{ fontSize: "var(--text-md)", color: "var(--ink-inverse-soft)" }}>
        {call.counterLabel}
      </span>
    </div>
  );
}

/**
 * Carte « appel courant » en tête de colonne. Au nouvel appel (celebration),
 * la carte passe sur fond --brand avec halo or (mécanique TV-002 conservée),
 * puis revient au repos — la pub à gauche n'est jamais interrompue.
 * @param props - Hero call (or null), locale, celebration and motion flags.
 * @returns The current-call card element.
 */
function CurrentCallCard({
  hero,
  locale,
  celebration,
  reducedMotion,
}: {
  hero: TvCall | null;
  locale: Locale;
  celebration: boolean;
  reducedMotion: boolean;
}): ReactElement {
  return (
    <section
      data-testid="tv-hero"
      data-celebration={celebration ? "on" : "off"}
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: "var(--space-2)",
        padding: "var(--space-6) var(--space-4)",
        borderRadius: "var(--r-xl)",
        border: "1px solid var(--tv-separator)",
        backgroundColor: celebration ? "var(--brand)" : "var(--surface-screen)",
        boxShadow: celebration ? "var(--shadow-gold)" : "none",
        transition: reducedMotion
          ? "none"
          : "background-color var(--duration-celebration) linear, box-shadow var(--tv-slide-duration) var(--tv-slide-ease)",
        flexShrink: 0,
      }}
    >
      {hero === null ? (
        <div
          data-testid="tv-empty"
          style={{
            fontSize: "var(--text-3xl)",
            lineHeight: "var(--leading-tight)",
            color: "var(--ink-inverse-soft)",
            fontFamily: "var(--font-display)",
            padding: "var(--space-6) 0",
          }}
        >
          {t("tv.empty", locale)}
        </div>
      ) : (
        <>
          <div
            data-testid="tv-hero-counter"
            style={{
              fontSize: "var(--text-2xl)",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: celebration ? "var(--ink-inverse)" : "var(--gold)",
            }}
          >
            {hero.counterLabel}
          </div>
          <div
            data-testid="tv-hero-number"
            style={{
              /* TV-V3-FIX : une SEULE ligne, taille clampée sur la largeur colonne. */
              fontSize: HERO_NUMBER_FONT_SIZE,
              whiteSpace: "nowrap",
              maxWidth: "100%",
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              lineHeight: "var(--leading-tight)",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "var(--tracking-numeric)",
              color: celebration ? "var(--ink-inverse)" : "var(--brand)",
            }}
          >
            {hero.displayNumber}
          </div>
          <div style={{ fontSize: "var(--text-lg)", color: celebration ? "var(--ink-inverse)" : "var(--ink-inverse-soft)" }}>
            {t("tv.now_serving", locale)}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Écran TV split permanent (pub + colonne d'appels).
 * @param props - {@link TvScreenProps}.
 * @returns The screen element.
 */
export function TvScreen({
  state,
  locale = "fr",
  tenantName = "",
  clock = "",
  dateLabel = "",
  loading = false,
  celebration = false,
  reducedMotion = false,
  adSlides,
}: TvScreenProps): ReactElement {
  const isEmpty = state.hero === null;

  return (
    <div
      data-testid="tv-screen"
      data-layout="split"
      data-state={loading ? "loading" : isEmpty ? "empty" : "nominal"}
      style={screenStyle}
    >
      <TvHeader tenantName={tenantName} dateLabel={dateLabel} clock={clock} />

      {loading ? (
        /* Skeleton adapté au split : volet pub + colonne d'appels squelettés. */
        <main data-testid="tv-skeleton" aria-busy="true" style={splitStyle}>
          <div
            data-testid="tv-skeleton-ad"
            style={{
              margin: "var(--space-8)",
              backgroundColor: "var(--tv-separator)",
              borderRadius: "var(--r-xl)",
            }}
          />
          <div style={columnStyle}>
            <div
              data-testid="tv-skeleton-hero"
              style={{
                height: "var(--display-tv-counter)",
                backgroundColor: "var(--tv-separator)",
                borderRadius: "var(--r-xl)",
                flexShrink: 0,
              }}
            />
            {Array.from({ length: TV_PREVIOUS_COUNT }).map((_, i) => (
              <div
                key={i}
                style={{
                  height: "var(--display-tv)",
                  backgroundColor: "var(--tv-separator)",
                  borderRadius: "var(--r-lg)",
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
        </main>
      ) : (
        <main data-testid="tv-split" style={splitStyle}>
          {/* Zone gauche ~75 % — carrousel pub actif EN PERMANENCE. */}
          <section style={{ minWidth: 0, minHeight: 0, display: "flex" }}>
            <AdZone slides={adSlides} locale={locale} active reducedMotion={reducedMotion} />
          </section>

          {/* Colonne droite ~25 % — appel courant + derniers appelés + file. */}
          <aside data-testid="tv-call-column" style={columnStyle}>
            <CurrentCallCard
              hero={state.hero}
              locale={locale}
              celebration={celebration}
              reducedMotion={reducedMotion}
            />

            {/*
             * TV-V3-FIX : la liste vit dans un espace flexible BORNÉ (flex 1 +
             * min-height 0 + overflow hidden) — elle ne peut ni déborder sur le
             * bloc « En attente » ni sortir de l'écran : seul ce qui tient est
             * visible, quelle que soit la hauteur (720p / 1080p / 4K).
             */}
            <section
              data-testid="tv-previous"
              aria-label={t("tv.recent_calls", locale)}
              style={{
                flex: "1 1 0%",
                minHeight: 0,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  fontSize: "var(--text-md)",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--ink-inverse-soft)",
                  marginBottom: "var(--space-3)",
                  flexShrink: 0,
                }}
              >
                {t("tv.recent_calls", locale)}
              </div>
              <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
                {state.previous.slice(0, TV_PREVIOUS_COUNT).map((call) => (
                  <PreviousCard key={`${call.displayNumber}-${call.calledAt}`} call={call} />
                ))}
              </div>
            </section>

            {/*
             * Longueur de file — ancrée en bas dans son PROPRE espace réservé
             * (flex-shrink 0, plus de marge auto : c'est la liste bornée
             * ci-dessus qui absorbe l'espace restant, plus aucun chevauchement).
             */}
            <section
              data-testid="tv-queue"
              aria-label={t("tv.waiting", locale)}
              style={{ flexShrink: 0, borderTop: "1px solid var(--tv-separator)", paddingTop: "var(--space-4)" }}
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
                  /* TV-V3-FIX : nettement sous le numéro courant (hiérarchie). */
                  fontSize: "var(--display-tv)",
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

/**
 * Bandeau haut — fond --brand, texte inverse : pastille logo + nom banque à
 * gauche, date complète au centre, horloge en bloc contrasté à droite.
 */
function TvHeader({
  tenantName,
  dateLabel,
  clock,
}: {
  tenantName: string;
  dateLabel: string;
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
        gap: "var(--space-6)",
        padding: "0 var(--space-6)",
        backgroundColor: "var(--brand)",
        color: "var(--brand-contrast)",
        fontSize: "var(--text-lg)",
        flexShrink: 0,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0 }}>
        {/* Pastille logo — lisible sur le bandeau brand (theming banque). */}
        <span
          data-testid="tv-brand-mark"
          aria-hidden="true"
          style={{
            width: "var(--space-6)",
            height: "var(--space-6)",
            borderRadius: "var(--r-full)",
            backgroundColor: "var(--brand-contrast)",
            boxShadow: "var(--shadow-1)",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontWeight: 600,
            color: "var(--brand-contrast)",
            fontSize: "var(--text-xl)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {tenantName}
        </span>
      </span>

      {/* Date complète (FR/EN) au centre du bandeau. */}
      <span
        data-testid="tv-date"
        aria-hidden={dateLabel === ""}
        style={{
          fontSize: "var(--text-xl)",
          fontWeight: 500,
          letterSpacing: "0.04em",
          color: "var(--brand-contrast)",
          whiteSpace: "nowrap",
        }}
      >
        {dateLabel}
      </span>

      {/* Horloge — bloc contrasté, grande, chiffres tabulaires. */}
      <span
        data-testid="tv-clock"
        aria-hidden={clock === ""}
        style={{
          backgroundColor: "var(--night-2, var(--surface-screen))",
          color: "var(--ink-inverse)",
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-2xl)",
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "var(--tracking-numeric)",
          padding: "var(--space-1) var(--space-4)",
          borderRadius: "var(--r-md)",
          flexShrink: 0,
        }}
      >
        {clock}
      </span>
    </header>
  );
}
