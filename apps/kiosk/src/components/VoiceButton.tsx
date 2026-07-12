/**
 * KIOSK-008 — VoiceButton.tsx
 *
 * Bouton 🔊 permanent (cible ≥ 72×72 px) présent sur tous les écrans : déclenche
 * la lecture vocale de l'écran courant dans la langue de session. Icône appariée
 * à un label texte (règle icône+texte du design system). Tokens CSS uniquement.
 */
"use client";

import { useTranslations } from "next-intl";
import { useVoiceAnnouncement } from "@/hooks/useVoiceAnnouncement";
import {
  accessibilityFontSizePx,
  A11Y_BASE_FONT_PX,
  type VoiceAnnouncementInput,
} from "@/lib/kiosk-voice";

interface VoiceButtonProps {
  /** Données de l'annonce vocale (registre SIGFA). */
  announcement: VoiceAnnouncementInput;
  /** Mode accessibilité actif → voix ralentie + label agrandi. */
  isAccessibilityMode?: boolean;
}

export function VoiceButton({
  announcement,
  isAccessibilityMode = false,
}: VoiceButtonProps) {
  const t = useTranslations("voice008");
  const { announce } = useVoiceAnnouncement(isAccessibilityMode);

  // En accessibilité le label passe à ≥ 34 px (28 × 1.2), sinon base 28 px.
  const labelFontPx = isAccessibilityMode
    ? accessibilityFontSizePx()
    : A11Y_BASE_FONT_PX;

  return (
    <button
      type="button"
      data-testid="voice-button"
      aria-label={t("playLabel")}
      onClick={() => announce(announcement)}
      style={{
        minWidth: "72px",
        minHeight: "72px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5rem",
        fontSize: `${labelFontPx}px`,
        color: "var(--ink-inverse)",
        backgroundColor: "var(--surface-kiosk)",
        border: "2px solid var(--ink-inverse)",
        borderRadius: "0.5rem",
        cursor: "pointer",
        padding: "0.5rem 1rem",
      }}
    >
      <span aria-hidden="true">🔊</span>
      <span>{t("playLabel")}</span>
    </button>
  );
}
