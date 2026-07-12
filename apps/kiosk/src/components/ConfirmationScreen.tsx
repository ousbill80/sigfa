/**
 * KIOSK-004 — ConfirmationScreen.tsx
 * Saisie du numéro de téléphone + émission de ticket.
 * Clavier numérique natif (pas de clavier OS).
 */
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { createSigfaClient } from "@sigfa/contracts";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import { useOfflineTicket } from "@/hooks/useOfflineTicket";
import { OfflineBanner } from "@/components/OfflineBanner";

interface ConfirmationScreenProps {
  serviceId: string;
  agencyId: string;
}

// Validate CI phone number: 10 digits starting with 0
const CI_PHONE_REGEX = /^0[0-9]{9}$/;

const KEYPAD_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "⌫"],
];

export function ConfirmationScreen({ serviceId, agencyId }: ConfirmationScreenProps) {
  const t = useTranslations("confirmation004");
  const router = useRouter();
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";
  const { createOfflineTicket, syncPendingTickets } = useOfflineTicket();

  const [phoneDigits, setPhoneDigits] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [isOffline, setIsOffline] = useState(false);

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

  const buildTicketUrl = (data: {
    trackingId: string;
    displayNumber: string;
    position: number;
    estimatedWaitMinutes: number;
  }) => {
    const params = new URLSearchParams({
      trackingId: data.trackingId,
      displayNumber: data.displayNumber,
      position: String(data.position),
      estimatedWaitMinutes: String(data.estimatedWaitMinutes),
    });
    if (phoneDigits.length > 0) {
      params.set("phoneNumber", phoneDigits);
      params.set("smsConsent", String(smsConsent));
    }
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

    const finalPhone = skipPhone ? undefined : (phoneDigits || undefined);
    const finalConsent = finalPhone ? smsConsent : undefined;

    try {
      const client = createSigfaClient(
        "public",
        // RT-001b : défaut mock canonique unifié web/kiosk (mock Prism :4010).
        process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010"
      );

      const { data, response } = await client.POST("/public/tickets", {
        params: {
          header: {
            "X-Idempotency-Key": crypto.randomUUID(),
          },
        },
        body: {
          serviceId,
          channel: "KIOSK",
          phoneNumber: finalPhone,
          smsConsent: finalConsent,
          agencyId,
        },
      });

      if (response.status === 201 && data) {
        router.push(buildTicketUrl({
          trackingId: data.trackingId,
          displayNumber: data.displayNumber ?? data.number,
          position: data.position,
          estimatedWaitMinutes: data.estimatedWaitMinutes,
        }));
        return;
      }

      // Non-201 response: use offline fallback to avoid blocking user
      if (response.status !== 201) {
        setIsOffline(true);
        const offlineTicket = await createOfflineTicket({ serviceId, agencyId });
        router.push(buildTicketUrl({
          trackingId: offlineTicket.trackingId,
          displayNumber: offlineTicket.displayNumber,
          position: offlineTicket.position,
          estimatedWaitMinutes: offlineTicket.estimatedWaitMinutes,
        }));
        return;
      }
    } catch {
      // Network error: use offline fallback
      setIsOffline(true);
      const offlineTicket = await createOfflineTicket({ serviceId, agencyId });
      router.push(buildTicketUrl({
        trackingId: offlineTicket.trackingId,
        displayNumber: offlineTicket.displayNumber,
        position: offlineTicket.position,
        estimatedWaitMinutes: offlineTicket.estimatedWaitMinutes,
      }));
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
        padding: "2rem",
        gap: "1.5rem",
      }}
    >
      {/* KIOSK-006 : bandeau offline discret (--info, non bloquant), fondu 250 ms au retour réseau */}
      <OfflineBanner isOffline={isOffline} />

      {/* Title */}
      <h1
        style={{
          fontSize: "24px",
          color: "var(--ink-inverse)",
          fontWeight: "bold",
          textAlign: "center",
        }}
      >
        {t("title")}
      </h1>

      {/* Phone display */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          backgroundColor: "var(--surface-1)",
          borderRadius: "0.5rem",
          padding: "1rem 1.5rem",
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
            color: "var(--ink-inverse)",
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
            gap: "0.75rem",
            fontSize: "20px",
            color: "var(--ink-inverse)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={smsConsent}
            onChange={(e) => setSmsConsent(e.target.checked)}
            style={{ width: "24px", height: "24px" }}
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
          gap: "1rem",
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
              fontWeight: "bold",
              color: "var(--ink-inverse)",
              backgroundColor: "var(--surface-1)",
              border: "none",
              borderRadius: "0.5rem",
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
          color: "var(--ink-inverse)",
          fontSize: "28px",
          fontWeight: "bold",
          border: "none",
          borderRadius: "0.75rem",
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
          backgroundColor: "var(--surface-1)",
          color: "var(--ink-soft)",
          fontSize: "28px",
          border: "none",
          borderRadius: "0.75rem",
          cursor: isLoading ? "not-allowed" : "pointer",
        }}
      >
        {t("skipButton")}
      </button>
    </main>
  );
}
