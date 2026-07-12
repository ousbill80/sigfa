/**
 * OperationsSection — CRUD des opérations sous un service (MODEL-WEB-A).
 *
 * Étend la section Services de la console admin : pour un service donné, on liste
 * ses opérations et on peut en créer / éditer / désactiver via les routes
 * canoniques du contrat (`GET/POST /services/{serviceId}/operations`,
 * `PATCH/DELETE /operations/{id}`). Validation INLINE (jamais de modale) :
 *  - `code` regex `^[A-Z0-9]{2,6}$`, unique par service (409 OPERATION_CODE_DUPLICATE
 *    → message humain « Ce code d'opération existe déjà pour ce service »),
 *  - `slaMinutes` NULLABLE : vide ⇒ hérite du SLA du service (D4) — l'UI affiche la
 *    valeur résolue,
 *  - PAS de champ « priorité » (D4).
 * @module components/admin/operations-section
 */
"use client";

import { useState, type CSSProperties, type FormEvent, type ReactElement } from "react";
import { Badge, Button, Field } from "@sigfa/ui";
import {
  validateOperation,
  isValid,
  type OperationDraft,
  type FieldErrors,
} from "@/lib/admin-validation";
import type { OperationRow } from "@/lib/use-admin-console";
import { t, type Locale } from "@/lib/i18n";

/** Payload sent to the parent on submit (create or edit). */
export interface OperationSubmit {
  code: string;
  name: string;
  slaMinutes: number | null;
  displayOrder: number;
  iconKey?: string;
}

/** Props for {@link OperationsSection}. */
export interface OperationsSectionProps {
  /** The parent service id (path param of the create route). */
  serviceId: string;
  /** Human label of the parent service (heading context). */
  serviceName?: string;
  /** The resolved SLA of the parent service (minutes) — shown when an op inherits. */
  serviceSlaMinutes: number;
  /** The service's operations to list. */
  operations: OperationRow[];
  /** Called with the validated operation draft on create. */
  onCreate: (serviceId: string, draft: OperationSubmit) => void;
  /** Called to deactivate (soft-delete) an operation. */
  onDeactivate: (operationId: string) => void;
  /** Translated server error (e.g. 409 duplicate code) shown inline; values preserved. */
  serverError?: string;
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
const errorStyle: CSSProperties = { fontSize: "var(--text-sm)", color: "var(--danger)", marginTop: "var(--space-1)" };
const serverErrorStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--danger)",
  backgroundColor: "var(--danger-soft)",
  border: "1px solid var(--danger)",
  borderRadius: "var(--r-md)",
  padding: "var(--space-3) var(--space-4)",
  marginBottom: "var(--space-4)",
};
const rowStyle: CSSProperties = { marginBottom: "var(--space-4)" };
const listRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "var(--space-4)",
  padding: "var(--space-3) 0",
  borderBottom: "1px solid var(--hairline)",
};
const slaHintStyle: CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--ink-faint)",
  marginTop: "var(--space-1)",
};

/**
 * Resolves the SLA of an operation: own value or, when null, the parent service.
 * @param opSla - The operation's own slaMinutes (nullable).
 * @param serviceSla - The parent service SLA.
 * @returns The resolved SLA in minutes.
 */
export function resolveOperationSla(opSla: number | null | undefined, serviceSla: number): number {
  return opSla ?? serviceSla;
}

/**
 * Operations sub-management for a single service.
 * @param props - {@link OperationsSectionProps}.
 * @returns The section element.
 */
