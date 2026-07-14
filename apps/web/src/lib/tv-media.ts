/**
 * tv-media — modèle du manifeste médias de l'écran TV d'agence (zone gauche).
 *
 * La zone publicitaire de `/tv/[agencyId]` peut diffuser une playlist de
 * médias (images ET vidéos) décrite par un manifeste JSON statique servi par
 * `apps/web/public/tv-media/manifest.json` (chemins locaux `public/tv-media/`
 * ou URLs absolues), surchargeable par `NEXT_PUBLIC_TV_MEDIA_MANIFEST_URL`.
 *
 * Sans manifeste, manifeste invalide ou playlist vide → l'écran retombe sur
 * les slides promo texte existantes (AdZone) : aucun asset n'est jamais requis.
 *
 * COUTURE ADMIN : le pilotage des médias par la console admin (upload banque,
 * planification) remplacera ce manifeste statique — ce module (types + parse)
 * est la couture prévue pour cette bascule ; seul le fetch d'URL changera.
 * @module lib/tv-media
 */

/** Kind of media in the TV playlist. */
export type TvMediaType = "image" | "video";

/** A single media entry of the TV manifest. */
export interface TvMediaItem {
  /** Media kind — drives rendering (`<img>` vs `<video muted autoplay>`). */
  type: TvMediaType;
  /** Local path (`/tv-media/...`) or absolute URL of the media. */
  src: string;
  /**
   * Display duration in ms. Images default to
   * {@link TV_MEDIA_DEFAULT_DURATION_MS}; videos advance at their natural end
   * unless a duration is provided.
   */
  durationMs?: number;
}

/** Default display duration (ms) of an image slide. */
export const TV_MEDIA_DEFAULT_DURATION_MS = 8000 as const;

/** Cross-fade duration (ms) between two media (disabled in reduced-motion). */
export const TV_MEDIA_FADE_MS = 400 as const;

/** Default manifest path (served from `apps/web/public/tv-media/`). */
export const TV_MEDIA_MANIFEST_DEFAULT_URL = "/tv-media/manifest.json" as const;

/**
 * Resolves the manifest URL — `NEXT_PUBLIC_TV_MEDIA_MANIFEST_URL` (inlinée au
 * build Next côté client) sinon le chemin local par défaut.
 * @param override - Valeur d'env explicite (tests) ; par défaut l'env publique.
 * @returns L'URL du manifeste à charger.
 */
export function tvMediaManifestUrl(
  override: string | undefined = process.env.NEXT_PUBLIC_TV_MEDIA_MANIFEST_URL
): string {
  const url = override?.trim();
  return url ? url : TV_MEDIA_MANIFEST_DEFAULT_URL;
}

/**
 * Parses an untrusted manifest payload into a safe media playlist.
 *
 * Tolérant par conception (le repli texte doit toujours rester possible) :
 * payload non-tableau → playlist vide ; entrées invalides (type inconnu, `src`
 * vide, durée non positive) → filtrées entrée par entrée.
 * @param payload - JSON désérialisé du manifeste (non fiable).
 * @returns La playlist validée (vide si rien d'exploitable).
 */
export function parseTvMediaManifest(payload: unknown): TvMediaItem[] {
  if (!Array.isArray(payload)) return [];
  const items: TvMediaItem[] = [];
  for (const entry of payload) {
    if (typeof entry !== "object" || entry === null) continue;
    const { type, src, durationMs } = entry as Record<string, unknown>;
    if (type !== "image" && type !== "video") continue;
    if (typeof src !== "string" || src.trim() === "") continue;
    const item: TvMediaItem = { type, src: src.trim() };
    if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0) {
      item.durationMs = durationMs;
    }
    items.push(item);
  }
  return items;
}
