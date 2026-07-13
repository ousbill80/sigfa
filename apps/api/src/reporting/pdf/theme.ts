/**
 * REP-002b — Theming tenant des gabarits PDF de rapport (habillage, jamais structure).
 *
 * Chaque banque se brande sans effort : une couleur `brand` + un logo optionnel.
 * Le contraste texte/fond est corrigé automatiquement au niveau WCAG AA (≥ 4.5:1)
 * en RÉUTILISANT l'utilitaire `wcag-contrast` (API-009) — aucune duplication de
 * l'algorithme. Aucune valeur de marque n'est codée en dur dans les documents :
 * les couleurs effectives dérivent TOUJOURS d'ici (défauts si le tenant n'a rien
 * fourni). Module PUR (aucune I/O, aucune horloge) — entièrement testable.
 *
 * @module
 */

import {
  correctContrast,
  contrastRatio,
  MIN_CONTRAST_RATIO,
} from "src/lib/wcag-contrast.js";

/** Couleur de marque par défaut (bleu SIGFA neutre) si le tenant n'en fournit pas. */
export const DEFAULT_BRAND_COLOR = "#1d4ed8";

/** Fond de page par défaut (blanc — impression et lecture écran). */
export const DEFAULT_PAGE_BACKGROUND = "#ffffff";

/** Fond de bloc secondaire (bandeaux, en-têtes de section). */
export const DEFAULT_SURFACE_BACKGROUND = "#f4f4f5";

/** Couleur de texte neutre par défaut (gris très foncé). */
export const DEFAULT_TEXT_COLOR = "#111827";

/** Couleur de texte secondaire (libellés, mentions). */
export const DEFAULT_MUTED_COLOR = "#6b7280";

/**
 * Configuration de marque d'un tenant (fournie par la config banque). Tout est
 * optionnel : un tenant sans configuration obtient les défauts SIGFA.
 */
export interface TenantBrandConfig {
  /** Couleur de marque `#RRGGBB` (bandeau, accents). */
  brandColor?: string;
  /** Nom de la banque (affiché en en-tête). */
  bankName?: string;
  /**
   * Logo du tenant — data-URI (`data:image/png;base64,...`) ou URL absolue. Absent
   * ⇒ aucun logo (le nom de la banque tient lieu d'identité visuelle).
   */
  logoSrc?: string;
}

/**
 * Thème RÉSOLU d'un document PDF : couleurs effectives (contraste WCAG déjà
 * corrigé) + identité tenant. C'est la SEULE source de couleurs des gabarits.
 */
export interface ResolvedPdfTheme {
  /** Couleur de marque effective (bandeau/accents). */
  brand: string;
  /** Texte sur le bandeau de marque (blanc ou noir selon le contraste). */
  onBrand: string;
  /** Fond de page. */
  pageBackground: string;
  /** Fond de bloc secondaire (cartes, en-têtes de section). */
  surface: string;
  /** Couleur de texte principale (contraste ≥ AA garanti sur `pageBackground`). */
  text: string;
  /** Couleur de texte secondaire (libellés). */
  muted: string;
  /** Nom de la banque (identité). */
  bankName: string;
  /** Logo du tenant (`data:`/URL) ou `null` si non fourni. */
  logoSrc: string | null;
}

/** Valide qu'une chaîne est une couleur `#RRGGBB` (sinon on retombe sur le défaut). */
function isHexColor(value: string | undefined): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * Choisit la couleur de texte (blanc ou noir) offrant le MEILLEUR contraste contre
 * un fond donné — utilisé pour le texte posé sur le bandeau de marque.
 *
 * @param background - Fond `#RRGGBB`
 * @returns `#ffffff` ou `#111827` selon le contraste
 */
export function onColorFor(background: string): string {
  const onWhite = contrastRatio("#ffffff", background);
  const onDark = contrastRatio(DEFAULT_TEXT_COLOR, background);
  return onWhite >= onDark ? "#ffffff" : DEFAULT_TEXT_COLOR;
}

/**
 * Résout le thème effectif d'un document à partir de la config tenant. Le contraste
 * du texte principal contre le fond de page est CORRIGÉ au niveau WCAG AA via
 * l'utilitaire partagé (API-009) — jamais un texte illisible, quel que soit le fond.
 * Le texte du bandeau (`onBrand`) est le noir/blanc de meilleur contraste sur la
 * marque, garantissant la lisibilité même sur une couleur de banque quelconque.
 *
 * @param config - Configuration de marque du tenant (tout optionnel)
 * @returns Thème résolu (couleurs effectives + identité)
 */
export function resolvePdfTheme(config: TenantBrandConfig = {}): ResolvedPdfTheme {
  const pageBackground = DEFAULT_PAGE_BACKGROUND;
  const rawBrand = isHexColor(config.brandColor)
    ? config.brandColor
    : DEFAULT_BRAND_COLOR;
  const text = correctContrast(DEFAULT_TEXT_COLOR, pageBackground);
  const muted = correctContrast(DEFAULT_MUTED_COLOR, pageBackground);
  const bankName =
    config.bankName && config.bankName.trim().length > 0
      ? config.bankName
      : "SIGFA";
  const logoSrc =
    config.logoSrc && config.logoSrc.trim().length > 0 ? config.logoSrc : null;
  return {
    brand: rawBrand.toLowerCase(),
    onBrand: onColorFor(rawBrand),
    pageBackground,
    surface: DEFAULT_SURFACE_BACKGROUND,
    text,
    muted,
    bankName,
    logoSrc,
  };
}

/**
 * Indique si un couple (texte, fond) satisfait le contraste WCAG AA. Exposé pour
 * les tests de theming (garantie ≥ AA sur 2 tenants distincts).
 *
 * @param foreground - Couleur de texte `#RRGGBB`
 * @param background - Couleur de fond `#RRGGBB`
 * @returns `true` si le ratio ≥ 4.5:1
 */
export function meetsContrastAA(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= MIN_CONTRAST_RATIO;
}
