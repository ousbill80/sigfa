/**
 * ThresholdsForm — bank alert thresholds with inline validation (WEB-006).
 *
 * Validates against the contract bounds (queueCriticalThreshold 1–500,
 * agentInactivityMinutes 1–60, noShowTimeoutMinutes 1–30) before submit, with
 * inline errors (no modal). Persists via PATCH /banks/{id}/thresholds.
 * v2 « Sérénité Premium » — @sigfa/ui + tokens only.
 * @module components/admin/thresholds-form
 */
"use client";

import { useState, type CSSProperties, type FormEvent, type ReactElement } from "react";
import { Button, Field } from "@sigfa/ui";
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
const rowStyle: CSSProperties = { marginBottom: "var(--space-4)" };

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
    <form data-testid="thresholds-form" onSubmit={handleSubmit} noValidate style={{ maxWidth: "26rem" }}>
      <p style={overlineStyle}>{t("admin.section.thresholds", locale)}</p>

      <div style={rowStyle}>
        <Field
          id="th-queue"
          data-testid="th-queue"
          label="File critique (nb tickets)"
          type="number"
          aria-invalid={errors.queueCriticalThreshold ? true : undefined}
          value={queueCriticalThreshold}
          onChange={(e) => setQueue(Number(e.target.value))}
        />
        {errors.queueCriticalThreshold && <p data-testid="error-queue" role="alert" style={errorStyle}>{errors.queueCriticalThreshold}</p>}
      </div>
      <div style={rowStyle}>
        <Field
          id="th-inactivity"
          data-testid="th-inactivity"
          label="Inactivité agent (min)"
          type="number"
          aria-invalid={errors.agentInactivityMinutes ? true : undefined}
          value={agentInactivityMinutes}
          onChange={(e) => setInactivity(Number(e.target.value))}
        />
        {errors.agentInactivityMinutes && <p data-testid="error-inactivity" role="alert" style={errorStyle}>{errors.agentInactivityMinutes}</p>}
      </div>
      <div style={rowStyle}>
        <Field
          id="th-noshow"
          data-testid="th-noshow"
          label="Délai no-show (min)"
          type="number"
          aria-invalid={errors.noShowTimeoutMinutes ? true : undefined}
          value={noShowTimeoutMinutes}
          onChange={(e) => setNoShow(Number(e.target.value))}
        />
        {errors.noShowTimeoutMinutes && <p data-testid="error-noshow" role="alert" style={errorStyle}>{errors.noShowTimeoutMinutes}</p>}
      </div>
      <Button type="submit" variant="primary" data-testid="thresholds-submit">
        {t("admin.save", locale)}
      </Button>
    </form>
  );
}