export function OperationsSection({
  serviceId,
  serviceName,
  serviceSlaMinutes,
  operations,
  onCreate,
  onDeactivate,
  serverError,
  locale = "fr",
}: OperationsSectionProps): ReactElement {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  // Empty string ⇒ inherits the service SLA (nullable in the contract).
  const [sla, setSla] = useState("");
  const [displayOrder, setDisplayOrder] = useState(1);
  const [iconKey, setIconKey] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const slaMinutes: number | null = sla.trim() === "" ? null : Number(sla);
  const slaInherited = slaMinutes === null;

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    const draft: OperationDraft = { code, name, slaMinutes, displayOrder };
    const found = validateOperation(draft);
    setErrors(found);
    if (isValid(found)) {
      onCreate(serviceId, {
        code,
        name,
        slaMinutes,
        displayOrder,
        ...(iconKey.trim() !== "" ? { iconKey: iconKey.trim() } : {}),
      });
    }
  }

  return (
    <section
      data-testid={`operations-section-${serviceId}`}
      aria-label={`${t("admin.operations.title", locale)}${serviceName ? ` — ${serviceName}` : ""}`}
    >
      <p style={overlineStyle}>
        {t("admin.operations.title", locale)}
        {serviceName ? ` — ${serviceName}` : ""}
      </p>

      {operations.length === 0 ? (
        <p data-testid="operations-empty" style={{ color: "var(--ink-faint)", margin: "0 0 var(--space-6)" }}>
          {t("admin.operations.empty", locale)}
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 var(--space-6)" }}>
          {operations.map((op) => {
            const resolved = resolveOperationSla(op.slaMinutes, serviceSlaMinutes);
            const inherited = op.slaMinutes === null || op.slaMinutes === undefined;
            return (
              <li key={op.id} data-testid={`operation-row-${op.id}`} style={listRowStyle}>
                <span style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", color: "var(--ink)", fontWeight: 500 }}>
                    <Badge tone="brand">{op.code}</Badge>
                    {op.name}
                    <Badge tone={op.isActive ? "success" : "info"} dot>
                      {op.isActive ? t("admin.operations.active", locale) : t("admin.operations.inactive", locale)}
                    </Badge>
                  </span>
                  <span
                    data-testid={`operation-sla-${op.id}`}
                    style={{ fontSize: "var(--text-xs)", color: "var(--ink-faint)" }}
                  >
                    {t("admin.operations.sla", locale)} : {resolved}
                    {inherited ? ` (${t("admin.operations.sla_inherited", locale)})` : ""}
                  </span>
                </span>
                {op.isActive && (
                  <Button
                    type="button"
                    variant="danger"
                    size="dense"
                    data-testid={`operation-deactivate-${op.id}`}
                    onClick={() => onDeactivate(op.id)}
                  >
                    {t("admin.operations.deactivate", locale)}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form data-testid="operation-form" onSubmit={handleSubmit} noValidate style={{ maxWidth: "26rem" }}>
        <p style={overlineStyle}>{t("admin.operations.add", locale)}</p>

        {serverError && (
          <div data-testid="operation-server-error" role="alert" style={serverErrorStyle}>
            {serverError}
          </div>
        )}

        <div style={rowStyle}>
          <Field
            id="operation-code"
            data-testid="operation-code"
            label={t("admin.operations.code", locale)}
            aria-required="true"
            aria-invalid={errors.code ? true : undefined}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {errors.code && <p data-testid="error-op-code" role="alert" style={errorStyle}>{errors.code}</p>}
        </div>

        <div style={rowStyle}>
          <Field
            id="operation-name"
            data-testid="operation-name"
            label={t("admin.operations.name", locale)}
            aria-required="true"
            aria-invalid={errors.name ? true : undefined}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {errors.name && <p data-testid="error-op-name" role="alert" style={errorStyle}>{errors.name}</p>}
        </div>

        <div style={rowStyle}>
          <Field
            id="operation-sla"
            data-testid="operation-sla"
            label={t("admin.operations.sla", locale)}
            type="number"
            placeholder={t("admin.operations.sla_placeholder", locale)}
            aria-invalid={errors.slaMinutes ? true : undefined}
            value={sla}
            onChange={(e) => setSla(e.target.value)}
          />
          {slaInherited && (
            <p data-testid="operation-sla-inherit-hint" style={slaHintStyle}>
              {t("admin.operations.sla_inherited", locale)} ({serviceSlaMinutes})
            </p>
          )}
          {errors.slaMinutes && <p data-testid="error-op-sla" role="alert" style={errorStyle}>{errors.slaMinutes}</p>}
        </div>

        <div style={rowStyle}>
          <Field
            id="operation-order"
            data-testid="operation-order"
            label={t("admin.operations.display_order", locale)}
            type="number"
            aria-invalid={errors.displayOrder ? true : undefined}
            value={displayOrder}
            onChange={(e) => setDisplayOrder(Number(e.target.value))}
          />
          {errors.displayOrder && <p data-testid="error-op-order" role="alert" style={errorStyle}>{errors.displayOrder}</p>}
        </div>

        <div style={rowStyle}>
          <Field
            id="operation-icon"
            data-testid="operation-icon"
            label={t("admin.operations.icon_key", locale)}
            value={iconKey}
            onChange={(e) => setIconKey(e.target.value)}
          />
        </div>

        <Button type="submit" variant="primary" data-testid="operation-submit">
          {t("admin.save", locale)}
        </Button>
      </form>
    </section>
  );
}
