/**
 * KIOSK-008 — useVoiceAnnouncement hook.
 *
 * Déclenche la lecture vocale (Web Speech API) du registre SIGFA dans la langue
 * de session. Délègue à `speakInLocale` (mécanique commune : voix explicite de
 * la locale cible ou repli FR, attente `voiceschanged` si la liste de voix
 * n'est pas encore chargée, `cancel` avant `speak`), avec la `rate` ralentie
 * (0.8) en mode accessibilité. Dégradation silencieuse si l'API est absente
 * (aucun log d'erreur côté client).
 *
 * @module hooks/useVoiceAnnouncement
 */
"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import {
  buildVoiceAnnouncement,
  speakInLocale,
  voiceRate,
  type VoiceAnnouncementInput,
} from "@/lib/kiosk-voice";

export interface UseVoiceAnnouncement {
  /** Déclenche la lecture vocale de l'annonce fournie. */
  announce: (input: VoiceAnnouncementInput) => void;
}

/**
 * Retourne un déclencheur de synthèse vocale lié à la langue de session.
 *
 * @param isAccessibilityMode - Vrai si le mode accessibilité est actif.
 * @returns Un objet exposant `announce`.
 */
export function useVoiceAnnouncement(
  isAccessibilityMode = false
): UseVoiceAnnouncement {
  const t = useTranslations("ticket005");
  const params = useParams();
  const locale = (params?.locale as string) ?? "fr";

  const announce = useCallback(
    (input: VoiceAnnouncementInput) => {
      if (typeof window === "undefined") return;
      if (!("speechSynthesis" in window) || !window.speechSynthesis) return;

      // Mécanique commune (voix explicite + attente voiceschanged + cancel).
      speakInLocale(window.speechSynthesis, {
        locale,
        text: buildVoiceAnnouncement(input, t),
        rate: voiceRate(isAccessibilityMode),
      });
    },
    [t, locale, isAccessibilityMode]
  );

  return { announce };
}
