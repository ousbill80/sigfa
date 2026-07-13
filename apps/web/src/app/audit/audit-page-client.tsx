/**
 * Auditor screen client shell (SEC-001b) — S3.
 *
 * apiBase / role arrive as PROPS from the server component (verified JWT claims
 * in real mode, mock fixture otherwise). RBAC AUDITOR / SUPER_ADMIN is enforced
 * by the middleware (roles.ts) AND re-checked server-side in the page (defence in
 * depth). This shell is STRICTLY read-only: it consumes ONLY GET /audit-logs
 * (typed admin client, CONTRACT-005) and renders no mutation control.
 * @module app/audit/audit-page-client
 */
"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { AuditLogTable } from "@/components/audit/audit-log-table";
import { useAuditLog, type AuditFilters } from "@/lib/use-audit-log";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/i18n";

/** Props derived server-side (S3 — never client tenant constants). */
export interface AuditPageClientProps {
  /** Base API: /api/rt in real mode, Prism mock otherwise. */
  apiBase: string;
  /** Active locale (FR default). */
  locale?: Locale;
}

/**
 * Auditor screen client shell.
 * @param props - {@link AuditPageClientProps}.
 * @returns The screen element.
 */
export function AuditPageClient({ apiBase, locale = "fr" }: AuditPageClientProps): ReactElement {
  const admin = useMemo(() => createSigfaClient("admin", apiBase), [apiBase]);
  const audit = useAuditLog({ admin });
  const [draft, setDraft] = useState<AuditFilters>({});
  const [offline, setOffline] = useState(false);
  const activeLocale: Locale = SUPPORTED_LOCALES.includes(locale) ? locale : "fr";

  const { refresh } = audit;
  // Initial load (page 1, no filters). refresh is stable per admin client.
  useEffect(() => {
    void refresh({ filters: {}, page: 1 });
  }, [refresh]);

  useEffect(() => {
    const goOffline = (): void => setOffline(true);
    const goOnline = (): void => setOffline(false);
    if (!navigator.onLine) setOffline(true);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  return (
    <main style={{ padding: "var(--space-6)", maxWidth: "72rem", margin: "0 auto" }}>
      <AuditLogTable
        entries={audit.entries}
        load={audit.load}
        filters={draft}
        page={audit.page}
        total={audit.total}
        limit={audit.limit}
        offline={offline}
        locale={activeLocale}
        onFilterChange={(field, value) => setDraft((prev) => ({ ...prev, [field]: value }))}
        onApply={() => void refresh({ filters: draft, page: 1 })}
        onReset={() => {
          setDraft({});
          void refresh({ filters: {}, page: 1 });
        }}
        onPage={(page) => void refresh({ filters: draft, page })}
      />
    </main>
  );
}
