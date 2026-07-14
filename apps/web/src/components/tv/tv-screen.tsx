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
import { TvMediaZone } from "./tv-media-zone";
import type { AdSlide } from "@/lib/ad-slides";
import type { TvMediaItem } from "@/lib/tv-media";
import { bankInitial } from "@/lib/bank-branding";

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
  /**
   * Dynamic media playlist (manifest `public/tv-media/manifest.json`). When
   * non-empty, the left pane plays these media (images/videos); otherwise the
   * text AdZone remains — zero regression without provisioning.
   */
  mediaItems?: readonly TvMediaItem[];
  /**
   * Bank logo URL (convention lib/bank-branding — `NEXT_PUBLIC_BANK_LOGO_URL`).
   * `null` → pastille --brand-contrast + initiale de la banque.
   */
  logoUrl?: string | null;
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

/** Colonne d'appels — fond sombre dédié + séparateur token. */
const columnStyle: CSSProperties = {
  backgroundColor: "var(--night-2, var(--surface-screen))",
  borderLeft: "1px solid var(--tv-separator)",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  padding: "var(--space-6)",
  gap: "var(--space-6)",
  overflow: "hidden",
};

/**
 * Renders a single previous-call card (numéro + guichet, en retrait).
 * Recent calls are in retreat: --ink-inverse-soft, tabular --font-display digits.
 * Le numéro tient sur UNE ligne (nowrap + taille adaptative en cqw, ~2/3 de la
 * rangée pour le numéro, le reste au libellé guichet) — jamais de « OC- »/« 001 ».
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
        containerType: "inline-size",
      }}
    >
      <span
        style={{
          whiteSpace: "nowrap",
          fontSize: tvNumberFontSize(call.displayNumber, 100, "--display-tv"),
          fontFamily: "var(--font-display)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "var(--tracking-numeric)",
          color: "var(--ink-inverse-soft)",
        }}
      >
        {call.displayNumber}
      </span>
      <span
        style={{
          fontSize: "var(--text-lg)",
          color: "var(--ink-inverse-soft)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {call.counterLabel}
      </span>
    </div>
  );
}

/**
 * Taille du numéro appelé : JAMAIS de retour à la ligne (« OC-001 » cassé en
 * « OC- » / « 001 » interdit). La carte est un container CSS (inline-size) et
 * la taille de police est bornée par la largeur disponible PAR CARACTÈRE
 * (~0,62 em/caractère en chiffres tabulaires + tracking) : des formats plus
 * longs (« OC-123 », « P010 », voire plus) tiennent sur UNE ligne à toutes les
 * résolutions TV (1920×1080 comme ~1366×768), plafonnée à --display-tv-counter.
 * @param displayNumber - Le numéro affiché (ex. « OC-001 »).
 * @returns La taille de police CSS adaptative.
 */
export function heroNumberFontSize(displayNumber: string): string {
  return tvNumberFontSize(displayNumber, 145, "--display-tv-counter");
}

/**
 * Taille adaptative générique d'un numéro TV sur UNE ligne : budget de largeur
 * container (cqw) réparti par caractère, plafonné par un token d'affichage.
 * @param displayNumber - Le numéro affiché.
 * @param budgetCqw - Largeur container allouée au numéro (en cqw).
 * @param capToken - Token CSS plafonnant la taille (ex. --display-tv).
 * @returns La taille de police CSS adaptative.
 */
