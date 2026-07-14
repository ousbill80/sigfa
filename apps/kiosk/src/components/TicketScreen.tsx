/**
 * KIOSK-005 — TicketScreen.tsx
 * Le « Moment Ticket » — HÉROS de l'expérience client. Refonte v2 : numéro en
 * --display or sur --night, halo doré, entrée « spring ». Composé avec le
 * composant `TicketMoment` de @sigfa/ui. Voix Web Speech API.
 *
 * KIOSK-007 — États dégradés imprimante (bascule transparente) :
 *   - printerStatus dégradé (`PAPER_LOW | ERROR | OFFLINE`) OU réseau coupé
 *     après le 201 avant confirmation imprimante → affichage prolongé (20 s) +
 *     message « Photographiez votre numéro ou recevez-le par SMS ». AUCUNE
 *     mention de panne côté client (bascule invisible pour l'usager).
 *
 * KIOSK-005b — Audit UX borne 2026-07-14 (F4/F5/F8/F9) :
 *   - F4 : layout sain à 1024×768 ET 1920×1080 — marges navigateur des <p> de
 *     la carte remises à zéro (le kiosque n'a pas de reset global), gabarit
 *     compacté sous 820 px de hauteur. Zéro chevauchement, zéro scroll.
 *   - F5 : ticket émis HORS-LIGNE → affichage HONNÊTE. Bandeau « ticket
 *     temporaire », « estimation à la reconnexion » — plus jamais
 *     « Position : 1e — 0 minutes » mensongers. Voix honnête aussi.
 *   - F8 : position/attente affichées UNE seule fois (l'eyebrow de la carte
 *     porte désormais l'OPÉRATION choisie — vérification d'un coup d'œil) ;
 *     l'accessibilité vocale KIOSK-008 (data-a11y-text) est préservée.
 *   - F9 : retour accueil 10 s (20 s accessibilité/dégradé) avec compte à
 *     rebours VISIBLE + bouton « Terminer » ; le décompte attend la fin de la
 *     synthèse vocale.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { TicketMoment } from "@sigfa/ui";
import { deriveDegradedState, type PrinterStatus } from "@/hooks/useDegradedState";
import { useVoiceAnnouncement } from "@/hooks/useVoiceAnnouncement";
import { VoiceButton } from "@/components/VoiceButton";
import { PrintTicket } from "@/components/PrintTicket";
import { shouldAutoPrintTicket, triggerTicketPrint } from "@/lib/kiosk-print";
import { kioskAgencyName, kioskBankName } from "@/lib/kiosk-branding";
import { OfflineBanner } from "@/components/OfflineBanner";
import {
  A11Y_BASE_FONT_PX,
  A11Y_TICKET_RETURN_MS,
  NOMINAL_TICKET_RETURN_MS,
  accessibilityFontSizePx,
  type VoiceAnnouncementInput,
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
  /**
   * KIOSK-005b (audit F8) + KIOSK-BORNE : libellé PUBLIC de l'opération choisie
   * (non-PII, ex. « Retrait espèces », transite par l'URL) — affiché en eyebrow
   * de la carte (vérification d'un coup d'œil) ET imprimé sur le ticket 80 mm.
   * Absent → eyebrow neutre.
   */
  serviceLabel?: string;
  /**
   * KIOSK-005b (audit F5) : vrai si le ticket a été émis HORS-LIGNE (numéro
   * local Dexie). Position/attente locales ne sont PAS fiables → affichage
   * honnête (« estimation à la reconnexion »), bandeau ticket temporaire.
   */
  isOfflineTicket?: boolean;
  isAccessibilityMode?: boolean;
  /**
   * KIOSK-007 : vrai si le réseau a été coupé APRÈS le 201 mais AVANT
   * confirmation imprimante → bascule dégradée identique (affichage 20 s).
   */
  networkLostBeforePrinterConfirm?: boolean;
  /**
   * KIOSK-BORNE : trackingId public (nanoid 21) — code de suivi court sur le
   * ticket imprimé. Donnée publique, non-PII.
   */
  trackingId?: string;
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

