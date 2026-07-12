/**
 * CounterForm — numbered counter (guichet) create with service assignment (WEB-006).
 *
 * Creates a counter (POST /counters) with a label and an optional set of served
 * services. The label is required (inline error otherwise, no modal). Tokens only.
 * @module components/admin/counter-form
 */
"use client";

import { useState, type CSSProperties, type FormEvent, type ReactElement } from "react";
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

const inputStyle: CSSProperties = { minHeight: "40px", padding: "0 0.75rem", border: "1px solid var(--ink-soft)", borderRadius: "0.375rem", backgroundColor: "var(--surface-0)", color: "var(--ink-strong)", fontSize: "1rem" };

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
    <form data-testid="counter-form" onSubmit={handleSubmit} noValidate style={{ maxWidth: "24rem" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginBottom: "0.75rem" }}>
        <label htmlFor="counter-label" style={{ fontSize: "var(--caption)", color: "var(--ink-soft)" }}>Guichet (numéro)</label>
        <input id="counter-label" data-testid="counter-label" style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} />
        {error && <span data-testid="counter-error" style={{ fontSize: "var(--caption)", color: "var(--danger)" }}>{error}</span>}
      </div>
      <fieldset style={{ border: "1px solid var(--surface-1)", borderRadius: "0.375rem", padding: "0.5rem", marginBottom: "0.75rem" }}>
        <legend style={{ fontSize: "var(--caption)", color: "var(--ink-soft)" }}>Services affectés</legend>
        {services.map((service) => (
          <label key={service.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", color: "var(--ink-strong)" }}>
            <input type="checkbox" data-testid={`counter-service-${service.id}`} checked={serviceIds.includes(service.id)} onChange={() => toggleService(service.id)} />
            {service.name}
          </label>
        ))}
      </fieldset>
      <button type="submit" data-testid="counter-submit" style={{ minHeight: "40px", padding: "0 1rem", border: "none", borderRadius: "0.375rem", backgroundColor: "var(--brand)", color: "var(--brand-contrast)", cursor: "pointer", fontSize: "1rem" }}>
        {t("admin.save", locale)}
      </button>
    </form>
  );
}
