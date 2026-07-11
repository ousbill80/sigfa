/**
 * KIOSK-002 — HomeScreen.tsx
 * Écran d'accueil / sélection de langue.
 * Tokens CSS uniquement, 4 cartes de langue.
 */
"use client";

import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { useQueueStatus } from "@/hooks/useQueueStatus";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import { useAccessibilityMode } from "@/hooks/useAccessibilityMode";

interface HomeScreenProps {
  /** Override for offline state (useful for testing) */
  isOffline?: boolean;
}

interface LanguageCard {
  locale: string;
  labelKey: "languageFr" | "languageDioula" | "languageBaoule" | "languageEn";
  icon: string;
}

const LANGUAGE_CARDS: LanguageCard[] = [
  { locale: "fr", labelKey: "languageFr", icon: "🇫🇷" },
  { locale: "dioula", labelKey: "languageDioula", icon: "🌍" },
  { locale: "baoule", labelKey: "languageBaoule", icon: "🌿" },
  { locale: "en", labelKey: "languageEn", icon: "🇬🇧" },
];

export function HomeScreen({ isOffline: isOfflineProp }: HomeScreenProps = {}) {
  const t = useTranslations("home002");
  const router = useRouter();
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";
  const { count, estimatedMinutes, isOffline: isOfflineHook } = useQueueStatus();
  const { isAccessibilityMode } = useAccessibilityMode();

  const isOffline = isOfflineProp !== undefined ? isOfflineProp : isOfflineHook;

  const timeoutMs = isAccessibilityMode ? 60000 : 30000;

  useInactivityTimeout(() => {
    router.push(`/${currentLocale}`);
  }, timeoutMs);

  const handleLanguageSelect = (locale: string) => {
    // Web Speech API voice announcement
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(locale);
      utterance.lang = locale === "fr" ? "fr-FR" : "en-US";
      window.speechSynthesis.speak(utterance);
    }
    router.push(`/${locale}/services`);
  };

  return (
    <main
      role="main"
      style={{
        backgroundColor: "var(--surface-kiosk)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "2rem",
        position: "relative",
      }}
    >
      {/* Offline banner */}
      {isOffline && (
        <div
          data-testid="offline-banner"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            backgroundColor: "var(--info)",
            color: "var(--ink-inverse)",
            textAlign: "center",
            padding: "0.75rem 1rem",
            fontSize: "20px",
          }}
        >
          {t("offlineBanner")}
        </div>
      )}

      {/* Title */}
      <h1
        style={{
          fontSize: "40px",
          fontWeight: "bold",
          textAlign: "center",
          color: "var(--ink-inverse)",
          marginTop: isOffline ? "4rem" : "2rem",
          marginBottom: "0.5rem",
        }}
      >
        {t("title")}
      </h1>

      <p
        style={{
          fontSize: "24px",
          color: "var(--ink-soft)",
          textAlign: "center",
          marginBottom: "2rem",
        }}
      >
        {t("chooseLanguage")}
      </p>

      {/* Language cards grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "1.5rem",
          width: "100%",
          maxWidth: "800px",
        }}
      >
        {LANGUAGE_CARDS.map((card) => (
          <button
            key={card.locale}
            data-testid="language-card"
            onClick={() => handleLanguageSelect(card.locale)}
            style={{
              minHeight: "120px",
              backgroundColor: "var(--surface-1)",
              borderRadius: "1rem",
              border: "none",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.75rem",
              padding: "1.5rem",
            }}
          >
            <span
              data-testid="card-icon"
              style={{
                fontSize: "40px",
                lineHeight: 1,
              }}
            >
              {card.icon}
            </span>
            <span
              data-testid="card-label"
              style={{
                fontSize: "28px",
                fontWeight: "bold",
                color: "var(--action-label)",
              }}
            >
              {t(card.labelKey)}
            </span>
          </button>
        ))}
      </div>

      {/* Queue status */}
      <div
        data-testid="queue-status"
        style={{
          marginTop: "2rem",
          fontSize: "20px",
          color: "var(--ink-soft)",
          textAlign: "center",
        }}
      >
        {count !== null && estimatedMinutes !== null
          ? t("queueStatus", { count, minutes: estimatedMinutes })
          : t("queueUnavailable")}
      </div>
    </main>
  );
}
