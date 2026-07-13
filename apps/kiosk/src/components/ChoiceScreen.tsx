/**
 * MODEL-KIOSK-B — ChoiceScreen.tsx
 * Point d'entrée « Que souhaitez-vous ? » — DEUX grandes cartes, une décision
 * par écran, cohérent avec le design v2 « Sérénité Premium » :
 *   - « Une opération »        → /{locale}/services  (parcours Phase A, existant)
 *   - « Voir mon conseiller »  → /{locale}/managers  (liste des conseillers)
 *
 * Réutilise le patron des écrans v2 (grille de cartes, icône SVG dans un cercle
 * --brand-soft, chevron d'action, tokens uniquement, zéro emoji, cibles ≥ 72 px).
 */
"use client";

import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { IconRetour } from "@sigfa/ui";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import { ChevronIcon, OperationIcon, PersonIcon } from "@/components/icons/UiIcons";

export function ChoiceScreen() {
  const t = useTranslations("choiceModelB");
  const router = useRouter();
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";

  useInactivityTimeout(() => {
    router.push(`/${currentLocale}`);
  }, 30000);

  const cards = [
    {
      testId: "choice-operation",
      labelKey: "operationCard" as const,
      hintKey: "operationHint" as const,
      icon: <OperationIcon size={40} />,
      onClick: () => router.push(`/${currentLocale}/services`),
    },
    {
      testId: "choice-manager",
      labelKey: "managerCard" as const,
      hintKey: "managerHint" as const,
      icon: <PersonIcon size={40} />,
      onClick: () => router.push(`/${currentLocale}/managers`),
    },
  ];

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
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
        }}
      >
        <button
          data-testid="choice-back-btn"
          onClick={() => router.back()}
          style={{
            fontSize: "20px",
            color: "var(--ink-inverse)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "var(--space-2)",
            minWidth: "72px",
            minHeight: "72px",
          }}
        >
          <IconRetour
            size={24}
            style={{ verticalAlign: "middle", marginRight: "var(--space-2)" }}
          />
          {t("backButton")}
        </button>
        <span
          style={{
            fontSize: "28px",
            color: "var(--ink-muted-inv)",
            marginLeft: "auto",
          }}
        >
          {currentLocale.toUpperCase()}
        </span>
      </header>

      {/* Title */}
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-2xl)",
          fontWeight: 700,
          letterSpacing: "var(--tracking-tight)",
          color: "var(--ink-inverse)",
          textAlign: "center",
          margin: 0,
        }}
      >
        {t("title")}
      </h1>

      {/* Deux grandes cartes — grille responsive centrée. */}
      <div
        style={{
          width: "100%",
          maxWidth: "960px",
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: "var(--space-6)",
          flex: 1,
          alignContent: "center",
        }}
      >
        {cards.map((card) => (
          <button
            key={card.testId}
            data-testid={card.testId}
            data-choice-card=""
            onClick={card.onClick}
            style={{
              minHeight: "160px",
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
              textAlign: "center",
            }}
          >
            <span
              data-testid="choice-icon"
              style={{
                flexShrink: 0,
                width: "88px",
                height: "88px",
                borderRadius: "var(--r-full)",
                backgroundColor: "var(--brand-soft)",
                color: "var(--brand)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {card.icon}
            </span>
            <span
              style={{
                fontSize: "28px",
                fontWeight: 600,
                color: "var(--action-label)",
              }}
            >
              {t(card.labelKey)}
            </span>
            <span
              style={{
                fontSize: "20px",
                color: "var(--ink-soft)",
              }}
            >
              {t(card.hintKey)}
            </span>
            <ChevronIcon size={28} style={{ color: "var(--ink-soft)" }} />
          </button>
        ))}
      </div>
    </main>
  );
}