export function tvNumberFontSize(
  displayNumber: string,
  budgetCqw: number,
  capToken: string
): string {
  const chars = Math.max(displayNumber.length, 1);
  const perCharCqw = Math.floor(budgetCqw / chars);
  return `min(var(${capToken}), ${perCharCqw}cqw)`;
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
        /* Container CSS : le numéro se dimensionne en cqw sur la largeur
           réelle de la carte (colonne ~25 % — 1920 comme 1366). */
        containerType: "inline-size",
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
              /* UNE ligne, toujours : nowrap + taille adaptative (cqw) bornée
                 par --display-tv-counter — « OC-001 » ne casse jamais. */
              whiteSpace: "nowrap",
              fontSize: heroNumberFontSize(hero.displayNumber),
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
  mediaItems,
  logoUrl = null,
}: TvScreenProps): ReactElement {
  const isEmpty = state.hero === null;

  /* Repli promo texte : rendu tel quel sans manifeste/médias, et réutilisé par
     TvMediaZone si tous les médias échouent au chargement (zéro régression). */
  const promoFallback = (
    <AdZone slides={adSlides} locale={locale} active reducedMotion={reducedMotion} />
  );

  return (
    <div
      data-testid="tv-screen"
      data-layout="split"
      data-state={loading ? "loading" : isEmpty ? "empty" : "nominal"}
      style={screenStyle}
    >
      <TvHeader tenantName={tenantName} dateLabel={dateLabel} clock={clock} logoUrl={logoUrl} />

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
          {/* Zone gauche ~75 % — médias dynamiques (manifeste) si provisionnés,
              sinon carrousel promo texte. Cellule de grille SANS z-index : la
              colonne d'appels (« MAINTENANT SERVI ») n'est jamais masquée. */}
          <section style={{ minWidth: 0, minHeight: 0, display: "flex", position: "relative" }}>
            {mediaItems !== undefined && mediaItems.length > 0 ? (
              <TvMediaZone
                items={mediaItems}
                reducedMotion={reducedMotion}
                fallback={promoFallback}
              />
            ) : (
              promoFallback
            )}
          </section>

          {/* Colonne droite ~25 % — appel courant + derniers appelés + file. */}
          <aside data-testid="tv-call-column" style={columnStyle}>
            <CurrentCallCard
              hero={state.hero}
              locale={locale}
              celebration={celebration}
              reducedMotion={reducedMotion}
            />

            <section data-testid="tv-previous" aria-label={t("tv.recent_calls", locale)} style={{ minHeight: 0 }}>
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

            {/* Longueur de file — en bas de colonne, style actuel conservé. */}
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
 * Bandeau haut — fond --brand, texte inverse : logo banque (ou pastille
 * --brand-contrast + initiale sans logo provisionné) + nom à gauche, date
 * complète au centre, horloge en bloc contrasté à droite.
 *
 * Convention lib/bank-branding (`NEXT_PUBLIC_BANK_LOGO_URL`), composée
 * LOCALEMENT : l'écran TV est public, aucune dépendance à session-header /
 * tenant-mark (chantier branding parallèle).
 */
function TvHeader({
  tenantName,
  dateLabel,
  clock,
  logoUrl,
}: {
  tenantName: string;
  dateLabel: string;
  clock: string;
  logoUrl: string | null;
}): ReactElement {
  /* Logo bien visible : ~48px dans le bandeau de 64px (marge --space-4). */
  const markSize = "calc(var(--tv-header-height) - var(--space-4))";
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
        {logoUrl !== null ? (
          /* Logo banque provisionné (NEXT_PUBLIC_BANK_LOGO_URL) — bien
             visible, ~48px de haut dans le bandeau. Décoratif : le nom de la
             banque est affiché juste à côté. */
          // eslint-disable-next-line @next/next/no-img-element -- logo banque provisionné (theming), hors pipeline next/image
          <img
            data-testid="tv-brand-logo"
            src={logoUrl}
            alt=""
            aria-hidden="true"
            style={{
              height: markSize,
              width: "auto",
              maxWidth: "calc(var(--tv-header-height) * 4)",
              objectFit: "contain",
              flexShrink: 0,
            }}
          />
        ) : (
          /* Repli sans logo : pastille lisible sur le bandeau brand, avec
             l'initiale de la banque (jamais d'image réseau requise). */
          <span
            data-testid="tv-brand-mark"
            aria-hidden="true"
            style={{
              width: markSize,
              height: markSize,
              borderRadius: "var(--r-full)",
              backgroundColor: "var(--brand-contrast)",
              boxShadow: "var(--shadow-1)",
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--brand)",
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "var(--text-2xl)",
            }}
          >
            {bankInitial(tenantName)}
          </span>
        )}
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
