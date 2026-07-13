/**
 * AuditForbidden — server-rendered 403 for the Auditor screen (SEC-001b).
 *
 * Rendered by the audit page's server component when the verified role is not
 * AUDITOR / SUPER_ADMIN / BANK_ADMIN (defence in depth on top of the middleware).
 * Pure server component: no client access decision, no mutation control. The
 * `data-status="403"` marker lets a server-render test assert the denial.
 * @module app/audit/audit-forbidden
 */
import type { ReactElement } from "react";

/** Server-rendered 403 view for the audit trail. */
export function AuditForbidden(): ReactElement {
  return (
    <main
      role="main"
      data-testid="audit-forbidden"
      data-status="403"
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-3)",
        padding: "var(--space-8)",
        background: "var(--paper)",
        color: "var(--ink)",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-4xl)",
          fontWeight: 700,
          margin: 0,
          color: "var(--ink)",
        }}
      >
        403
      </h1>
      <p style={{ color: "var(--ink-soft)", textAlign: "center", margin: 0 }}>
        Accès refusé — journal d&apos;audit réservé aux auditeurs.
      </p>
    </main>
  );
}
