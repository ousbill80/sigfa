/**
 * KIOSK-005 — TicketScreen.tsx
 * Écran de confirmation du ticket.
 * Pulse 400ms CSS, voix Web Speech API, retour auto à 4s (8s en mode a11y).
 */
"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";

interface TicketScreenProps {
  displayNumber: string;
  position: number;
  estimatedWaitMinutes: number;
  printerStatus?: "OK" | "ERROR";
  phoneNumber?: string;
  smsConsent?: boolean;
  isAccessibilityMode?: boolean;
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
}: TicketScreenProps) {
  const t = useTranslations("ticket005");
  const router = useRouter();
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";
  const hasAnnouncedRef = useRef(false);

  const returnDelay = isAccessibilityMode ? 8000 : 4000;

  // Auto-return to home
  useEffect(() => {
    const timer = setTimeout(() => {
      router.push(`/${currentLocale}`);
    }, returnDelay);
    return () => clearTimeout(timer);
  }, [returnDelay, router, currentLocale]);

  // Voice announcement (once only)
  useEffect(() => {
    if (hasAnnouncedRef.current) return;
    if (typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) return;

    hasAnnouncedRef.current = true;

    const utterance = new SpeechSynthesisUtterance(
      t("voiceAnnounce", {
        displayNumber,
        position,
        minutes: estimatedWaitMinutes,
      })
    );
    utterance.lang = currentLocale === "fr" ? "fr-FR" : "en-US";
    window.speechSynthesis.speak(utterance);
  }, [displayNumber, position, estimatedWaitMinutes, t, currentLocale]);

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

      {/* Position in queue */}
      <p
        data-testid="ticket-position"
        style={{
          fontSize: "40px",
          color: "var(--ink-inverse)",
          textAlign: "center",
          fontWeight: "bold",
        }}
      >
        {t("position", { position })}
      </p>

      {/* Estimated wait */}
      <p
        data-testid="ticket-wait"
        style={{
          fontSize: "40px",
          color: "var(--ink-inverse)",
          textAlign: "center",
        }}
      >
        {t("waitEstimate", { minutes: estimatedWaitMinutes })}
      </p>

      {/* Printer status OK */}
      {printerStatus === "OK" && (
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

      {/* Printer status ERROR */}
      {printerStatus === "ERROR" && (
        <p
          data-testid="print-error"
          style={{
            fontSize: "24px",
            color: "var(--danger)",
            textAlign: "center",
          }}
        >
          {t("printerError")}
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
    </main>
  );
}
