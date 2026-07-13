/**
 * NOTIF-005-B — FR/EN language toggle for the PWA (two locales only).
 * @module components/pwa/PwaLanguageToggle
 */
"use client";

import type { ReactElement } from "react";
import { pt, PWA_LOCALES, type PwaLocale } from "@/lib/pwa/pwa-i18n";

/** Props for {@link PwaLanguageToggle}. */
export interface PwaLanguageToggleProps {
  readonly locale: PwaLocale;
  readonly onChange: (locale: PwaLocale) => void;
}

/**
 * Segmented FR/EN switch. Icon-free but each option pairs a code with its full
 * language name via `aria-label` (icône+texte appariés — here text+text).
 *
 * @param props - Current locale + change handler.
 * @returns The toggle element.
 */
export function PwaLanguageToggle({ locale, onChange }: PwaLanguageToggleProps): ReactElement {
  return (
    <div
      data-testid="pwa-lang-toggle"
      role="group"
      aria-label="Language / Langue"
      style={{
        display: "inline-flex",
        gap: "var(--space-1)",
        padding: "var(--space-1)",
        borderRadius: "var(--r-full)",
        backgroundColor: "var(--surface-2)",
      }}
    >
      {PWA_LOCALES.map((loc) => {
        const active = loc === locale;
        return (
          <button
            key={loc}
            type="button"
            data-testid={`pwa-lang-${loc}`}
            aria-pressed={active}
            aria-label={pt(loc === "fr" ? "pwa.lang.fr" : "pwa.lang.en", locale)}
            onClick={() => onChange(loc)}
            style={{
              minWidth: "48px",
              minHeight: "40px",
              border: "none",
              cursor: "pointer",
              borderRadius: "var(--r-full)",
              fontSize: "var(--text-sm)",
              fontWeight: 600,
              color: active ? "var(--brand-contrast)" : "var(--ink-soft)",
              backgroundColor: active ? "var(--brand)" : "transparent",
            }}
          >
            {loc.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