/** Vrai si la synthèse vocale est en train de parler (décompte suspendu). */
function isSpeechSpeaking(): boolean {
  if (typeof window === "undefined") return false;
  return window.speechSynthesis?.speaking ?? false;
}

/**
 * Audit F4 — gabarit du Moment Ticket, SCOPÉ à l'écran (aucun style global) :
 *  - le kiosque n'a pas de reset CSS : les <p> de la carte TicketMoment
 *    (@sigfa/ui) gardaient leurs marges navigateur (jusqu'à ~76 px autour du
 *    numéro --display) et poussaient position/attente sous la ligne de
 *    flottaison à 1024×768 — d'où les textes superposés de la capture 27 ;
 *  - sous 820 px de hauteur (borne 1024×768), respirations resserrées via
 *    tokens (--space-*) : tout tient au-dessus du pli, zéro scroll, zéro
 *    chevauchement. À 1920×1080 le gabarit nominal respire.
 */
const TICKET_LAYOUT_CSS = `
.sigfa-ticket-screen { box-sizing: border-box; padding: var(--space-8); gap: var(--space-6); }
.sigfa-ticket-screen .sig-ticket p { margin: 0; }
@media (max-height: 820px) {
  .sigfa-ticket-screen { padding: var(--space-4) var(--space-8); gap: var(--space-3); }
  .sigfa-ticket-screen .sig-ticket { gap: var(--space-3); padding: var(--space-6) var(--space-10); }
  .sigfa-ticket-screen .sig-ticket__actions { margin-top: 0; }
}
`;

