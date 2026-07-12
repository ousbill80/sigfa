/**
 * IdentitySection — bank identity: display name + --brand colour (WEB-006).
 *
 * As the BANK_ADMIN types a brand colour, a live preview computes the WCAG
 * contrast against --surface-1. If the ratio is below 4.5:1 an inline warning is
 * shown together with the auto-corrected value (theme.autoCorrectedBrand), which
 * is the value actually applied (per the contract appliedColors semantics).
 * Logo upload (R2) is out of scope (ADM-001) — UI only. Tokens only.
 * @module components/admin/identity-section
 */
"use client";

import { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { autoCorrectedBrand, contrastRatio, DEFAULT_THEME } from "@/lib/theme";
import { t, type Locale } from "@/lib/i18n";

/** Props for {@link IdentitySection}. */
export interface IdentitySectionProps {
  /** Persists the requested colour (PATCH /banks/{id}/theme). */
  onSave: (requestedColors: { primary: string; secondary: string; background: string }) => void;
  /** Initial brand colour. */
  initialBrand?: string;
  /** Active locale. */
  locale?: Locale;
}

const MIN_RATIO = 4.5;

const inputStyle: CSSProperties = {
  minHeight: "40px",
  padding: "0 0.75rem",
  border: "1px solid var(--ink-soft)",
  borderRadius: "0.375rem",
  backgroundColor: "var(--surface-0)",
  color: "var(--ink-strong)",
  fontSize: "1rem",
};

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/**
 * Bank identity configuration section.
 * @param props - {@link IdentitySectionProps}.
 * @returns The section element.
 */
export function IdentitySection({ onSave, initialBrand = DEFAULT_THEME.brand, locale = "fr" }: IdentitySectionProps): ReactElement {
  const [brand, setBrand] = useState(initialBrand);

  const { valid, ratio, corrected } = useMemo(() => {
    if (!HEX_RE.test(brand)) return { valid: false, ratio: 0, corrected: brand };
    const r = contrastRatio(brand, DEFAULT_THEME.surface1);
    return { valid: true, ratio: r, corrected: autoCorrectedBrand(brand, DEFAULT_THEME.surface1) };
  }, [brand]);

  const needsCorrection = valid && ratio < MIN_RATIO;
  // The applied colour is the corrected one when the requested colour fails.
  const appliedBrand = needsCorrection ? corrected : brand;

  return (
    <section data-testid="identity-section" aria-label={t("admin.section.identity", locale)}>
      <label htmlFor="brand-input" style={{ fontSize: "var(--caption)", color: "var(--ink-soft)" }}>
        {t("admin.brand_label", locale)}
      </label>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "0.25rem" }}>
        <input
          id="brand-input"
          data-testid="brand-input"
          style={inputStyle}
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          aria-invalid={needsCorrection}
        />
        <span
          data-testid="brand-swatch"
          aria-hidden="true"
          style={{ width: "40px", height: "40px", borderRadius: "0.375rem", backgroundColor: appliedBrand, border: "1px solid var(--ink-soft)" }}
        />
      </div>

      {needsCorrection && (
        <div data-testid="brand-warning" role="status" style={{ marginTop: "0.5rem", fontSize: "var(--caption)", color: "var(--warning)" }}>
          {t("admin.brand_warning", locale)}{" "}
          <span data-testid="brand-corrected">
            {t("admin.brand_corrected", locale)} : {corrected}
          </span>
        </div>
      )}

      <button
        type="button"
        data-testid="identity-save"
        onClick={() => onSave({ primary: appliedBrand, secondary: DEFAULT_THEME.brandSoft, background: DEFAULT_THEME.surface0 })}
        style={{
          marginTop: "1rem",
          minHeight: "40px",
          padding: "0 1rem",
          border: "none",
          borderRadius: "0.375rem",
          backgroundColor: "var(--brand)",
          color: "var(--brand-contrast)",
          cursor: "pointer",
          fontSize: "1rem",
        }}
      >
        {t("admin.save", locale)}
      </button>
    </section>
  );
}
