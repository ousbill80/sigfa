/**
 * KIOSK-003 — ServicesScreen.tsx
 * Écran de sélection de service — refonte v2 « Sérénité Premium ».
 *
 * Disposition : grille de tuiles 2 colonnes (1 colonne si peu d'espace),
 * largeur de contenu max contenue et centrée. Icônes SVG cohérentes
 * (`ServiceIcon`) posées dans un cercle `--brand-soft` — fin des emoji.
 * Temps d'attente en pill discret, chevron d'action. Tokens @sigfa/ui
 * uniquement, aucune valeur hex en dur.
 */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { EmptyState } from "@sigfa/ui";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import { useAccessibilityMode } from "@/hooks/useAccessibilityMode";
import { DEFAULT_LONG_QUEUE_THRESHOLD_MIN } from "@/hooks/useDegradedState";
import { ServiceIcon } from "@/components/icons/ServiceIcon";
import { AccessibilityIcon, ChevronIcon, PhoneIcon } from "@/components/icons/UiIcons";

export interface ServiceItem {
  id: string;
  name: string;
  /** Code optionnel — sert au mapping d'icône par mot-clé (sinon `name`). */
  code?: string;
  /** @deprecated emoji retiré en v2 ; conservé pour compat de données. */
  icon?: string;
  estimatedMinutes: number;
  isOpen: boolean;
  schedule?: string;
}

interface ServicesScreenProps {
  services: ServiceItem[];
  agencyId: string;
  /** KIOSK-007 : seuil « file longue » en minutes (configurable). */
  longQueueThresholdMinutes?: number;
}

const MAX_VISIBLE = 4;

