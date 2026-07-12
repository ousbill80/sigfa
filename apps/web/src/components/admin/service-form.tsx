/**
 * ServiceForm — service create/edit with inline Zod-style validation (WEB-006).
 *
 * Validation runs client-side before submit (admin-validation) and renders each
 * error INLINE next to its field — never a modal. A server-side error (e.g. the
 * translated 409 "code déjà existant") is shown as a persistent inline banner
 * and the form values are preserved (error state). v2 — @sigfa/ui + tokens only.
 * @module components/admin/service-form
 */
"use client";

import { useState, type CSSProperties, type FormEvent, type ReactElement } from "react";
import { Button, Field } from "@sigfa/ui";
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
    <form data-testid="service-form" onSubmit={handleSubmit} noValidate style={{ maxWidth: "26rem" }}>
      <p style={overlineStyle}>{t("admin.section.services", locale)}</p>

      {serverError && (
        <div data-testid="service-server-error" role="alert" style={serverErrorStyle}>
          {serverError}
        </div>
      )}
      <div style={rowStyle}>
        <Field
          id="service-name"
          data-testid="service-name"
          label="Nom"
          aria-required="true"
          aria-invalid={errors.name ? true : undefined}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {errors.name && <p data-testid="error-name" role="alert" style={errorStyle}>{errors.name}</p>}
      </div>
      <div style={rowStyle}>
        <Field
          id="service-code"
          data-testid="service-code"
          label="Code"
          aria-required="true"
          aria-invalid={errors.code ? true : undefined}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {errors.code && <p data-testid="error-code" role="alert" style={errorStyle}>{errors.code}</p>}
      </div>
      <div style={rowStyle}>
        <Field
          id="service-sla"
          data-testid="service-sla"
          label="SLA (min)"
          type="number"
          aria-invalid={errors.slaMinutes ? true : undefined}
          value={slaMinutes}
          onChange={(e) => setSlaMinutes(Number(e.target.value))}
        />
        {errors.slaMinutes && <p data-testid="error-slaMinutes" role="alert" style={errorStyle}>{errors.slaMinutes}</p>}
      </div>
      <div style={rowStyle}>
        <Field
          id="service-order"
          data-testid="service-order"
          label="Priorité"
          type="number"
          aria-invalid={errors.order ? true : undefined}
          value={order}
          onChange={(e) => setOrder(Number(e.target.value))}
        />
        {errors.order && <p data-testid="error-order" role="alert" style={errorStyle}>{errors.order}</p>}
      </div>
      <Button type="submit" variant="primary" data-testid="service-submit">
        {t("admin.save", locale)}
      </Button>
    </form>
  );
}
