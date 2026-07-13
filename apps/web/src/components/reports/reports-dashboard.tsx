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

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { EmptyState, KpiTile, OfflineBanner, PageTitle } from "@sigfa/ui";
import { t, type Locale } from "@/lib/i18n";
import { canAccess, type Role } from "@/lib/roles";
import {
  benchmarkOverview,
  type ExportFormat,
  type ExportScope,
  type SortKpi,
} from "@/lib/reports-state";
import { useReportExport, type ReportingClient } from "@/lib/use-report-export";
import { useBenchmark } from "@/lib/use-benchmark";
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
        <div data-testid="reports-forbidden" role="alert">
          <EmptyState title={t("reports.forbidden", locale)} />
        </div>
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

  const overview = useMemo(() => benchmarkOverview(benchmark.rows), [benchmark.rows]);
  const showOverview = benchmark.load === "ready" && benchmark.rows.length > 0;
  const dash = t("reports.overview.value.none", locale);

  return (
    <div
      data-testid="reports-dashboard"
      style={{ padding: "var(--space-6)", maxWidth: "1200px", margin: "0 auto", backgroundColor: "var(--paper)" }}
    >
      {offline && (
        <div data-testid="reports-offline" style={{ marginBottom: "var(--space-5)" }}>
          <OfflineBanner message={t("reports.benchmark.offline", locale)} />
        </div>
      )}

      <header style={{ marginBottom: "var(--space-6)" }}>
        <PageTitle size="3xl">{t("reports.title", locale)}</PageTitle>
        <p style={{ margin: "var(--space-1) 0 0", color: "var(--ink-soft)", fontSize: "var(--text-sm)" }}>
          {t("reports.benchmark.period", locale)} · {period}
        </p>
      </header>

      {showOverview && (
        <div
          data-testid="reports-overview"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "var(--space-4)",
            marginBottom: "var(--space-6)",
          }}
        >
          <KpiTile label={t("reports.overview.ranked", locale)} value={String(overview.ranked)} />
          <KpiTile label={t("reports.overview.best", locale)} value={overview.best ?? dash} />
          <KpiTile label={t("reports.overview.worst", locale)} value={overview.worst ?? dash} />
          <KpiTile label={t("reports.overview.naShare", locale)} value={`${overview.naSharePct} %`} />
        </div>
      )}

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
    </div>
  );
}
