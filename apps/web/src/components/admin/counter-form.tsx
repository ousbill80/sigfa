/**
 * CounterForm — numbered counter (guichet) create with service assignment (WEB-006).
 *
 * Creates a counter (POST /counters) with a label and an optional set of served
 * services. The label is required (inline error otherwise, no modal).
 * v2 « Sérénité Premium » — @sigfa/ui + tokens only.
 * @module components/admin/counter-form
 */
"use client";

import { useState, type CSSProperties, type FormEvent, type ReactElement } from "react";
import { Button, Field } from "@sigfa/ui";
import { t, type Locale } from "@/lib/i18n";

/** A selectable service option. */
export interface ServiceOption {
  id: string;
  name: string;
}

/** Props for {@link CounterForm}. */
export interface CounterFormProps {
  /** Available services to assign. */
  services: ServiceOption[];
  /** Persists the counter (POST /counters). */
  onSubmit: (draft: { label: string; serviceIds: string[] }) => void;
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
const legendStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--ink-soft)",
  padding: "0 var(--space-2)",
};
const checkboxRow: CSSProperties = {
  display: "flex",
  gap: "var(--space-3)",
  alignItems: "center",
  color: "var(--ink)",
  fontSize: "var(--text-md)",
  padding: "var(--space-2) 0",
};

/**
 * Counter creation form.
 * @param props - {@link CounterFormProps}.
 * @returns The form element.
 */
export function CounterForm({ services, onSubmit, locale = "fr" }: CounterFormProps): ReactElement {
  const [label, setLabel] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function toggleService(id: string): void {
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    if (label.trim().length === 0) {
      setError("Le numéro/libellé du guichet est obligatoire.");
      return;
    }
    setError(null);
    onSubmit({ label, serviceIds });
  }

  return (
    <form data-testid="counter-form" onSubmit={handleSubmit} noValidate style={{ maxWidth: "26rem" }}>
      <p style={overlineStyle}>{t("admin.section.counters", locale)}</p>

      <div style={{ marginBottom: "var(--space-4)" }}>
        <Field
          id="counter-label"
          data-testid="counter-label"
          label="Guichet (numéro)"
          aria-required="true"
          aria-invalid={error ? true : undefined}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        {error && <p data-testid="counter-error" role="alert" style={errorStyle}>{error}</p>}
      </div>

      <fieldset
        style={{
          border: "1px solid var(--hairline)",
          borderRadius: "var(--r-md)",
          padding: "var(--space-3) var(--space-4)",
          marginBottom: "var(--space-6)",
        }}
      >
        <legend style={legendStyle}>Services affectés</legend>
        {services.map((service) => (
          <label key={service.id} style={checkboxRow}>
            <input
              type="checkbox"
              data-testid={`counter-service-${service.id}`}
              checked={serviceIds.includes(service.id)}
              onChange={() => toggleService(service.id)}
              style={{ width: "18px", height: "18px", accentColor: "var(--brand)" }}
            />
            {service.name}
          </label>
        ))}
      </fieldset>

      <Button type="submit" variant="primary" data-testid="counter-submit">
        {t("admin.save", locale)}
      </Button>
    </form>
  );
}
