/**
 * AdminConsole — the WEB-006 admin console shell.
 *
 * Enforces the RBAC matrix (admin-rbac): AGENT/AUDITOR see a 403 and NO section;
 * AGENCY_DIRECTOR sees only its agency-scoped sections; BANK_ADMIN+ see all 8.
 * The shell renders the section tabs the role may reach; each section body is a
 * dedicated component. Tokens only, i18n throughout.
 * @module components/admin/admin-console
 */
"use client";

import { useState, type CSSProperties, type ReactElement } from "react";
import { visibleSections, type AdminSection } from "@/lib/admin-rbac";
import type { Role } from "@/lib/roles";
import { t, type Locale, type TranslationKey } from "@/lib/i18n";

/** Props for {@link AdminConsole}. */
export interface AdminConsoleProps {
  /** The viewer role (from the JWT claim). */
  role: Role;
  /** Active locale. */
  locale?: Locale;
  /** Optional slot renderer for a section body (kept simple for the shell tests). */
  renderSection?: (section: AdminSection) => ReactElement | null;
}

/** i18n key for each section tab label. */
const SECTION_LABEL: Record<AdminSection, TranslationKey> = {
  identity: "admin.section.identity",
  agencies: "admin.section.agencies",
  services: "admin.section.services",
  counters: "admin.section.counters",
  agents: "admin.section.agents",
  "sms-templates": "admin.section.sms_templates",
  thresholds: "admin.section.thresholds",
  onboarding: "admin.section.onboarding",
};

const tabStyle = (active: boolean): CSSProperties => ({
  minHeight: "40px",
  padding: "0 1rem",
  border: "1px solid var(--ink-soft)",
  borderRadius: "0.375rem",
  backgroundColor: active ? "var(--brand)" : "var(--surface-1)",
  color: active ? "var(--brand-contrast)" : "var(--ink-strong)",
  cursor: "pointer",
  fontSize: "var(--caption)",
});

/**
 * Admin console shell with RBAC-gated section tabs.
 * @param props - {@link AdminConsoleProps}.
 * @returns The console element (or a 403 for AGENT/AUDITOR).
 */
export function AdminConsole({ role, locale = "fr", renderSection }: AdminConsoleProps): ReactElement {
  const sections = visibleSections(role);
  const [active, setActive] = useState<AdminSection | null>(sections[0] ?? null);

  if (sections.length === 0) {
    return (
      <div data-testid="admin-forbidden" role="alert" style={{ padding: "1.5rem", color: "var(--ink-strong)" }}>
        {t("admin.forbidden", locale)}
      </div>
    );
  }

  return (
    <div data-testid="admin-console" style={{ padding: "1.5rem", maxWidth: "1200px", margin: "0 auto", backgroundColor: "var(--surface-0)" }}>
      <h1 style={{ fontSize: "1.125rem", color: "var(--ink-strong)", margin: "0 0 1rem" }}>{t("admin.title", locale)}</h1>

      <nav data-testid="admin-sections" aria-label={t("admin.title", locale)} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        {sections.map((section) => (
          <button
            key={section}
            type="button"
            data-testid={`section-tab-${section}`}
            aria-current={active === section}
            onClick={() => setActive(section)}
            style={tabStyle(active === section)}
          >
            {t(SECTION_LABEL[section], locale)}
          </button>
        ))}
      </nav>

      <div data-testid="admin-section-body">
        {active && renderSection ? renderSection(active) : null}
      </div>
    </div>
  );
}
