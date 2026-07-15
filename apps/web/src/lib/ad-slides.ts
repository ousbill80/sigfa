/**
 * Ad slides model for the TV rest state (AdZone).
 *
 * Les slides sont une liste CONFIGURABLE : une banque peut fournir sa propre
 * liste (`AdSlide[]`) ; à défaut, {@link DEFAULT_AD_SLIDES} propose 3 slides de
 * démonstration premium composées uniquement en tokens (dégradés + typo, PAS
 * d'image réseau externe, PAS d'emoji). La gestion réelle des médias (upload
 * par la banque, planification) relève d'une future story admin — HORS SCOPE.
 * @module lib/ad-slides
 */
import type { TranslationKey } from "./i18n";

/**
 * A single advertising slide displayed on the TV when at rest.
 *
 * `imageUrl` reste optionnel et n'est utilisé que si une banque fournit un
 * média local (jamais une image réseau externe dans le défaut de démo). Sans
 * `imageUrl`, la slide se compose d'un dégradé en tokens + titre/sous-titre.
 */
export interface AdSlide {
  /** Stable identity for React keys / carousel indexing. */
  id: string;
  /** i18n key for the slide title (rendered large). */
  titleKey: TranslationKey;
  /** Optional i18n key for the slide subtitle. */
  subtitleKey?: TranslationKey;
  /**
   * Background layer, expressed ONLY with `var(--token)` values.
   * A CSS gradient/colour string (tokens only) painting the slide surface.
   */
  bg: string;
  /**
   * Optional accent colour token used for the title (defaults to --brand-inv).
   * Must be a `var(--token)` reference — no hex literals.
   */
  accent?: string;
  /** Optional local media URL (bank-provided). Never an external network URL. */
  imageUrl?: string;
}

/** Duration (ms) a single slide stays on screen before advancing. */
export const AD_SLIDE_DURATION_MS = 8000 as const;

/** Cross-fade duration (ms) between two slides. */
export const AD_FADE_MS = 600 as const;

/**
 * Default demonstration slides — premium placeholders composed in tokens only.
 * Real media management (bank upload) is a future admin story (out of scope).
 */
export const DEFAULT_AD_SLIDES: readonly AdSlide[] = [
  {
    id: "account",
    titleKey: "tv.ad.account.title",
    subtitleKey: "tv.ad.account.subtitle",
    // Dégradé nuit → marque (thémable banque) : accent brand piloté par tenant.
    bg: "radial-gradient(circle at 25% 30%, color-mix(in srgb, var(--brand) 28%, var(--night-2)), var(--night-2) 68%)",
    accent: "var(--brand)",
  },
  {
    id: "credit",
    titleKey: "tv.ad.credit.title",
    subtitleKey: "tv.ad.credit.subtitle",
    // Dégradé nuit → success : fonctionnel fixe (confiance).
    bg: "radial-gradient(circle at 75% 35%, color-mix(in srgb, var(--success) 26%, var(--night-2)), var(--night-2) 66%)",
    accent: "var(--brand-inv)",
  },
  {
    id: "app",
    titleKey: "tv.ad.app.title",
    subtitleKey: "tv.ad.app.subtitle",
    // Dégradé nuit → brand-inv : premium.
    bg: "linear-gradient(135deg, color-mix(in srgb, var(--brand-inv) 22%, var(--night-2)), var(--night-2) 70%)",
    accent: "var(--brand-inv)",
  },
] as const;
