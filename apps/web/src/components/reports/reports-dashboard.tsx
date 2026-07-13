/**
 * ReportsDashboard — reporting surface composition (REP-003b).
 *
 * Hosts the export panel + inter-agency benchmarking table on a calm --paper
 * page (design system v2). RBAC: the whole surface (and the export trigger in
 * particular) is reserved for AGENCY_DIRECTOR+ / AUDITOR; any other role
 * (AGENT / MANAGER) sees a human "forbidden" notice and NO export control —
 * defence in depth on top of the middleware route guard. Owns only local UI
 * state (format/scope/period/sort); every number and status comes from the
 * REP-003 contract via the two hooks. FR/EN, tokens only, zero emoji.
 * @module components/reports/reports-dashboard
 */
"use client";

import { useEffect, useState, type ReactElement } from "react";
import { Card } from "@sigfa/ui";
import { t, type Locale } from "@/lib/i18n";
import { canAccess, type Role } from "@/lib/roles";
import {
  type ExportFormat,
  type ExportScope,
  type SortKpi,
} from "@/lib/reports-state";
import { useReportExport, type ReportingClient } from "@/lib/use-report-export";
import { useBenchmark } from "@/lib/use-benchmark";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { ExportPanel } from "./export-panel";
import { BenchmarkTable } from "./benchmark-table";

/** Route guarding the reporting surface (RBAC prefix). */
const REPORTS_ROUTE = "/dashboard/reports";

/** Props for {@link ReportsDashboard}. */
export interface ReportsDashboardProps {
  /** Typed reporting client. */
  reporting: ReportingClient;
  /** Bank UUID (JWT claim) — RBAC perimeter for the benchmark. */
  bankId: string;
  /** Agency UUID (JWT claim) — default scope=agency target. */
  agencyId: string;
  /** Viewer role — gates the whole surface (AGENT/MANAGER → forbidden). */
  role: Role;
  /** Analysis period (ex. "2026-07"). */
  period: string;
  /** Active locale. */
  locale?: Locale;
  /** Whether the app is offline. */
  offline?: boolean;
}

/**
 * Reporting surface (export + benchmarking).
 * @param props - {@link ReportsDashboardProps}.
 * @returns The dashboard element.
 */
export function ReportsDashboard({
  reporting,
  bankId,
  agencyId,
  role,
  period,
  locale = "fr",
  offline = false,
}: ReportsDashboardProps): ReactElement {
  const allowed = canAccess(role, REPORTS_ROUTE);

  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [scope, setScope] = useState<ExportScope>("agency");
  const [exportPeriod, setExportPeriod] = useState(period);

  const exporter = useReportExport({ reporting });
  const benchmark = useBenchmark({ reporting, bankId, period });

  useEffect(() => {
    if (allowed) void benchmark.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  if (!allowed) {
    return (
      <div style={{ padding: "var(--space-6)", maxWidth: "720px", margin: "0 auto" }}>
        <Card data-testid="reports-forbidden" role="alert" style={{ padding: "var(--space-8)", textAlign: "center" }}>
          <p style={{ margin: 0, color: "var(--ink)", fontSize: "var(--text-lg)", fontWeight: 600 }}>
            {t("reports.forbidden", locale)}
          </p>
        </Card>
      </div>
    );
  }

  const launch = (): void => {
    void exporter.launch({
      format,
      scope,
      period: exportPeriod,
      ...(scope === "agency" ? { agencyId } : {}),
    });
  };

  const handleSort = (sortKpi: SortKpi): void => {
    void benchmark.refresh(sortKpi);
  };

  return (
    <div
      data-testid="reports-dashboard"
      style={{ padding: "var(--space-6)", maxWidth: "1200px", margin: "0 auto", backgroundColor: "var(--paper)" }}
    >
      <header style={{ marginBottom: "var(--space-6)" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-3xl)",
            fontWeight: 600,
            letterSpacing: "var(--tracking-tight)",
            lineHeight: "var(--leading-tight)",
            color: "var(--ink)",
          }}
        >
          {t("reports.title", locale)}
        </h1>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <ExportPanel
          phase={exporter.phase}
          job={exporter.job}
          downloadable={exporter.downloadable}
          format={format}
          scope={scope}
          period={exportPeriod}
          offline={offline}
          locale={locale}
          onFormatChange={setFormat}
          onScopeChange={setScope}
          onPeriodChange={setExportPeriod}
          onLaunch={launch}
        />

        <BenchmarkTable
          rows={benchmark.rows}
          load={benchmark.load}
          sortKpi={benchmark.sortKpi}
          offline={offline}
          locale={locale}
          onSort={handleSort}
        />
      </div>

      <OfflineBanner />
    </div>
  );
}
