/**
 * KIOSK-006 — OfflineBanner.tsx
 * Bandeau discret « Mode hors connexion — vos tickets restent valables ».
 * Token --info uniquement, non bloquant (le parcours client est inchangé).
 * Au retour réseau (isOffline passe à false), disparaît en fondu 250 ms.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/** Durée du fondu de disparition au retour réseau (ms). */
export const OFFLINE_BANNER_FADE_MS = 250;

interface OfflineBannerProps {
  /** État réseau courant : true = hors connexion (bandeau visible). */
  isOffline: boolean;
  /** Clé i18n du message (namespace confirmation004 par défaut). */
  messageKey?: string;
  /** Namespace i18n. */
  namespace?: string;
}

export function OfflineBanner({
  isOffline,
  messageKey = "offlineBanner",
  namespace = "confirmation004",
}: OfflineBannerProps) {
  const t = useTranslations(namespace);
  // `mounted` reste true le temps du fondu, même après le retour réseau.
  const [mounted, setMounted] = useState(isOffline);
  const [fading, setFading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOffline) {
      setMounted(true);
      setFading(false);
      return;
    }
    // Retour réseau : déclenche le fondu puis démonte après 250 ms.
    if (mounted) {
      setFading(true);
      timerRef.current = setTimeout(() => {
        setMounted(false);
        setFading(false);
      }, OFFLINE_BANNER_FADE_MS);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isOffline, mounted]);

  if (!mounted) return null;

  return (
    <div
      data-testid="offline-banner"
      data-fading={fading ? "true" : "false"}
      role="status"
      aria-live="polite"
      style={{
        backgroundColor: "var(--info)",
        color: "var(--ink-inverse)",
        padding: "0.75rem 1rem",
        borderRadius: "0.5rem",
        fontSize: "20px",
        textAlign: "center",
        opacity: fading ? 0 : 1,
        transition: `opacity ${OFFLINE_BANNER_FADE_MS}ms ease-out`,
      }}
    >
      {t(messageKey)}
    </div>
  );
}