export function ServicesScreen({
  services,
  agencyId,
  longQueueThresholdMinutes = DEFAULT_LONG_QUEUE_THRESHOLD_MIN,
}: ServicesScreenProps) {
  const t = useTranslations("services003");
  const tDeg = useTranslations("degraded007");
  const router = useRouter();
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";
  const { isAccessibilityMode, toggleAccessibilityMode } = useAccessibilityMode();

  const [showAll, setShowAll] = useState(false);

  const timeoutMs = isAccessibilityMode ? 60000 : 30000;

  useInactivityTimeout(() => {
    router.push(`/${currentLocale}`);
  }, timeoutMs);

  const visibleServices = showAll ? services : services.slice(0, MAX_VISIBLE);
  const hasMore = services.length > MAX_VISIBLE;

  // KIOSK-007 : file longue si l'attente d'un service ouvert dépasse le seuil.
  // On affiche proactivement un message d'affluence + met en avant le SMS.
  const longestOpenWait = services
    .filter((s) => s.isOpen)
    .reduce((max, s) => Math.max(max, s.estimatedMinutes), 0);
  const isLongQueue = longestOpenWait >= longQueueThresholdMinutes;

  // MODEL-KIOSK-A : parcours 2 niveaux — un service mène à l'écran OPÉRATIONS
  // (grille v2), qui décidera d'un éventuel saut vers la confirmation si le
  // service n'a qu'une seule opération. La borne ne saute plus directement à
  // la confirmation depuis le service.
  const handleServiceSelect = (service: ServiceItem) => {
    if (!service.isOpen) return;
    router.push(`/${currentLocale}/operations?serviceId=${service.id}&agencyId=${agencyId}`);
  };

  if (services.length === 0) {
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
          color: "var(--ink-inverse)",
        }}
      >
        <EmptyState
          icon={<ServiceIcon name="generic" size={48} style={{ color: "var(--ink-inverse)" }} />}
          title={t("emptyTitle")}
          description={t("emptyMessage")}
          style={{ color: "var(--ink-inverse)" }}
        />
      </main>
    );
  }

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
          data-testid="back-btn"
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
          ← {t("backButton")}
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

      {/* Zone de contenu centrée — largeur max contenue (pas d'étirement). */}
      <div
        style={{
          width: "100%",
          maxWidth: "960px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-6)",
          flex: 1,
        }}
      >
        {/* KIOSK-007 — Bannière file longue : message d'affluence + champ
            téléphone mis en avant (SMS non optionnel visuellement ici). */}
        {isLongQueue && (
          <section
            data-testid="long-queue-banner"
            aria-live="polite"
            style={{
              backgroundColor: "var(--surface-1)",
              borderRadius: "var(--r-lg)",
              boxShadow: "var(--shadow-2)",
              padding: "var(--space-4) var(--space-6)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
            }}
          >
            <span style={{ fontSize: "28px", fontWeight: 600, color: "var(--ink-strong)" }}>
              {tDeg("longQueueTitle", { estimate: longestOpenWait })}
            </span>
            <span style={{ fontSize: "24px", color: "var(--ink-soft)" }}>
              {tDeg("longQueueMessage")}
            </span>
            {/* Champ téléphone mis en avant — CTA menant à la saisie du numéro. */}
            <button
              data-testid="long-queue-phone-cta"
              onClick={() =>
                router.push(`/${currentLocale}/confirmation?agencyId=${agencyId}`)
              }
              style={{
                minHeight: "72px",
                fontSize: "28px",
                fontWeight: 600,
                color: "var(--brand-contrast)",
                backgroundColor: "var(--brand)",
                boxShadow: "var(--shadow-brand)",
                border: "none",
                borderRadius: "var(--r-md)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "var(--space-3)",
              }}
            >
              <PhoneIcon size={28} />
              {tDeg("phoneFieldLabel")}
            </button>
          </section>
        )}

        {/* Service cards — grille 2 colonnes (1 si peu d'espace). */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: "var(--space-6)",
          }}
        >
          {visibleServices.map((service) => (
            <button
              key={service.id}
              data-testid="service-card"
              onClick={() => handleServiceSelect(service)}
              aria-disabled={!service.isOpen ? "true" : undefined}
              style={{
                minHeight: "96px",
                backgroundColor: "var(--surface-1)",
                borderRadius: "var(--r-lg)",
                border: "1px solid var(--hairline)",
                boxShadow: service.isOpen ? "var(--shadow-2)" : "var(--shadow-1)",
                cursor: service.isOpen ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                padding: "var(--space-4) var(--space-6)",
                gap: "var(--space-6)",
                opacity: service.isOpen ? 1 : 0.4,
                textAlign: "left",
              }}
            >
              {/* Cercle icône --brand-soft, icône SVG en --brand. */}
              <span
                data-testid="service-icon"
                style={{
                  flexShrink: 0,
                  width: "72px",
                  height: "72px",
                  borderRadius: "var(--r-full)",
                  backgroundColor: "var(--brand-soft)",
                  color: "var(--brand)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ServiceIcon keyword={service.code ?? service.name} size={40} />
              </span>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: "var(--space-2)",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <span
                  data-testid="service-label"
                  style={{
                    fontSize: "28px",
                    fontWeight: 600,
                    color: "var(--action-label)",
                  }}
                >
                  {service.name}
                </span>
                {service.isOpen ? (
                  <span
                    data-testid="service-estimate"
                    style={{
                      fontSize: "20px",
                      fontWeight: 600,
                      color: "var(--brand-strong)",
                      backgroundColor: "var(--brand-soft)",
                      borderRadius: "var(--r-full)",
                      padding: "var(--space-1) var(--space-3)",
                    }}
                  >
                    {t("waitEstimate", { minutes: service.estimatedMinutes })}
                  </span>
                ) : (
                  <span
                    data-testid="service-schedule"
                    style={{
                      fontSize: "20px",
                      color: "var(--ink-soft)",
                      backgroundColor: "var(--surface-2)",
                      borderRadius: "var(--r-full)",
                      padding: "var(--space-1) var(--space-3)",
                    }}
                  >
                    {t("closedService", { schedule: service.schedule ?? "" })}
                  </span>
                )}
              </div>
              {service.isOpen && (
                <ChevronIcon
                  size={28}
                  style={{ flexShrink: 0, color: "var(--ink-soft)" }}
                />
              )}
            </button>
          ))}
        </div>

        {/* See more button */}
        {hasMore && !showAll && (
          <button
            data-testid="see-more-btn"
            onClick={() => setShowAll(true)}
            style={{
              fontSize: "24px",
              color: "var(--ink-inverse)",
              background: "none",
              border: "2px solid var(--ink-inverse)",
              borderRadius: "var(--r-md)",
              cursor: "pointer",
              padding: "var(--space-4)",
              minHeight: "72px",
              textAlign: "center",
            }}
          >
            {t("seeMore")}
          </button>
        )}
      </div>

      {/* Accessibility button */}
      <button
        data-testid="accessibility-btn"
        onClick={toggleAccessibilityMode}
        style={{
          fontSize: isAccessibilityMode ? "28px" : "24px",
          color: "var(--ink-muted-inv)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "var(--space-2)",
          minHeight: "72px",
          alignSelf: "center",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
        }}
      >
        <AccessibilityIcon size={isAccessibilityMode ? 32 : 28} />
        {t("accessibilityButton")}
      </button>
    </main>
  );
}
