/**
 * KIOSK-005 — TicketScreen.tsx
 * Écran de confirmation du ticket.
 * Pulse 400ms CSS, voix Web Speech API, retour auto à 4s (8s en mode a11y).
 *
 * KIOSK-007 — États dégradés imprimante (bascule transparente) :
 *   - printerStatus dégradé (`PAPER_LOW | ERROR | OFFLINE`) OU réseau coupé
 *     après le 201 avant confirmation imprimante → affichage prolongé à 8 s +
 *     message « Photographiez votre numéro ou recevez-le par SMS ». AUCUNE
 *     mention de panne côté client (bascule invisible pour l'usager).
 */
"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { deriveDegradedState, type PrinterStatus } from "@/hooks/useDegradedState";
import { useVoiceAnnouncement } from "@/hooks/useVoiceAnnouncement";
import { VoiceButton } from "@/components/VoiceButton";
import {
  A11Y_BASE_FONT_PX,
  accessibilityFontSizePx,
} from "@/lib/kiosk-voice";

interface TicketScreenProps {
  displayNumber: string;
  position: number;
  estimatedWaitMinutes: number;
  /** Statut imprimante remonté par le heartbeat. */
  printerStatus?: PrinterStatus;
  phoneNumber?: string;
  smsConsent?: boolean;
  isAccessibilityMode?: boolean;
  /**
   * KIOSK-007 : vrai si le réseau a été coupé APRÈS le 201 mais AVANT
   * confirmation imprimante → bascule dégradée identique (affichage 8 s).
   */
  networkLostBeforePrinterConfirm?: boolean;
}

/**
 * Mask phone number: show only last 2 digits
 * "0707474747" → "07 •• •• •• 47"
 */
function maskPhoneNumber(phone: string): string {
  if (phone.length < 2) return phone;
  const last2 = phone.slice(-2);
  return `07 •• •• •• ${last2}`;
}

/**
 * Check prefers-reduced-motion media query
 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

export function TicketScreen({
  displayNumber,
  position,
  estimatedWaitMinutes,
  printerStatus,
  phoneNumber,
  smsConsent,
  isAccessibilityMode = false,
  networkLostBeforePrinterConfirm = false,
}: TicketScreenProps) {
  const t = useTranslations("ticket005");
  const tDeg = useTranslations("degraded007");
  const router = useRouter();
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";
  const hasAnnouncedRef = useRef(false);
  const { announce } = useVoiceAnnouncement(isAccessibilityMode);

  // KIOSK-008 — Taille de police de base : 28 px nominal, ≥ 34 px (28 × 1.2)
  // en mode accessibilité. Le texte annoncé et le rendu partagent la locale.
  const baseTextPx = isAccessibilityMode
    ? accessibilityFontSizePx()
    : A11Y_BASE_FONT_PX;

  // KIOSK-007 : bascule transparente. L'affichage dégradé prolonge à 8 s ;
  // le mode accessibilité prolonge lui aussi à 8 s → on prend le max.
  const degraded = deriveDegradedState({
    printerStatus,
    networkLostBeforePrinterConfirm,
  });
  const returnDelay =
    isAccessibilityMode || degraded.isDisplayDegraded ? 8000 : 4000;

  // Auto-return to home
  useEffect(() => {
    const timer = setTimeout(() => {
      router.push(`/${currentLocale}`);
    }, returnDelay);
    return () => clearTimeout(timer);
  }, [returnDelay, router, currentLocale]);

  // Voice announcement (once only) — KIOSK-008 : registre SIGFA, langue de
  // session, voix ralentie (rate 0.8) et repli FR gérés par le hook.
  useEffect(() => {
    if (hasAnnouncedRef.current) return;
    hasAnnouncedRef.current = true;
    announce({ displayNumber, position, estimatedWaitMinutes });
  }, [displayNumber, position, estimatedWaitMinutes, announce]);

  const reducedMotion = prefersReducedMotion();

  const animationStyle = reducedMotion
    ? {}
    : { animation: "ticketPulse 400ms ease-out 1 forwards" };

  return (
    <main
      role="main"
      style={{
        backgroundColor: "var(--surface-kiosk)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        gap: "1.5rem",
      }}
    >
      {/* Ticket number — 128px, --brand */}
      <div
        data-testid="ticket-number"
        data-animate={reducedMotion ? undefined : "pulse"}
        style={{
          fontSize: "128px",
          fontWeight: "bold",
          color: "var(--brand)",
          textAlign: "center",
          lineHeight: 1,
          ...animationStyle,
        }}
      >
        {displayNumber}
      </div>

      {/* Position in queue — KIOSK-008 : texte de base (28 px nominal,
          ≥ 34 px en accessibilité), contraste --ink-inverse/--surface-kiosk ≥ 7:1 */}
      <p
        data-testid="ticket-position"
        data-a11y-text="true"
        style={{
          fontSize: `${baseTextPx}px`,
          color: "var(--ink-inverse)",
          textAlign: "center",
          fontWeight: "bold",
        }}
      >
        {t("position", { position })}
      </p>

      {/* Estimated wait — KIOSK-008 : texte de base identique */}
      <p
        data-testid="ticket-wait"
        data-a11y-text="true"
        style={{
          fontSize: `${baseTextPx}px`,
          color: "var(--ink-inverse)",
          textAlign: "center",
        }}
      >
        {t("waitEstimate", { minutes: estimatedWaitMinutes })}
      </p>

      {/* Printer status OK — message d'impression (aucun état dégradé) */}
      {printerStatus === "OK" && !degraded.isDisplayDegraded && (
        <p
          data-testid="print-message"
          style={{
            fontSize: "24px",
            color: "var(--success)",
            textAlign: "center",
          }}
        >
          {t("printing")}
        </p>
      )}

      {/* KIOSK-007 — Bascule transparente : imprimante dégradée OU réseau coupé.
          AUCUNE mention de panne ; on invite simplement à photographier le
          numéro ou à recevoir un SMS. Token neutre (--ink-inverse). */}
      {degraded.isDisplayDegraded && (
        <p
          data-testid="degraded-photo-message"
          style={{
            fontSize: "24px",
            color: "var(--ink-inverse)",
            textAlign: "center",
          }}
        >
          {tDeg("photographNumber")}
        </p>
      )}

      {/* SMS confirmation */}
      {phoneNumber && smsConsent && (
        <p
          data-testid="sms-sent"
          style={{
            fontSize: "20px",
            color: "var(--success)",
            textAlign: "center",
          }}
        >
          {t("smsSent", { maskedPhone: maskPhoneNumber(phoneNumber) })}
        </p>
      )}

      {/* KIOSK-008 — Bouton 🔊 permanent : relecture manuelle de l'écran
          courant dans la langue de session (rate ralentie en accessibilité). */}
      <VoiceButton
        announcement={{ displayNumber, position, estimatedWaitMinutes }}
        isAccessibilityMode={isAccessibilityMode}
      />
    </main>
  );
}
