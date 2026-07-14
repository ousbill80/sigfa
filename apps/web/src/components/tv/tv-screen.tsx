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
 * - **Colonne droite ~25 %** (fond --paper, demande PO lisibilité publique
 *   2026-07-14) : carte appel courant --surface-1 (flash --brand-strong + halo
 *   pendant la fenêtre de célébration TV-002 — assombri pour rester dramatique
 *   ET lisible sur colonne claire), derniers appelés en encre, longueur de
 *   file en accent forêt. Frontière nette avec la zone média sombre : simple
 *   hairline (le contraste nuit/papier fait la séparation élégante).
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

import type { CSSProperties, ReactElement, ReactNode } from "react";
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

/**
 * Encres dérivées de la colonne d'appels CLAIRE (fond --paper) — mix de tokens
 * UNIQUEMENT, aucun hex (contrat tokens.css). Seuil TV public : WCAG ≥ 7:1.
 * - `inkSectionOnLight` — titres de section, « MAINTENANT SERVI », guichets :
 *   --ink-soft seul mesure 6.0:1 sur --paper (< 7:1) → renforcé vers --ink :
 *   8.5:1 mesuré sur --paper, 9.0:1 sur --surface-1.
 * - `queueAccentOnLight` — compteur « En attente » : --gold (2.6:1) et
 *   --forest (6.5:1) sont sous le seuil sur fond clair → forêt renforcée vers
 *   --ink : 7.3:1 mesuré sur --paper.
 */
const inkSectionOnLight = "color-mix(in srgb, var(--ink-soft) 70%, var(--ink))";
const queueAccentOnLight = "color-mix(in srgb, var(--forest) 85%, var(--ink))";

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
  /**
   * Contrôle discret rendu dans le coin droit du bandeau, après l'horloge
   * (bouton « Plein écran » de l'écran public — voir tv-fullscreen).
   */
  headerAction?: ReactNode;
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
 * Colonne d'appels — fond BLANC design system (--paper, demande PO lisibilité
 * publique) + hairline côté zone média : le contraste nuit/papier trace la
 * frontière, le hairline chaud la rend nette sans brutalité.
 * TV-V3-FIX : conteneur de taille (`container-type: inline-size`) — le numéro
 * courant se clampe sur la largeur RÉELLE de la colonne (unités cqw), donc une
 * seule ligne à 720p comme en 4K. `overflow: hidden` : la colonne ne scrolle
 * jamais, rien ne peut déborder de l'écran.
 */
const columnStyle: CSSProperties = {
  backgroundColor: "var(--paper)",
  color: "var(--ink)",
  borderLeft: "1px solid var(--hairline)",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  padding: "var(--space-6)",
  gap: "var(--space-6)",
  overflow: "hidden",
  containerType: "inline-size",
};

/**
 * Renders a single previous-call entry — DISCRÈTE (retour visuel PO, réf. BNI) :
 * une seule ligne « OC-046 · Guichet 1 », numéro en --text-2xl max (encre
 * normale --ink), guichet en --text-md (encre renforcée ≥ 7:1 sur --paper).
 * L'appel courant reste le seul élément dominant de la colonne.
 * @param call - The previous call to render.
 * @returns The card element.
 */
function PreviousCard({ call }: { call: TvCall }): ReactElement {
  return (
    <div
      data-testid="tv-previous-card"
      style={{
        padding: "var(--space-2) 0",
        borderBottom: "1px solid var(--hairline)",
        lineHeight: "var(--leading-tight)",
        color: "var(--ink)",
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
          color: "var(--ink)",
        }}
      >
        {call.displayNumber}
      </span>
      <span aria-hidden="true" style={{ color: inkSectionOnLight }}>
        {" · "}
      </span>
      <span data-testid="tv-previous-counter" style={{ fontSize: "var(--text-md)", color: inkSectionOnLight }}>
        {call.counterLabel}
      </span>
    </div>
  );
}

