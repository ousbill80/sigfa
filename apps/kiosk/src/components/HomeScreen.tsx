/**
 * KIOSK-002 — HomeScreen.tsx
 * Écran d'accueil / sélection de langue — refonte v2 « Sérénité Premium ».
 * Fond --night qui vibre l'or, respiration généreuse, cartes chaudes.
 * FR/EN uniquement (décision PO). Tokens @sigfa/ui, aucune valeur hex en dur.
 * Marque banque en tête : logo image si provisionné (NEXT_PUBLIC_BANK_LOGO_URL),
 * sinon repli pastille --brand + nom (cohérent KioskHeaderBanner). Zéro emoji :
 * les cartes de langue portent un monogramme « FR »/« EN » (badge graphique).
 */
"use client";

import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { useQueueStatus } from "@/hooks/useQueueStatus";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import { useAccessibilityMode } from "@/hooks/useAccessibilityMode";
import { speakInLocale, voiceRate } from "@/lib/kiosk-voice";
import {
  bankInitial,
  kioskAgencyName,
  kioskBankLogoUrl,
  kioskBankName,
} from "@/lib/kiosk-branding";
// Catalogues i18n importés en direct : l'annonce vocale doit être dite dans la
// langue CHOISIE (pas la locale courante de rendu) — source unique = clé
// `home002.languageName`, même racine `messages/` qu'i18n/request.ts.
/* eslint-disable no-restricted-imports, import/no-relative-parent-imports -- catalogues i18n hors src/ (cf. commentaire ci-dessus), même parade que lib/contracts-realtime.ts */
import frMessages from "../../messages/fr.json";
import enMessages from "../../messages/en.json";
/* eslint-enable no-restricted-imports, import/no-relative-parent-imports */

interface HomeScreenProps {
  /** Override for offline state (useful for testing) */
  isOffline?: boolean;
}

interface LanguageCard {
  locale: string;
  labelKey: "languageFr" | "languageEn";
  /** Monogramme graphique du badge (règle design : zéro emoji, jamais de drapeau). */
  monogram: string;
}

const LANGUAGE_CARDS: LanguageCard[] = [
  { locale: "fr", labelKey: "languageFr", monogram: "FR" },
  { locale: "en", labelKey: "languageEn", monogram: "EN" },
];

/** Nom parlé de la langue par locale (ajustement PO : la voix dit UNIQUEMENT
 * « Français » / « English », pas la phrase complète affichée à l'écran). */
const LANGUAGE_NAME_ANNOUNCEMENT: Record<string, string> = {
  fr: frMessages.home002.languageName,
  en: enMessages.home002.languageName,
};

export function HomeScreen({ isOffline: isOfflineProp }: HomeScreenProps = {}) {
  const t = useTranslations("home002");
  const router = useRouter();
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";
  const { count, estimatedMinutes, isOffline: isOfflineHook } = useQueueStatus();
  const { isAccessibilityMode } = useAccessibilityMode();

  const isOffline = isOfflineProp !== undefined ? isOfflineProp : isOfflineHook;

  // Identité d'enseigne (non-PII) — provisionnement borne, replis sûrs.
  const bankName = kioskBankName();
  const agencyName = kioskAgencyName();
  const bankLogoUrl = kioskBankLogoUrl();

  const timeoutMs = isAccessibilityMode ? 60000 : 30000;

  useInactivityTimeout(() => {
    router.push(`/${currentLocale}`);
  }, timeoutMs);

  const handleLanguageSelect = (locale: string) => {
    // Annonce vocale (Web Speech API) : UNIQUEMENT le nom de la langue choisie
    // (« Français » / « English »), jamais le code de locale brut ni la phrase
    // complète affichée à l'écran (ajustement PO). Repli FR par cohérence
    // avec kiosk-voice si une locale inconnue arrivait ici.
    // Mécanique commune `speakInLocale` (fix PO « la voix anglaise ne marche
    // pas ») : voix ANGLAISE explicitement posée sur l'utterance quand elle
    // existe, attente `voiceschanged` si la liste n'est pas encore chargée,
    // `cancel` avant `speak`.
    if (
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      window.speechSynthesis
    ) {
      speakInLocale(window.speechSynthesis, {
        locale,
        text: LANGUAGE_NAME_ANNOUNCEMENT[locale] ?? LANGUAGE_NAME_ANNOUNCEMENT.fr,
        rate: voiceRate(isAccessibilityMode),
      });
    }
    // MODEL-KIOSK-B : après la langue, la borne offre DEUX chemins clairs
    // (« Une opération » / « Voir mon conseiller ») via l'écran de choix.
    router.push(`/${locale}/choice`);
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

      {/* Marque banque — logo image si provisionné (fond transparent respecté),
          sinon repli pastille --brand + nom (cohérent KioskHeaderBanner). */}
      <div
        data-testid="home-brand"
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-4)",
        }}
      >
        {bankLogoUrl ? (
          /* <img> natif assumé : logo tenant (URL arbitraire), app en output:"export" sans optimiseur next/image. */
          <img
            data-testid="home-brand-logo"
            src={bankLogoUrl}
            alt={bankName}
            style={{
              height: "112px",
              width: "auto",
              maxWidth: "420px",
              objectFit: "contain",
              display: "block",
            }}
          />
        ) : (
          <>
            <span
              data-testid="home-brand-badge"
              aria-hidden="true"
              style={{
                width: "88px",
                height: "88px",
                borderRadius: "var(--r-lg)",
                backgroundColor: "var(--brand)",
                color: "var(--brand-contrast)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-display)",
                fontSize: "44px",
                fontWeight: 700,
              }}
            >
              {bankInitial(bankName)}
            </span>
            <span
              data-testid="home-brand-name"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-lg)",
                fontWeight: 600,
                letterSpacing: "var(--tracking-tight)",
                textTransform: "uppercase",
                color: "var(--ink-inverse)",
              }}
            >
              {bankName}
            </span>
          </>
        )}
      </div>

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
          data-testid="home-agency-line"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-2xl)",
            color: "var(--ink-muted-inv)",
            margin: 0,
          }}
        >
          {t("welcomeAgency", { agencyName })}
        </p>
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
            {/* Monogramme graphique (badge visuel, pas le message) — zéro emoji. */}
            <span
              data-testid="card-icon"
              aria-hidden="true"
              style={{
                minWidth: "72px",
                height: "48px",
                padding: "0 var(--space-4)",
                borderRadius: "var(--r-full)",
                backgroundColor: "var(--brand-soft)",
                color: "var(--brand-strong)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-display)",
                fontSize: "24px",
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              {card.monogram}
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
