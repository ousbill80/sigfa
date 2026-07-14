/**
 * useTvMediaManifest — charge la playlist médias de l'écran TV côté client.
 *
 * Fetch unique du manifeste JSON ({@link tvMediaManifestUrl}) au montage :
 * réponse valide → playlist parsée ({@link parseTvMediaManifest}) ; toute
 * erreur (réseau, 404, JSON invalide, URL relative hors navigateur) → playlist
 * vide, ce qui déclenche le REPLI promo texte (AdZone) sans régression.
 *
 * Aucun contrat temps réel touché : le manifeste est un asset statique public
 * (couture admin : remplacé plus tard par l'endpoint console admin).
 * @module lib/use-tv-media
 */
"use client";

import { useEffect, useState } from "react";
import { parseTvMediaManifest, tvMediaManifestUrl, type TvMediaItem } from "./tv-media";

/**
 * Loads the TV media playlist from the manifest URL.
 * @param url - Manifest URL (defaults to env override or local manifest).
 * @returns The validated playlist — empty until loaded or on any failure.
 */
export function useTvMediaManifest(url: string = tvMediaManifestUrl()): readonly TvMediaItem[] {
  const [items, setItems] = useState<readonly TvMediaItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(url);
        if (!res.ok) return; // repli texte — pas de manifeste provisionné
        const payload: unknown = await res.json();
        if (!cancelled) setItems(parseTvMediaManifest(payload));
      } catch {
        // repli texte — réseau/JSON en échec, l'AdZone reste affichée
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return items;
}
