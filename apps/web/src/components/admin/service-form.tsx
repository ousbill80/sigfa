/**
 * ServiceForm — service create/edit with inline Zod-style validation (WEB-006).
 *
 * Validation runs client-side before submit (admin-validation) and renders each
 * error INLINE next to its field — never a modal. A server-side error (e.g. the
 * translated 409 "code déjà existant") is shown as a persistent inline banner
 * and the form values are preserved (error state).
 * @module components/admin/service-form
 */
"use client";

import { useState, type CSSProperties, type FormEvent, type ReactElement } from "react";
import { validateService, isValid, type FieldErrors } from "@/lib/admin-validation";
import { t, type Locale } from "@/lib/i18n";

/** Props for {@link ServiceForm}. */
export interface ServiceFormProps {
  /** Called with the validated draft on submit. */
  onSubmit: (draft: { name: string; code: string; slaMinutes: number; order: number }) => void;
  /** Translated server error (e.g. 409) shown inline; values are preserved. */
  serverError?: string;
  /** Active locale. */
  locale?: Locale;
}

const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "0.25rem", marginBottom: "0.75rem" };
const labelStyle: CSSProperties = { fontSize: "var(--caption)", color: "var(--ink-soft)" };
const inputStyle: CSSProperties = {
  minHeight: "40px",
  padding: "0 0.75rem",
  border: "1px solid var(--ink-soft)",
  borderRadius: "0.375rem",
  backgroundColor: "var(--surface-0)",
  color: "var(--ink-strong)",
  fontSize: "1rem",
};
const errorStyle: CSSProperties = { fontSize: "var(--caption)", color: "var(--danger)" };
const submitStyle: CSSProperties = {
  minHeight: "40px",
  padding: "0 1rem",
  border: "none",
  borderRadius: "0.375rem",
  backgroundColor: "var(--brand)",
  color: "var(--brand-contrast)",
  cursor: "pointer",
  fontSize: "1rem",
};

/**
 * Service create/edit form.
 * @param props - {@link ServiceFormProps}.
 * @returns The form element.
 */
export function ServiceForm({ onSubmit, serverError, locale = "fr" }: ServiceFormProps): ReactElement {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [slaMinutes, setSlaMinutes] = useState(10);
  const [order, setOrder] = useState(1);
  const [errors, setErrors] = useState<FieldErrors>({});

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    const draft = { name, code, slaMinutes, order };
    const found = validateService(draft);
    setErrors(found);
    if (isValid(found)) onSubmit(draft);
  }

  return (
    <form data-testid="service-form" onSubmit={handleSubmit} noValidate style={{ maxWidth: "24rem" }}>
      {serverError && (
        <div data-testid="service-server-error" role="alert" style={{ ...errorStyle, marginBottom: "0.75rem" }}>
          {serverError}
        </div>
      )}
      <div style={fieldStyle}>
        <label htmlFor="service-name" style={labelStyle}>Nom</label>
        <input id="service-name" data-testid="service-name" style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
        {errors.name && <span data-testid="error-name" style={errorStyle}>{errors.name}</span>}
      </div>
      <div style={fieldStyle}>
        <label htmlFor="service-code" style={labelStyle}>Code</label>
        <input id="service-code" data-testid="service-code" style={inputStyle} value={code} onChange={(e) => setCode(e.target.value)} />
        {errors.code && <span data-testid="error-code" style={errorStyle}>{errors.code}</span>}
      </div>
      <div style={fieldStyle}>
        <label htmlFor="service-sla" style={labelStyle}>SLA (min)</label>
        <input id="service-sla" data-testid="service-sla" type="number" style={inputStyle} value={slaMinutes} onChange={(e) => setSlaMinutes(Number(e.target.value))} />
        {errors.slaMinutes && <span data-testid="error-slaMinutes" style={errorStyle}>{errors.slaMinutes}</span>}
      </div>
      <div style={fieldStyle}>
        <label htmlFor="service-order" style={labelStyle}>Priorité</label>
        <input id="service-order" data-testid="service-order" type="number" style={inputStyle} value={order} onChange={(e) => setOrder(Number(e.target.value))} />
        {errors.order && <span data-testid="error-order" style={errorStyle}>{errors.order}</span>}
      </div>
      <button type="submit" data-testid="service-submit" style={submitStyle}>{t("admin.save", locale)}</button>
    </form>
  );
}
