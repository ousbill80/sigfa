/**
 * IdentitySection — bank identity: display name + --brand colour (WEB-006).
 *
 * As the BANK_ADMIN types a brand colour, a live preview computes the WCAG
 * contrast against --surface-1. If the ratio is below 4.5:1 an inline warning is
 * shown together with the auto-corrected value (theme.autoCorrectedBrand), which
 * is the value actually applied (per the contract appliedColors semantics).
 * Logo upload (R2) is out of scope (ADM-001) — UI only. v2 — @sigfa/ui + tokens.
 * @module components/admin/identity-section
 */
"use client";

import { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { Badge, Button, Field } from "@sigfa/ui";
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
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

const overlineStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-faint)",
  margin: "0 0 var(--space-4)",
};

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
    <section data-testid="identity-section" aria-label={t("admin.section.identity", locale)} style={{ maxWidth: "28rem" }}>
      <p style={overlineStyle}>{t("admin.section.identity", locale)}</p>

      <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <Field
            id="brand-input"
            data-testid="brand-input"
            label={t("admin.brand_label", locale)}
            aria-required="true"
            aria-invalid={needsCorrection || undefined}
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
        </div>
        <span
          data-testid="brand-swatch"
          aria-hidden="true"
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "var(--r-md)",
            backgroundColor: appliedBrand,
            border: "1px solid var(--hairline)",
            boxShadow: "var(--shadow-1)",
            flexShrink: 0,
          }}
        />
      </div>

      {needsCorrection && (
        <div
          data-testid="brand-warning"
          role="status"
          style={{
            marginTop: "var(--space-3)",
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-2)",
            alignItems: "center",
            fontSize: "var(--text-sm)",
            color: "var(--ink-soft)",
          }}
        >
          <Badge tone="warning" dot>
            {t("admin.brand_warning", locale)}
          </Badge>
          <span data-testid="brand-corrected">
            {t("admin.brand_corrected", locale)} : {corrected}
          </span>
        </div>
      )}

      <div style={{ marginTop: "var(--space-6)" }}>
        <Button
          type="button"
          data-testid="identity-save"
          variant="primary"
          onClick={() => onSave({ primary: appliedBrand, secondary: DEFAULT_THEME.brandSoft, background: DEFAULT_THEME.surface0 })}
        >
          {t("admin.save", locale)}
        </Button>
      </div>
    </section>
  );
}
