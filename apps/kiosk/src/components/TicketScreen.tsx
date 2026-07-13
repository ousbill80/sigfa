/**
 * KIOSK-005 — TicketScreen.tsx
 * Le « Moment Ticket » — HÉROS de l'expérience client. Refonte v2 : numéro en
 * --display or sur --night, halo doré, entrée « spring ». Composé avec le
 * composant `TicketMoment` de @sigfa/ui. Voix Web Speech API, retour auto 4 s
 * (8 s en accessibilité / dégradé).
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
import { TicketMoment } from "@sigfa/ui";
import { deriveDegradedState, type PrinterStatus } from "@/hooks/useDegradedState";
import { useVoiceAnnouncement } from "@/hooks/useVoiceAnnouncement";
import { VoiceButton } from "@/components/VoiceButton";
import { PrintTicket } from "@/components/PrintTicket";
import { shouldAutoPrintTicket, triggerTicketPrint } from "@/lib/kiosk-print";
import { kioskAgencyName, kioskBankName } from "@/lib/kiosk-branding";
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
  /**
   * MODEL-KIOSK-B (finition) : nom du conseiller ciblé (public, non-PII). Rappel
   * discret « Vous verrez : {name} » sur le Moment Ticket — réassurance. Présent
   * sur le chemin conseiller uniquement ; le chemin opération reste inchangé.
   */
  managerName?: string;
  isAccessibilityMode?: boolean;
  /**
   * KIOSK-007 : vrai si le réseau a été coupé APRÈS le 201 mais AVANT
   * confirmation imprimante → bascule dégradée identique (affichage 8 s).
   */
  networkLostBeforePrinterConfirm?: boolean;
  /**
   * KIOSK-BORNE : trackingId public (nanoid 21) — code de suivi court sur le
   * ticket imprimé. Donnée publique, non-PII.
   */
  trackingId?: string;
  /**
   * KIOSK-BORNE : libellé public de l'opération/service choisi, imprimé sur
   * le ticket (transite par l'URL — non-PII).
   */
  serviceLabel?: string;
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
  managerName,
  isAccessibilityMode = false,
  networkLostBeforePrinterConfirm = false,
  trackingId,
  serviceLabel,
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

  // KIOSK-BORNE — Impression automatique UNE SEULE FOIS, UNIQUEMENT si
  // l'imprimante est confirmée OK et hors de tout état dégradé/offline
  // (décision pure `shouldAutoPrintTicket`). En Electron : impression
  // silencieuse via IPC ; sinon repli window.print(). Le mode dégradé
  // KIOSK-007 (« Photographiez votre numéro ») n'imprime JAMAIS.
  const shouldPrint = shouldAutoPrintTicket({
    printerStatus,
    networkLostBeforePrinterConfirm,
    isBrowserOnline:
      typeof navigator === "undefined" ? undefined : navigator.onLine,
  });
  const hasPrintedRef = useRef(false);
  useEffect(() => {
    if (!shouldPrint || hasPrintedRef.current) return;
    hasPrintedRef.current = true;
    triggerTicketPrint();
  }, [shouldPrint]);

  const reducedMotion = prefersReducedMotion();

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
        padding: "var(--space-8)",
        gap: "var(--space-6)",
      }}
    >
      {/* KIOSK-BORNE — Ticket thermique 80 mm : masqué à l'écran, SEUL rendu
          en @media print. Rendu uniquement quand l'impression est décidée
          (imprimante OK, aucun état dégradé). */}
      {shouldPrint && (
        <PrintTicket
          bankName={kioskBankName()}
          agencyName={kioskAgencyName()}
          serviceLabel={serviceLabel}
          displayNumber={displayNumber}
          position={position}
          estimatedWaitMinutes={estimatedWaitMinutes}
          trackingId={trackingId}
          smsConsent={Boolean(phoneNumber && smsConsent)}
        />
      )}

      {/* Le HÉROS — numéro or sur night + halo, entrée spring (composant UI). */}
      <TicketMoment
        eyebrow={t("position", { position })}
        ticketNumber={displayNumber}
        message={t("waitEstimate", { minutes: estimatedWaitMinutes })}
        data-animate={reducedMotion ? undefined : "pulse"}
        style={{ width: "100%", maxWidth: "760px" }}
        actions={
          <VoiceButton
            announcement={{ displayNumber, position, estimatedWaitMinutes }}
            isAccessibilityMode={isAccessibilityMode}
          />
        }
      />

      {/* Position (texte a11y, contraste ≥ 7:1) — porte data-a11y-text + le
          facteur d'accessibilité attendus par KIOSK-008. */}
      <p
        data-testid="ticket-position"
        data-a11y-text="true"
        style={{
          fontSize: `${baseTextPx}px`,
          color: "var(--ink-inverse)",
          textAlign: "center",
          fontWeight: 600,
          margin: 0,
        }}
      >
        {t("position", { position })}
      </p>

      {/* MODEL-KIOSK-B (finition) — Rappel discret du conseiller choisi sur le
          Moment Ticket (réassurance). Chemin conseiller UNIQUEMENT ; le chemin
          opération reste inchangé. Sobre, tokens uniquement, zéro emoji. */}
      {managerName && (
        <p
          data-testid="ticket-manager-reminder"
          style={{
            fontSize: "20px",
            color: "var(--ink-muted-inv)",
            textAlign: "center",
            margin: 0,
          }}
        >
          {t("managerReminder", { name: managerName })}
        </p>
      )}

      {/* Estimated wait — texte de base identique */}
      <p
        data-testid="ticket-wait"
        data-a11y-text="true"
        style={{
          fontSize: `${baseTextPx}px`,
          color: "var(--ink-inverse)",
          textAlign: "center",
          margin: 0,
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
            margin: 0,
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
            margin: 0,
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
            margin: 0,
          }}
        >
          {t("smsSent", { maskedPhone: maskPhoneNumber(phoneNumber) })}
        </p>
      )}
    </main>
  );
}