export function TicketScreen({
  displayNumber,
  position,
  estimatedWaitMinutes,
  printerStatus,
  phoneNumber,
  smsConsent,
  managerName,
  serviceLabel,
  isOfflineTicket = false,
  isAccessibilityMode = false,
  networkLostBeforePrinterConfirm = false,
  trackingId,
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

  // KIOSK-007 : bascule transparente. L'affichage dégradé prolonge à 20 s ;
  // le mode accessibilité prolonge lui aussi à 20 s → on prend le max.
  const degraded = deriveDegradedState({
    printerStatus,
    networkLostBeforePrinterConfirm,
  });
  const returnDelayMs =
    isAccessibilityMode || degraded.isDisplayDegraded
      ? A11Y_TICKET_RETURN_MS
      : NOMINAL_TICKET_RETURN_MS;

  // KIOSK-005b (audit F9) — compte à rebours VISIBLE avant retour accueil.
  // Décrément chaque seconde, SUSPENDU tant que la synthèse vocale parle
  // (l'annonce ~8 s n'est plus jamais coupée par le reset).
  const [secondsLeft, setSecondsLeft] = useState(returnDelayMs / 1000);
  useEffect(() => {
    const interval = setInterval(() => {
      if (isSpeechSpeaking()) return;
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (secondsLeft <= 0) {
      router.push(`/${currentLocale}`);
    }
  }, [secondsLeft, router, currentLocale]);

  // Annonce vocale (une seule fois) — KIOSK-008 : registre SIGFA, langue de
  // session, voix ralentie (rate 0.8) et repli FR gérés par le hook.
  // Audit F5 : hors-ligne → registre honnête (jamais de fausse position).
  const announcement: VoiceAnnouncementInput = {
    displayNumber,
    position,
    estimatedWaitMinutes,
    ...(isOfflineTicket ? { isOffline: true } : {}),
  };
  useEffect(() => {
    if (hasAnnouncedRef.current) return;
    hasAnnouncedRef.current = true;
    announce(announcement);
  }, [announce, announcement]);

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
      className="sigfa-ticket-screen"
      style={{
        backgroundColor: "var(--surface-kiosk)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Audit F4 : gabarit scopé (reset des marges de la carte + compaction
          sous 820 px de hauteur). Tokens uniquement, aucun style global. */}
      <style>{TICKET_LAYOUT_CSS}</style>

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

      {/* Audit F5 : ticket émis hors-ligne → bandeau honnête « Mode hors
          connexion — ticket temporaire » (clé ticket005 enfin câblée). */}
      {isOfflineTicket && (
        <OfflineBanner isOffline={true} namespace="ticket005" />
      )}

      {/* Le HÉROS — numéro or sur night + halo, entrée spring (composant UI).
          Audit F8 : l'eyebrow porte l'OPÉRATION choisie (ou un libellé neutre),
          le message porte l'attente — position/attente ne sont plus dupliquées. */}
      <TicketMoment
        eyebrow={serviceLabel ?? t("eyebrow")}
        ticketNumber={displayNumber}
        message={
          isOfflineTicket
            ? t("offlineEstimate")
            : t("waitEstimate", { minutes: estimatedWaitMinutes })
        }
        data-animate={reducedMotion ? undefined : "pulse"}
        style={{ width: "100%", maxWidth: "760px" }}
        actions={
          <VoiceButton
            announcement={announcement}
            isAccessibilityMode={isAccessibilityMode}
          />
        }
      />

      {/* Position (texte a11y, contraste ≥ 7:1) — porte data-a11y-text + le
          facteur d'accessibilité attendus par KIOSK-008. Audit F5 : masquée
          sur le chemin hors-ligne (position locale non fiable). */}
      {!isOfflineTicket && (
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
      )}

      {/* Audit F5 : chemin hors-ligne → information de synchronisation honnête
          (texte a11y ≥ 7:1, facteur accessibilité préservé). */}
      {isOfflineTicket && (
        <p
          data-testid="ticket-offline-info"
          data-a11y-text="true"
          style={{
            fontSize: `${baseTextPx}px`,
            color: "var(--ink-inverse)",
            textAlign: "center",
            fontWeight: 600,
            margin: 0,
          }}
        >
          {t("offlineInfo")}
        </p>
      )}

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

      {/* Printer status OK — consigne d'impression (aucun état dégradé).
          Audit F6 : --success ne fait que 3.49:1 sur --night → variante
          on-night --success-inv (10.6:1 mesuré, borne plein soleil). */}
      {printerStatus === "OK" && !degraded.isDisplayDegraded && !isOfflineTicket && (
        <p
          data-testid="print-message"
          style={{
            fontSize: "24px",
            color: "var(--success-inv)",
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

      {/* SMS confirmation — même variante on-night que la consigne (F6). */}
      {phoneNumber && smsConsent && (
        <p
          data-testid="sms-sent"
          style={{
            fontSize: "20px",
            color: "var(--success-inv)",
            textAlign: "center",
            margin: 0,
          }}
        >
          {t("smsSent", { maskedPhone: maskPhoneNumber(phoneNumber) })}
        </p>
      )}

      {/* Audit F9 — compte à rebours visible + sortie explicite « Terminer ».
          aria-live=off : le décompte ne doit pas parasiter l'annonce vocale. */}
      <div
        data-testid="ticket-countdown-row"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-6)",
          flexWrap: "wrap",
        }}
      >
        <p
          data-testid="ticket-returning"
          aria-live="off"
          style={{
            fontSize: "24px",
            color: "var(--ink-muted-inv)",
            textAlign: "center",
            margin: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {t("returning", { seconds: secondsLeft })}
        </p>
        <button
          type="button"
          data-testid="ticket-finish-btn"
          onClick={() => router.push(`/${currentLocale}`)}
          style={{
            minHeight: "72px",
            minWidth: "200px",
            fontSize: "24px",
            fontWeight: 600,
            color: "var(--ink-inverse)",
            backgroundColor: "transparent",
            border: "2px solid var(--ink-inverse)",
            borderRadius: "var(--r-md)",
            cursor: "pointer",
            padding: "var(--space-2) var(--space-6)",
          }}
        >
          {t("finishButton")}
        </button>
      </div>
    </main>
  );
}
