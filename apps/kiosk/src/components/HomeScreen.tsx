/**
 * KIOSK-002 — HomeScreen.tsx
 * Écran d'accueil / sélection de langue — refonte v2 « Sérénité Premium ».
 * Fond --night qui vibre l'or, respiration généreuse, cartes chaudes.
 * FR/EN uniquement (décision PO). Tokens @sigfa/ui, aucune valeur hex en dur.
 *
 * KIOSK-HOME (retour visuel PO, 2026-07-13) — écran de MARQUE du tenant :
 *  - logo banque central en haut (contrat CONTRACT-013, repli monogramme
 *    --brand, jamais d'image cassée), nom de banque toujours présent ;
 *  - sélecteur de langue SANS drapeaux emoji : pastilles typographiques
 *    « FR » / « EN » en chip duotone teinté --brand ;
 *  - hiérarchie : marque banque, « Akwaba — Bienvenue », choix de langue,
 *    statut file discret en bas. Une décision par écran.
 *  - theming banque sans effort : la couleur primaire appliquée du tenant
 *    alimente BankThemeProvider (--brand + contraste WCAG auto).
 */
"use client";

import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { BankThemeProvider } from "@sigfa/ui";
import { useQueueStatus } from "@/hooks/useQueueStatus";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import { useAccessibilityMode } from "@/hooks/useAccessibilityMode";
import { useBankTheme } from "@/hooks/useBankTheme";
import { kioskBankName } from "@/lib/bank-brand";
import { BankBrandMark } from "@/components/BankBrandMark";

interface HomeScreenProps {
  /** Override for offline state (useful for testing) */
  isOffline?: boolean;
  /** Nom public de la banque (repli env de provisionnement). */
  bankName?: string;
}

interface LanguageCard {
  locale: string;
  labelKey: "languageFr" | "languageEn";
  /** Pastille typographique du chip (JAMAIS de drapeau emoji). */
  tag: string;
}

const LANGUAGE_CARDS: LanguageCard[] = [
  { locale: "fr", labelKey: "languageFr", tag: "FR" },
  { locale: "en", labelKey: "languageEn", tag: "EN" },
];

export function HomeScreen({
  isOffline: isOfflineProp,
  bankName = kioskBankName(),
}: HomeScreenProps = {}) {
  const t = useTranslations("home002");
  const router = useRouter();
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";
  const { count, estimatedMinutes, isOffline: isOfflineHook } = useQueueStatus();
  const { isAccessibilityMode } = useAccessibilityMode();
  const { logoUrl, brandColor } = useBankTheme();

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
    // MODEL-KIOSK-B : après la langue, la borne offre DEUX chemins clairs
    // (« Une opération » / « Voir mon conseiller ») via l'écran de choix.
    router.push(`/${locale}/choice`);
  };

  return (
    // Theming tenant sans effort : brandColor absent = identité SIGFA par
    // défaut, pixel pour pixel (le provider n'injecte rien).
    <BankThemeProvider brandColor={brandColor ?? undefined}>
      <main
        role="main"
        style={{
          backgroundColor: "var(--surface-kiosk)",
          boxSizing: "border-box",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-16) var(--space-8) var(--space-24)",
          gap: "var(--space-12)",
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
              fontSize: "24px",
            }}
          >
            {t("offlineBanner")}
          </div>
        )}

        {/* Marque du tenant — logo central (repli monogramme), nom de banque. */}
        <BankBrandMark bankName={bankName} logoUrl={logoUrl} />

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

        {/* Language cards grid (FR/EN) — cibles généreuses ≥ 120px,
            pastilles typographiques duotone (aucun drapeau emoji). */}
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
              lang={card.locale}
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
                gap: "var(--space-4)",
                padding: "var(--space-8)",
              }}
            >
              <span
                data-testid="card-icon"
                aria-hidden="true"
                style={{
                  width: "72px",
                  height: "72px",
                  borderRadius: "var(--r-full)",
                  backgroundColor: "var(--brand-soft)",
                  color: "var(--brand-strong)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--font-display)",
                  fontSize: "26px",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  lineHeight: 1,
                }}
              >
                {card.tag}
              </span>
              <span
                data-testid="card-label"
                style={{
                  fontSize: "28px",
                  fontWeight: 600,
                  // --brand-strong DIRECT (= --action-label hors theming) : les
                  // alias :root ne se re-resolvent pas sous BankThemeProvider,
                  // le label doit suivre la couleur du tenant comme le chip.
                  color: "var(--brand-strong)",
                }}
              >
                {t(card.labelKey)}
              </span>
            </button>
          ))}
        </div>

        {/* Queue status — statut discret, ancré en bas de l'écran. */}
        <div
          data-testid="queue-status"
          style={{
            position: "absolute",
            bottom: "var(--space-8)",
            left: "var(--space-8)",
            right: "var(--space-8)",
            fontSize: "24px",
            color: "var(--ink-muted-inv)",
            textAlign: "center",
          }}
        >
          {count !== null && estimatedMinutes !== null
            ? t("queueStatus", { count, minutes: estimatedMinutes })
            : t("queueUnavailable")}
        </div>
      </main>
    </BankThemeProvider>
  );
}
