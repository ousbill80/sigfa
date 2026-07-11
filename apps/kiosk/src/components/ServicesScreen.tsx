/**
 * KIOSK-003 — ServicesScreen.tsx
 * Écran de sélection de service.
 * Tokens CSS uniquement, max 4 cartes + "Voir plus".
 */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import { useAccessibilityMode } from "@/hooks/useAccessibilityMode";

export interface ServiceItem {
  id: string;
  name: string;
  icon: string;
  estimatedMinutes: number;
  isOpen: boolean;
  schedule?: string;
}

interface ServicesScreenProps {
  services: ServiceItem[];
  agencyId: string;
}

const MAX_VISIBLE = 4;

export function ServicesScreen({ services, agencyId }: ServicesScreenProps) {
  const t = useTranslations("services003");
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

  const handleServiceSelect = (service: ServiceItem) => {
    if (!service.isOpen) return;
    router.push(`/${currentLocale}/confirmation?serviceId=${service.id}&agencyId=${agencyId}`);
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
          padding: "2rem",
          gap: "1rem",
        }}
      >
        <span style={{ fontSize: "64px" }}>🤷</span>
        <h2
          style={{
            fontSize: "32px",
            fontWeight: "bold",
            color: "var(--ink-inverse)",
            textAlign: "center",
          }}
        >
          {t("emptyTitle")}
        </h2>
        <p
          style={{
            fontSize: "24px",
            color: "var(--ink-soft)",
            textAlign: "center",
          }}
        >
          {t("emptyMessage")}
        </p>
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
        padding: "2rem",
        gap: "1.5rem",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
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
            padding: "0.5rem",
            minWidth: "72px",
            minHeight: "72px",
          }}
        >
          ← {t("backButton")}
        </button>
        <span
          style={{
            fontSize: "28px",
            color: "var(--ink-soft)",
            marginLeft: "auto",
          }}
        >
          {currentLocale.toUpperCase()}
        </span>
      </header>

      {/* Title */}
      <h1
        style={{
          fontSize: "32px",
          fontWeight: "bold",
          color: "var(--ink-inverse)",
          textAlign: "center",
        }}
      >
        {t("title")}
      </h1>

      {/* Service cards */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          flex: 1,
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
              borderRadius: "0.75rem",
              border: "none",
              cursor: service.isOpen ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              padding: "1rem 1.5rem",
              gap: "1.25rem",
              opacity: service.isOpen ? 1 : 0.4,
              textAlign: "left",
            }}
          >
            <span
              data-testid="service-icon"
              style={{ fontSize: "40px", lineHeight: 1 }}
            >
              {service.icon}
            </span>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
                flex: 1,
              }}
            >
              <span
                data-testid="service-label"
                style={{
                  fontSize: "28px",
                  fontWeight: "bold",
                  color: "var(--action-label)",
                }}
              >
                {service.name}
              </span>
              {service.isOpen ? (
                <span
                  data-testid="service-estimate"
                  style={{ fontSize: "20px", color: "var(--ink-soft)" }}
                >
                  {t("waitEstimate", { minutes: service.estimatedMinutes })}
                </span>
              ) : (
                <span
                  data-testid="service-schedule"
                  style={{ fontSize: "20px", color: "var(--ink-soft)" }}
                >
                  {t("closedService", { schedule: service.schedule ?? "" })}
                </span>
              )}
            </div>
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
            color: "var(--action-label)",
            background: "none",
            border: "2px solid var(--action-label)",
            borderRadius: "0.5rem",
            cursor: "pointer",
            padding: "1rem",
            minHeight: "72px",
            textAlign: "center",
          }}
        >
          {t("seeMore")}
        </button>
      )}

      {/* Accessibility button */}
      <button
        data-testid="accessibility-btn"
        onClick={toggleAccessibilityMode}
        style={{
          fontSize: isAccessibilityMode ? "28px" : "24px",
          color: "var(--ink-soft)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0.5rem",
          minHeight: "72px",
          alignSelf: "center",
        }}
      >
        {t("accessibilityButton")}
      </button>
    </main>
  );
}
