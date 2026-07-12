/**
 * KIOSK-008 — useVoiceAnnouncement hook.
 *
 * Déclenche la lecture vocale (Web Speech API) du registre SIGFA dans la langue
 * de session. Applique la voix de la locale cible ou le repli FR, et la `rate`
 * ralentie (0.8) en mode accessibilité. Dégradation silencieuse si l'API est
 * absente (aucun log d'erreur côté client).
 *
 * @module hooks/useVoiceAnnouncement
 */
"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import {
  buildVoiceAnnouncement,
  localeToBcp47,
  pickVoiceForLocale,
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
      if (typeof SpeechSynthesisUtterance === "undefined") return;

      const text = buildVoiceAnnouncement(input, t);
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = localeToBcp47(locale);
      utterance.rate = voiceRate(isAccessibilityMode);

      // Sélection de voix avec repli FR (Dioula/Baoulé sans voix native).
      const voices = window.speechSynthesis.getVoices?.() ?? [];
      const voice = pickVoiceForLocale(locale, voices);
      if (voice) utterance.voice = voice;

      window.speechSynthesis.speak(utterance);
    },
    [t, locale, isAccessibilityMode]
  );

  return { announce };
}
