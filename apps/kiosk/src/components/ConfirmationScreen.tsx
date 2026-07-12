/**
 * KIOSK-004 — ConfirmationScreen.tsx
 * Saisie du numéro de téléphone + émission de ticket — refonte v2.
 * Clavier numérique natif (pas de clavier OS) sur --night, cibles ≥ 72px.
 * Tokens @sigfa/ui uniquement, aucune valeur hex en dur.
 */
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { createSigfaClient } from "@sigfa/contracts";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import { useOfflineTicket } from "@/hooks/useOfflineTicket";
import { OfflineBanner } from "@/components/OfflineBanner";
import { storeTicketMomentPii, purgeTicketMomentPii } from "@/lib/ticket-moment-store";
import {
  signalKioskSystemError,
  noopDegradedSink,
  type DegradedEventSink,
} from "@/lib/kiosk-degraded-emitter";

interface ConfirmationScreenProps {
  serviceId: string;
  /**
   * MODEL-KIOSK-A : opération choisie (parcours 2 niveaux, additif). Envoyée
   * au serveur avec le ticket ; `serviceId` reste transmis (rétrocompat +
   * dérivation serveur). Absente pour un parcours 1 niveau (service direct).
   */
  operationId?: string;
  agencyId: string;
  /**
   * KIOSK-007 : sink d'événement simulé (F4) pour `alert:manager
   * KIOSK_SYSTEM_ERROR`. Défaut : no-op — l'émission RÉELLE appartient au
   * serveur. Injecté par les tests pour vérifier l'intention d'émission.
   */
  systemErrorSink?: DegradedEventSink;
}

/** KIOSK-007 : nombre total de tentatives POST /public/tickets avant erreur système. */
const MAX_TICKET_ATTEMPTS = 2;

// Validate CI phone number: 10 digits starting with 0
const CI_PHONE_REGEX = /^0[0-9]{9}$/;

const KEYPAD_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "⌫"],
];