/**
 * Taille du numéro appelé : JAMAIS de retour à la ligne (« OC-001 » cassé en
 * « OC- » / « 001 » interdit) — réconciliation TV-NOWRAP + TV-V3-FIX (PO) :
 *  - pente PAR CARACTÈRE (budget ~145 cqw de la colonne réparti sur la longueur,
 *    chiffres tabulaires) : « OC-123 », « P010 », voire plus long, tiennent sur
 *    UNE ligne à toutes les résolutions TV (1920×1080 comme ~1366×768) ;
 *  - bornes en tokens (retour visuel PO) : plancher de lisibilité `--text-4xl`
 *    (lisible à 6-8 m), plafond `--display-tv-counter`. La colonne d'appels est
 *    le container CSS (inline-size) de référence des unités cqw.
 * @param displayNumber - Le numéro affiché (ex. « OC-001 »).
 * @returns La taille de police CSS adaptative (clamp bornée par tokens).
 */
export function heroNumberFontSize(displayNumber: string): string {
  const chars = Math.max(displayNumber.length, 1);
  const perCharCqw = Math.floor(145 / chars);
  return `clamp(var(--text-4xl), ${perCharCqw}cqw, var(--display-tv-counter))`;
}

/**
 * Carte « appel courant » en tête de colonne — carte --surface-1 élevée sur la
 * colonne --paper. Au nouvel appel (celebration), la carte passe sur fond
 * --brand-strong avec halo or (mécanique TV-002 conservée ; le flash --brand
 * était pensé pour la colonne sombre — assombri ici pour rester spectaculaire
 * sur fond clair ET tenir 7.6:1 avec l'encre inverse), puis revient au repos —
 * la pub à gauche n'est jamais interrompue.
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
        border: "1px solid var(--hairline)",
        backgroundColor: celebration ? "var(--brand-strong)" : "var(--surface-1)",
        boxShadow: celebration ? "var(--shadow-gold)" : "var(--shadow-1)",
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
            color: inkSectionOnLight,
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
              /* --gold mesure 2.6:1 sur --surface-1 : encre renforcée au repos. */
              color: celebration ? "var(--ink-inverse)" : inkSectionOnLight,
            }}
          >
            {hero.counterLabel}
          </div>
          <div
            data-testid="tv-hero-number"
            style={{
              /* TV-V3-FIX + TV-NOWRAP : une SEULE ligne, clamp borné par tokens,
                 pente par caractère sur la largeur de colonne. */
              fontSize: heroNumberFontSize(hero.displayNumber),
              whiteSpace: "nowrap",
              maxWidth: "100%",
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              lineHeight: "var(--leading-tight)",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "var(--tracking-numeric)",
              /* La star de la colonne : --brand-strong = 8.2:1 sur --surface-1
                 (--brand seul = 4.8:1, sous le seuil TV public ≥ 7:1). */
              color: celebration ? "var(--ink-inverse)" : "var(--brand-strong)",
            }}
          >
            {hero.displayNumber}
          </div>
          <div style={{ fontSize: "var(--text-lg)", color: celebration ? "var(--ink-inverse)" : inkSectionOnLight }}>
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
  headerAction = null,
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
      <TvHeader
        tenantName={tenantName}
        dateLabel={dateLabel}
        clock={clock}
        logoUrl={logoUrl}
        action={headerAction}
      />

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
            {/* Colonne claire : blocs squelettés sur --hairline (le séparateur
                blanc-alpha TV serait invisible sur --paper). */}
            <div
              data-testid="tv-skeleton-hero"
              style={{
                height: "var(--display-tv-counter)",
                backgroundColor: "var(--hairline)",
                borderRadius: "var(--r-xl)",
                flexShrink: 0,
              }}
            />
            {Array.from({ length: TV_PREVIOUS_COUNT }).map((_, i) => (
              <div
                key={i}
                style={{
                  height: "var(--display-tv)",
                  backgroundColor: "var(--hairline)",
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
                  color: inkSectionOnLight,
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
              style={{ flexShrink: 0, borderTop: "1px solid var(--hairline)", paddingTop: "var(--space-4)" }}
            >
              <div
                style={{
                  fontSize: "var(--text-md)",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: inkSectionOnLight,
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
                  /* Accent « En attente » : --gold (2.6:1 sur clair) remplacé
                     par la forêt renforcée — 7.3:1 mesuré sur --paper. */
                  color: queueAccentOnLight,
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
  action,
}: {
  tenantName: string;
  dateLabel: string;
  clock: string;
  logoUrl: string | null;
  action: ReactNode;
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

      {/* Horloge (bloc contrasté, chiffres tabulaires) + contrôle discret
          du coin du bandeau (plein écran) groupés à droite. */}
      <span style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexShrink: 0 }}>
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
        {action}
      </span>
    </header>
  );
}
