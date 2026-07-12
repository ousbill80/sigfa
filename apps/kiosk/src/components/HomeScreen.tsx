/**
 * KIOSK-002 — HomeScreen.tsx
 * Écran d'accueil / sélection de langue — refonte v2 « Sérénité Premium ».
 * Fond --night qui vibre l'or, respiration généreuse, cartes chaudes.
 * FR/EN uniquement (décision PO). Tokens @sigfa/ui, aucune valeur hex en dur.
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
  labelKey: "languageFr" | "languageEn";
  icon: string;
}

const LANGUAGE_CARDS: LanguageCard[] = [
  { locale: "fr", labelKey: "languageFr", icon: "🇫🇷" },
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
        justifyContent: "center",
        padding: "var(--space-16) var(--space-8)",
        gap: "var(--space-8)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Halo or discret — signature v2 sur night (décoratif, non interactif). */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "-18%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "640px",
          height: "640px",
          borderRadius: "var(--r-full)",
          background:
            "radial-gradient(circle, var(--gold-soft) 0%, rgba(199,154,58,0.10) 42%, transparent 70%)",
          opacity: 0.28,
          pointerEvents: "none",
        }}
      />

      {/* Offline banner (--info doux) — conserve data-testid + token --info attendus. */}
      {isOffline && (
        <div
          data-testid="offline-banner"
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            top: "var(--space-6)",
            left: "var(--space-6)",
            right: "var(--space-6)",
            backgroundColor: "var(--info)",
            color: "var(--ink-inverse)",
            textAlign: "center",
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--r-md)",
            fontSize: "20px",
          }}
        >
          {t("offlineBanner")}
        </div>
      )}

      {/* Title */}
      <div
        style={{
          position: "relative",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-4xl)",
            fontWeight: 700,
            letterSpacing: "var(--tracking-tight)",
            lineHeight: "var(--leading-tight)",
            color: "var(--ink-inverse)",
            margin: 0,
          }}
        >
          {t("title")}
        </h1>
        <p
          style={{
            fontSize: "var(--text-xl)",
            color: "var(--ink-muted-inv)",
            margin: 0,
          }}
        >
          {t("chooseLanguage")}
        </p>
      </div>

      {/* Language cards grid (FR/EN) — cibles généreuses ≥ 120px. */}
      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "var(--space-6)",
          width: "100%",
          maxWidth: "760px",
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
              borderRadius: "var(--r-lg)",
              border: "1px solid var(--hairline)",
              boxShadow: "var(--shadow-2)",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--space-3)",
              padding: "var(--space-8)",
            }}
          >
            <span
              data-testid="card-icon"
              aria-hidden="true"
              style={{ fontSize: "48px", lineHeight: 1 }}
            >
              {card.icon}
            </span>
            <span
              data-testid="card-label"
              style={{
                fontSize: "28px",
                fontWeight: 600,
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
          position: "relative",
          fontSize: "20px",
          color: "var(--ink-muted-inv)",
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
