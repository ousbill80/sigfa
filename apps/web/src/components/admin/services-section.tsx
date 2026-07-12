/**
 * ServicesSection — service list + per-service operations management (MODEL-WEB-A).
 *
 * Étend la section Services de la console admin WEB-006 : sous chaque service on
 * peut déplier la sous-gestion de ses OPÉRATIONS (liste / création / désactivation)
 * via {@link OperationsSection}. La création de service réutilise {@link ServiceForm}.
 * RBAC : ce composant n'est rendu que dans la section « services » de la console,
 * déjà gardée pour BANK_ADMIN / AGENCY_DIRECTOR (admin-rbac) — AGENT/AUDITOR ne
 * l'atteignent jamais.
 * @module components/admin/services-section
 */
"use client";

import { useState, type CSSProperties, type ReactElement } from "react";
import { Button } from "@sigfa/ui";
import { ServiceForm } from "./service-form";
import { OperationsSection, type OperationSubmit } from "./operations-section";
import type { OperationRow, ServiceRow } from "@/lib/use-admin-console";
import { t, type Locale } from "@/lib/i18n";

/** Props for {@link ServicesSection}. */
export interface ServicesSectionProps {
  /** The agency services to list. */
  services: ServiceRow[];
  /** Operations per service id (already fetched). */
  operationsByService: Record<string, OperationRow[]>;
  /** Create a service (ServiceForm submit). */
  onCreateService: (draft: { name: string; code: string; slaMinutes: number; order: number }) => void;
  /** Create an operation under a service. */
  onCreateOperation: (serviceId: string, draft: OperationSubmit) => void;
  /** Deactivate (soft-delete) an operation. */
  onDeactivateOperation: (operationId: string) => void;
  /** Called when the user expands a service (lets the caller lazy-load its operations). */
  onExpandService?: (serviceId: string) => void;
  /** Translated server error from the last service mutation. */
  serviceServerError?: string;
  /** Translated server error from the last operation mutation (e.g. 409 duplicate). */
  operationServerError?: string;
  /** Active locale. */
  locale?: Locale;
}

const overlineStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-faint)",
  margin: "0 0 var(--space-4)",
};
const serviceRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "var(--space-4)",
  padding: "var(--space-3) 0",
  borderBottom: "1px solid var(--hairline)",
};
const opWrapStyle: CSSProperties = {
  padding: "var(--space-4)",
  marginBottom: "var(--space-4)",
  backgroundColor: "var(--surface-1)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--r-md)",
};

/**
 * Services section with expandable per-service operations sub-management.
 * @param props - {@link ServicesSectionProps}.
 * @returns The section element.
 */
export function ServicesSection({
  services,
  operationsByService,
  onCreateService,
  onCreateOperation,
  onDeactivateOperation,
  onExpandService,
  serviceServerError,
  operationServerError,
  locale = "fr",
}: ServicesSectionProps): ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null);

  function toggle(serviceId: string): void {
    const next = expanded === serviceId ? null : serviceId;
    setExpanded(next);
    if (next && onExpandService) onExpandService(next);
  }

  return (
    <section data-testid="services-section" aria-label={t("admin.section.services", locale)}>
      <p style={overlineStyle}>{t("admin.section.services", locale)}</p>

      {services.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 var(--space-8)" }}>
          {services.map((service) => (
            <li key={service.id} data-testid={`service-row-${service.id}`}>
              <div style={serviceRowStyle}>
                <span style={{ color: "var(--ink)", fontWeight: 500 }}>
                  {service.code ? `${service.code} · ` : ""}
                  {service.name}
                  <span style={{ color: "var(--ink-faint)", marginLeft: "var(--space-2)", fontSize: "var(--text-xs)" }}>
                    {t("admin.operations.sla", locale)} {service.slaMinutes}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="dense"
                  data-testid={`manage-operations-${service.id}`}
                  aria-expanded={expanded === service.id}
                  onClick={() => toggle(service.id)}
                >
                  {t("admin.operations.manage", locale)}
                </Button>
              </div>

              {expanded === service.id && (
                <div style={opWrapStyle}>
                  <OperationsSection
                    serviceId={service.id}
                    serviceName={service.name}
                    serviceSlaMinutes={service.slaMinutes}
                    operations={operationsByService[service.id] ?? []}
                    onCreate={onCreateOperation}
                    onDeactivate={onDeactivateOperation}
                    serverError={operationServerError}
                    locale={locale}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ServiceForm onSubmit={onCreateService} serverError={serviceServerError} locale={locale} />
    </section>
  );
}
