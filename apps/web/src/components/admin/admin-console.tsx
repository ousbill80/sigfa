/**
 * AdminConsole — the WEB-006 admin console shell.
 *
 * Enforces the RBAC matrix (admin-rbac): AGENT/AUDITOR see a 403 and NO section;
 * AGENCY_DIRECTOR sees only its agency-scoped sections; BANK_ADMIN+ see all 8.
 * The shell renders the section tabs the role may reach; each section body is a
 * dedicated component. v2 « Sérénité Premium » — @sigfa/ui + tokens only.
 * @module components/admin/admin-console
 */
"use client";

import { useState, type CSSProperties, type ReactElement } from "react";
import { Card } from "@sigfa/ui";
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

const pageStyle: CSSProperties = {
  padding: "var(--space-8)",
  maxWidth: "1200px",
  margin: "0 auto",
  backgroundColor: "var(--paper)",
  fontFamily: "var(--font-text)",
  color: "var(--ink)",
};

const overlineStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-faint)",
  margin: "0 0 var(--space-2)",
};

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "var(--text-2xl)",
  fontWeight: 600,
  lineHeight: "var(--leading-tight)",
  letterSpacing: "var(--tracking-tight)",
  color: "var(--ink)",
  margin: "0 0 var(--space-6)",
};

const navStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-2)",
  flexWrap: "wrap",
  marginBottom: "var(--space-8)",
};

const tabStyle = (active: boolean): CSSProperties => ({
  minHeight: "44px",
  padding: "0 var(--space-4)",
  border: `1px solid ${active ? "var(--brand)" : "var(--hairline)"}`,
  borderRadius: "var(--r-full)",
  backgroundColor: active ? "var(--brand)" : "var(--surface-1)",
  color: active ? "var(--brand-contrast)" : "var(--ink-soft)",
  cursor: "pointer",
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-sm)",
  fontWeight: active ? 600 : 500,
  boxShadow: active ? "var(--shadow-1)" : "none",
  transition: "background-color var(--dur-2) var(--ease), color var(--dur-2) var(--ease)",
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
      <div style={pageStyle}>
        <Card
          data-testid="admin-forbidden"
          role="alert"
          style={{ maxWidth: "32rem", margin: "var(--space-16) auto", textAlign: "center", padding: "var(--space-12) var(--space-8)" }}
        >
          <div style={overlineStyle}>403</div>
          <p style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-lg)", fontWeight: 600, color: "var(--ink)", margin: 0 }}>
            {t("admin.forbidden", locale)}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div data-testid="admin-console" style={pageStyle}>
      <p style={overlineStyle}>{t("admin.title", locale)}</p>
      <h1 style={titleStyle}>{t("admin.title", locale)}</h1>

      <nav data-testid="admin-sections" aria-label={t("admin.title", locale)} style={navStyle}>
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

      <Card data-testid="admin-section-body" style={{ padding: "var(--space-8)" }}>
        {active && renderSection ? renderSection(active) : null}
      </Card>
    </div>
  );
}
