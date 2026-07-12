/**
 * ThresholdsForm — bank alert thresholds with inline validation (WEB-006).
 *
 * Validates against the contract bounds (queueCriticalThreshold 1–500,
 * agentInactivityMinutes 1–60, noShowTimeoutMinutes 1–30) before submit, with
 * inline errors (no modal). Persists via PATCH /banks/{id}/thresholds. Tokens
 * only.
 * @module components/admin/thresholds-form
 */
"use client";

import { useState, type CSSProperties, type FormEvent, type ReactElement } from "react";
import { validateThresholds, isValid, type FieldErrors } from "@/lib/admin-validation";
import { t, type Locale } from "@/lib/i18n";

/** Props for {@link ThresholdsForm}. */
export interface ThresholdsFormProps {
  /** Persists the thresholds (PATCH /banks/{id}/thresholds). */
  onSubmit: (draft: { queueCriticalThreshold: number; agentInactivityMinutes: number; noShowTimeoutMinutes: number }) => void;
  /** Initial values. */
  initial?: { queueCriticalThreshold: number; agentInactivityMinutes: number; noShowTimeoutMinutes: number };
  /** Active locale. */
  locale?: Locale;
}

const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "0.25rem", marginBottom: "0.75rem" };
const labelStyle: CSSProperties = { fontSize: "var(--caption)", color: "var(--ink-soft)" };
const inputStyle: CSSProperties = { minHeight: "40px", padding: "0 0.75rem", border: "1px solid var(--ink-soft)", borderRadius: "0.375rem", backgroundColor: "var(--surface-0)", color: "var(--ink-strong)", fontSize: "1rem" };
const errorStyle: CSSProperties = { fontSize: "var(--caption)", color: "var(--danger)" };

/**
 * Bank thresholds form.
 * @param props - {@link ThresholdsFormProps}.
 * @returns The form element.
 */
export function ThresholdsForm({ onSubmit, initial, locale = "fr" }: ThresholdsFormProps): ReactElement {
  const [queueCriticalThreshold, setQueue] = useState(initial?.queueCriticalThreshold ?? 50);
  const [agentInactivityMinutes, setInactivity] = useState(initial?.agentInactivityMinutes ?? 15);
  const [noShowTimeoutMinutes, setNoShow] = useState(initial?.noShowTimeoutMinutes ?? 3);
  const [errors, setErrors] = useState<FieldErrors>({});

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    const draft = { queueCriticalThreshold, agentInactivityMinutes, noShowTimeoutMinutes };
    const found = validateThresholds(draft);
    setErrors(found);
    if (isValid(found)) onSubmit(draft);
  }

  return (
    <form data-testid="thresholds-form" onSubmit={handleSubmit} noValidate style={{ maxWidth: "24rem" }}>
      <div style={fieldStyle}>
        <label htmlFor="th-queue" style={labelStyle}>File critique (nb tickets)</label>
        <input id="th-queue" data-testid="th-queue" type="number" style={inputStyle} value={queueCriticalThreshold} onChange={(e) => setQueue(Number(e.target.value))} />
        {errors.queueCriticalThreshold && <span data-testid="error-queue" style={errorStyle}>{errors.queueCriticalThreshold}</span>}
      </div>
      <div style={fieldStyle}>
        <label htmlFor="th-inactivity" style={labelStyle}>Inactivité agent (min)</label>
        <input id="th-inactivity" data-testid="th-inactivity" type="number" style={inputStyle} value={agentInactivityMinutes} onChange={(e) => setInactivity(Number(e.target.value))} />
        {errors.agentInactivityMinutes && <span data-testid="error-inactivity" style={errorStyle}>{errors.agentInactivityMinutes}</span>}
      </div>
      <div style={fieldStyle}>
        <label htmlFor="th-noshow" style={labelStyle}>Délai no-show (min)</label>
        <input id="th-noshow" data-testid="th-noshow" type="number" style={inputStyle} value={noShowTimeoutMinutes} onChange={(e) => setNoShow(Number(e.target.value))} />
        {errors.noShowTimeoutMinutes && <span data-testid="error-noshow" style={errorStyle}>{errors.noShowTimeoutMinutes}</span>}
      </div>
      <button type="submit" data-testid="thresholds-submit" style={{ minHeight: "40px", padding: "0 1rem", border: "none", borderRadius: "0.375rem", backgroundColor: "var(--brand)", color: "var(--brand-contrast)", cursor: "pointer", fontSize: "1rem" }}>
        {t("admin.save", locale)}
      </button>
    </form>
  );
}
