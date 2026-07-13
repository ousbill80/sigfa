/**
 * NOTIF-005-B — step 1: choose a service (aligned on the kiosk grille).
 *
 * Thumb-first cards on `--paper`, wait-time pill, closed state greyed out.
 * Tokens from `@sigfa/ui` only. Empty state when the catalog is empty.
 *
 * @module components/pwa/PwaServiceStep
 */
"use client";

import type { ReactElement } from "react";
import { Badge, Card, EmptyState } from "@sigfa/ui";
import { pt, type PwaLocale } from "@/lib/pwa/pwa-i18n";
import { serviceName, type PwaService } from "@/lib/pwa/pwa-services";

/** Props for {@link PwaServiceStep}. */
export interface PwaServiceStepProps {
  readonly services: readonly PwaService[];
  readonly locale: PwaLocale;
  readonly onSelect: (serviceId: string) => void;
}

/**
 * Renders the service selection step.
 *
 * @param props - Catalog, locale, selection handler.
 * @returns The step element.
 */
export function PwaServiceStep({ services, locale, onSelect }: PwaServiceStepProps): ReactElement {
  if (services.length === 0) {
    return (
      <div data-testid="pwa-service-empty">
        <EmptyState title={pt("pwa.service.empty", locale)} />
      </div>
    );
  }

  return (
    <section data-testid="pwa-service-step" aria-label={pt("pwa.service.title", locale)}>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-2xl)",
          lineHeight: "1.15",
          letterSpacing: "var(--tracking-tight)",
          color: "var(--ink)",
          margin: "0 0 var(--space-2)",
        }}
      >
        {pt("pwa.service.title", locale)}
      </h1>
      <p style={{ color: "var(--ink-soft)", margin: "0 0 var(--space-6)" }}>
        {pt("pwa.service.subtitle", locale)}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {services.map((service) => {
          const open = service.isOpen;
          return (
            <Card
              key={service.id}
              data-testid="pwa-service-card"
              interactive={open}
              aria-disabled={open ? undefined : true}
              onActivate={open ? () => onSelect(service.id) : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-4)",
                padding: "var(--space-4) var(--space-5)",
                opacity: open ? 1 : 0.55,
                cursor: open ? "pointer" : "not-allowed",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flexShrink: 0,
                  width: "3rem",
                  height: "3rem",
                  borderRadius: "var(--r-full)",
                  backgroundColor: "var(--brand-soft)",
                  color: "var(--brand-strong)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: "var(--text-md)",
                }}
              >
                {service.code}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span
                  data-testid="pwa-service-name"
                  style={{
                    display: "block",
                    fontWeight: 600,
                    fontSize: "var(--text-lg)",
                    color: "var(--ink)",
                  }}
                >
                  {serviceName(service, locale)}
                </span>
                {open ? (
                  <Badge tone="brand" data-testid="pwa-service-wait">
                    {pt("pwa.service.wait", locale, { minutes: service.estimatedMinutes })}
                  </Badge>
                ) : (
                  <Badge tone="info" data-testid="pwa-service-closed">
                    {pt("pwa.service.closed", locale)}
                  </Badge>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