export function ConfirmationScreen({
  serviceId,
  operationId,
  agencyId,
  systemErrorSink = noopDegradedSink,
}: ConfirmationScreenProps) {
  const t = useTranslations("confirmation004");
  const tDeg = useTranslations("degraded007");
  const router = useRouter();
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";
  const { createOfflineTicket, syncPendingTickets } = useOfflineTicket();

  const [phoneDigits, setPhoneDigits] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [isOffline, setIsOffline] = useState(false);
  // KIOSK-007 : erreur système (500 ×2) → message humain, pas de bascule offline.
  const [isSystemError, setIsSystemError] = useState(false);

  useInactivityTimeout(() => {
    router.push(`/${currentLocale}`);
  }, 30000);

  // KIOSK-006 : au retour réseau, déclenche automatiquement la synchronisation
  // des tickets offline en attente (POST /tickets/sync via @sigfa/contracts).
  // Le bandeau offline disparaît alors en fondu (250 ms) via <OfflineBanner>.
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      void syncPendingTickets();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [syncPendingTickets]);

  const handleKey = (key: string) => {
    if (key === "⌫") {
      setPhoneDigits((prev) => prev.slice(0, -1));
      setPhoneError("");
    } else if (key === "*") {
      // Star key: not used for phone input
    } else if (phoneDigits.length < 10) {
      setPhoneDigits((prev) => prev + key);
      setPhoneError("");
    }
  };

  /**
   * S6 : l'URL /ticket ne transporte plus AUCUNE PII (borne PARTAGÉE, UEMOA).
   * Le téléphone + le consentement transitent par le store mémoire
   * (`ticket-moment-store`, purge après affichage/timeout) ; l'URL ne porte
   * que les données publiques du Moment Ticket.
   */
  const buildTicketUrl = (
    data: {
      trackingId: string;
      displayNumber: string;
      position: number;
      estimatedWaitMinutes: number;
    },
    pii: { phoneNumber?: string; smsConsent?: boolean }
  ) => {
    if (pii.phoneNumber) {
      storeTicketMomentPii({
        phoneNumber: pii.phoneNumber,
        smsConsent: pii.smsConsent ?? false,
      });
    } else {
      // Aucun téléphone transmis (skip) : aucune PII résiduelle en mémoire.
      purgeTicketMomentPii();
    }
    const params = new URLSearchParams({
      trackingId: data.trackingId,
      displayNumber: data.displayNumber,
      position: String(data.position),
      estimatedWaitMinutes: String(data.estimatedWaitMinutes),
    });
    return `/${currentLocale}/ticket?${params.toString()}`;
  };

  const handleSubmit = async (skipPhone: boolean) => {
    // Validate phone if not skipping
    if (!skipPhone && phoneDigits.length > 0) {
      if (!CI_PHONE_REGEX.test(phoneDigits)) {
        setPhoneError(t("errorPhone"));
        return;
      }
    }

    setIsLoading(true);
    setPhoneError("");
    setIsSystemError(false);

    const finalPhone = skipPhone ? undefined : (phoneDigits || undefined);
    const finalConsent = finalPhone ? smsConsent : undefined;

    const client = createSigfaClient(
      "public",
      // RT-001b : défaut mock canonique unifié web/kiosk (mock Prism :4010).
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010"
    );

    let lastStatus = 0;
    try {
      // KIOSK-007 : jusqu'à MAX_TICKET_ATTEMPTS tentatives. Un 5xx est réessayé ;
      // un 201 navigue ; un échec réseau (exception) bascule en offline.
      for (let attempt = 1; attempt <= MAX_TICKET_ATTEMPTS; attempt += 1) {
        const { data, response } = await client.POST("/public/tickets", {
          params: {
            header: {
              "X-Idempotency-Key": crypto.randomUUID(),
            },
          },
          body: {
            serviceId,
            // MODEL-KIOSK-A : operationId additif si présent (le serveur dérive
            // serviceId = operation.serviceId). serviceId reste envoyé (rétrocompat).
            ...(operationId ? { operationId } : {}),
            channel: "KIOSK",
            phoneNumber: finalPhone,
            smsConsent: finalConsent,
            agencyId,
          },
        });
        lastStatus = response.status;

        if (response.status === 201 && data) {
          router.push(buildTicketUrl(
            {
              trackingId: data.trackingId,
              displayNumber: data.displayNumber ?? data.number,
              position: data.position,
              estimatedWaitMinutes: data.estimatedWaitMinutes,
            },
            { phoneNumber: finalPhone, smsConsent: finalConsent }
          ));
          return;
        }

        // 5xx : on réessaie tant qu'il reste des tentatives.
        if (response.status >= 500 && attempt < MAX_TICKET_ATTEMPTS) {
          continue;
        }
        break;
      }

      // KIOSK-007 : 5xx après épuisement des tentatives → erreur système.
      // Message humain + alerte silencieuse KIOSK_SYSTEM_ERROR (jamais offline).
      if (lastStatus >= 500) {
        setIsSystemError(true);
        signalKioskSystemError(
          { serviceId, agencyId, status: lastStatus },
          systemErrorSink
        );
        return;
      }

      // Autres non-201 (4xx…) : repli offline pour ne pas bloquer l'usager.
      setIsOffline(true);
      const offlineTicket = await createOfflineTicket({ serviceId, ...(operationId ? { operationId } : {}), agencyId });
      router.push(buildTicketUrl(
        {
          trackingId: offlineTicket.trackingId,
          displayNumber: offlineTicket.displayNumber,
          position: offlineTicket.position,
          estimatedWaitMinutes: offlineTicket.estimatedWaitMinutes,
        },
        { phoneNumber: finalPhone, smsConsent: finalConsent }
      ));
      return;
    } catch {
      // Network error: use offline fallback
      setIsOffline(true);
      const offlineTicket = await createOfflineTicket({ serviceId, ...(operationId ? { operationId } : {}), agencyId });
      router.push(buildTicketUrl(
        {
          trackingId: offlineTicket.trackingId,
          displayNumber: offlineTicket.displayNumber,
          position: offlineTicket.position,
          estimatedWaitMinutes: offlineTicket.estimatedWaitMinutes,
        },
        { phoneNumber: finalPhone, smsConsent: finalConsent }
      ));
      return;
    } finally {
      setIsLoading(false);
    }
  };

  const showSmsConsent = phoneDigits.length > 0;

  return (
    <main
      role="main"
      style={{
        backgroundColor: "var(--surface-kiosk)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "var(--space-8)",
        gap: "var(--space-6)",
        maxWidth: "760px",
        marginInline: "auto",
        width: "100%",
      }}
    >
      {/* KIOSK-006 : bandeau offline discret (--info, non bloquant), fondu 250 ms au retour réseau */}
      <OfflineBanner isOffline={isOffline} />

      {/* KIOSK-007 — Erreur système (500 ×2). Message humain, registre SIGFA.
          Token --danger sur le PICTOGRAMME UNIQUEMENT, jamais le fond. */}
      {isSystemError && (
        <section
          data-testid="system-error"
          role="alert"
          style={{
            backgroundColor: "var(--surface-1)",
            borderRadius: "var(--r-lg)",
            boxShadow: "var(--shadow-2)",
            padding: "var(--space-6)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-4)",
          }}
        >
          <span
            data-testid="system-error-pictogram"
            aria-hidden="true"
            style={{ fontSize: "40px", color: "var(--danger)", lineHeight: 1 }}
          >
            ⚠
          </span>
          <span style={{ fontSize: "24px", color: "var(--ink-strong)" }}>
            {tDeg("systemError")}
          </span>
        </section>
      )}

      {/* Title */}
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "24px",
          color: "var(--ink-inverse)",
          fontWeight: 600,
          textAlign: "center",
          margin: 0,
        }}
      >
        {t("title")}
      </h1>

      {/* Phone display */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          backgroundColor: "var(--surface-1)",
          borderRadius: "var(--r-md)",
          boxShadow: "var(--shadow-1)",
          padding: "var(--space-4) var(--space-6)",
        }}
      >
        <span style={{ fontSize: "24px", color: "var(--ink-soft)" }}>
          {t("phonePrefix")}
        </span>
        <input
          data-testid="phone-input"
          type="text"
          readOnly
          value={phoneDigits}
          placeholder={t("phonePlaceholder")}
          style={{
            flex: 1,
            fontSize: "24px",
            color: "var(--ink-strong)",
            background: "none",
            border: "none",
            outline: "none",
          }}
        />
      </div>

      {/* Phone error */}
      {phoneError && (
        <div
          data-testid="phone-error"
          style={{
            color: "var(--danger)",
            fontSize: "20px",
            textAlign: "center",
          }}
        >
          {phoneError}
        </div>
      )}

      {/* SMS Consent */}
      {showSmsConsent && (
        <label
          data-testid="sms-consent"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            fontSize: "20px",
            color: "var(--ink-inverse)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={smsConsent}
            onChange={(e) => setSmsConsent(e.target.checked)}
            style={{ width: "24px", height: "24px", accentColor: "var(--brand)" }}
          />
          {t("smsConsent")}
        </label>
      )}

      {/* Numeric Keypad */}
      <div
        data-testid="keypad"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "var(--space-4)",
          flex: 1,
        }}
      >
        {KEYPAD_ROWS.flat().map((key, idx) => (
          <button
            key={idx}
            data-testid="keypad-key"
            onClick={() => handleKey(key)}
            disabled={isLoading}
            style={{
              minWidth: "72px",
              minHeight: "72px",
              fontSize: "28px",
              fontWeight: 600,
              color: "var(--ink-strong)",
              backgroundColor: "var(--surface-1)",
              border: "1px solid var(--hairline)",
              boxShadow: "var(--shadow-1)",
              borderRadius: "var(--r-md)",
              cursor: isLoading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {key}
          </button>
        ))}
      </div>

      {/* CTA Button */}
      <button
        data-testid="cta-btn"
        onClick={() => { void handleSubmit(false); }}
        disabled={isLoading}
        style={{
          minHeight: "88px",
          backgroundColor: "var(--brand)",
          color: "var(--brand-contrast)",
          fontSize: "28px",
          fontWeight: 600,
          border: "none",
          boxShadow: "var(--shadow-brand)",
          borderRadius: "var(--r-lg)",
          cursor: isLoading ? "not-allowed" : "pointer",
        }}
      >
        {isLoading ? t("loadingMessage") : t("ctaButton")}
      </button>

      {/* Skip Button */}
      <button
        data-testid="skip-btn"
        onClick={() => { void handleSubmit(true); }}
        disabled={isLoading}
        style={{
          minHeight: "72px",
          backgroundColor: "transparent",
          color: "var(--ink-inverse)",
          fontSize: "28px",
          border: "2px solid var(--ink-inverse)",
          borderRadius: "var(--r-lg)",
          cursor: isLoading ? "not-allowed" : "pointer",
        }}
      >
        {t("skipButton")}
      </button>
    </main>
  );
}
