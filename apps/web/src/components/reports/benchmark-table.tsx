/**
 * BenchmarkTable — inter-agency ranking table (REP-003b).
 *
 * Design system v2 « Sérénité Premium »: --surface-1 card, --font-display rank
 * numerals, --gold accent for #1, token-only status pills. The status pill
 * colour is a pure translation of the SERVER verdict (statusToken): VERT →
 * --success, ORANGE → --warning, ROUGE → --danger (bordered/dotted pill, never a
 * solid red fill), n/a → --info. Agencies without data (n/a) are relegated to
 * the end by the hook and rendered muted — never as red. `sortKpi` is a
 * server-driven control (onSort re-fetches). 4 states + offline. FR/EN.
 * @module components/reports/benchmark-table
 */
"use client";

import { type CSSProperties, type ReactElement } from "react";
import { Card, EmptyState, OfflineBanner, Skeleton } from "@sigfa/ui";
import { t, type Locale } from "@/lib/i18n";
import {
  SORT_KPIS,
  sortKpiLabelKey,
  statusToken,
  statusLabelKey,
  type BenchmarkRow,
  type SortKpi,
} from "@/lib/reports-state";
import type { BenchmarkLoad } from "@/lib/use-benchmark";

/** Props for {@link BenchmarkTable}. */
export interface BenchmarkTableProps {
  /** Ordered rows (ranked first, n/a last). */
  rows: BenchmarkRow[];
  /** Fetch lifecycle. */
  load: BenchmarkLoad;
  /** Current sort KPI. */
  sortKpi: SortKpi;
  /** Whether the app is offline (freezes the ranking). */
  offline?: boolean;
  /** Active locale. */
  locale?: Locale;
  /** Sort change handler (re-fetches server-side). */
  onSort: (sortKpi: SortKpi) => void;
}

/** Soft-tinted background derived from a functional token. */
const softOf: Record<string, string> = {
  "var(--success)": "var(--success-soft)",
  "var(--warning)": "var(--warning-soft)",
  "var(--danger)": "var(--danger-soft)",
  "var(--info)": "var(--info-soft)",
};

/** Status pill style — functional token as dot + border + soft bg, never a solid fill. */
const pillStyle = (token: string): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-2)",
  minWidth: "5rem",
  padding: "var(--space-1) var(--space-3)",
  borderRadius: "var(--r-full)",
  backgroundColor: softOf[token] ?? "var(--surface-2)",
  border: `1px solid ${token}`,
  color: "var(--ink)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  justifyContent: "center",
  whiteSpace: "nowrap",
});

const sectionLabel: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  letterSpacing: "var(--tracking-tight)",
  textTransform: "uppercase",
  color: "var(--ink-soft)",
  marginBottom: "var(--space-3)",
};

const selectStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--r-md)",
  border: "1px solid var(--hairline)",
  backgroundColor: "var(--surface-2)",
  color: "var(--ink)",
  fontSize: "var(--text-sm)",
  fontFamily: "inherit",
};

/**
 * Inter-agency benchmarking table.
 * @param props - {@link BenchmarkTableProps}.
 * @returns The table element.
 */
export function BenchmarkTable({
  rows,
  load,
  sortKpi,
  offline = false,
  locale = "fr",
  onSort,
}: BenchmarkTableProps): ReactElement {
  const header = (
    <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
      <div>
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-xl)",
            fontWeight: 600,
            letterSpacing: "var(--tracking-tight)",
            color: "var(--ink)",
          }}
        >
          {t("reports.benchmark.title", locale)}
        </h2>
        <p style={{ margin: "var(--space-1) 0 0", color: "var(--ink-soft)", fontSize: "var(--text-sm)" }}>
          {t("reports.benchmark.subtitle", locale)}
        </p>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", color: "var(--ink-soft)", fontSize: "var(--text-sm)" }}>
        {t("reports.benchmark.sort", locale)}
        <select
          data-testid="benchmark-sort"
          aria-label={t("reports.benchmark.sort", locale)}
          value={sortKpi}
          onChange={(e) => onSort(e.target.value as SortKpi)}
          style={selectStyle}
        >
          {SORT_KPIS.map((k) => (
            <option key={k} value={k}>
              {t(sortKpiLabelKey(k), locale)}
            </option>
          ))}
        </select>
      </label>
    </header>
  );

  if (load === "loading") {
    return (
      <Card data-testid="benchmark-loading" aria-busy="true" style={{ padding: "var(--space-6)" }}>
        {header}
        <Skeleton style={{ height: "220px" }} />
      </Card>
    );
  }

  if (load === "error") {
    return (
      <Card data-testid="benchmark-error" role="alert" style={{ padding: "var(--space-6)" }}>
        {header}
        <p style={{ margin: 0, color: "var(--ink)", fontSize: "var(--text-md)" }}>{t("reports.benchmark.error", locale)}</p>
      </Card>
    );
  }

  if (load === "empty" || rows.length === 0) {
    return (
      <Card data-testid="benchmark-empty" style={{ padding: "var(--space-6)" }}>
        {header}
        <EmptyState title={t("reports.benchmark.empty", locale)} />
      </Card>
    );
  }

  return (
    <Card data-testid="benchmark-table" style={{ padding: "var(--space-6)" }}>
      {header}

      {offline && (
        <div data-testid="benchmark-offline" style={{ marginBottom: "var(--space-4)" }}>
          <OfflineBanner message={t("reports.benchmark.offline", locale)} />
        </div>
      )}

      <div style={sectionLabel}>{t(sortKpiLabelKey(sortKpi), locale)}</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--ink-soft)", fontSize: "var(--text-xs)" }}>
            <th style={{ padding: "var(--space-2) var(--space-3)", width: "3rem", textAlign: "right" }}>
              {t("reports.benchmark.col.rank", locale)}
            </th>
            <th style={{ padding: "var(--space-2) var(--space-3)" }}>{t("reports.benchmark.col.agency", locale)}</th>
            <th style={{ padding: "var(--space-2) var(--space-3)", textAlign: "right" }}>{t("reports.benchmark.col.status", locale)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const token = statusToken(row.status);
            const isNa = row.status === "n/a";
            const isTop = !isNa && i === 0;
            return (
              <tr
                key={row.agencyId}
                data-testid="benchmark-row"
                data-status={row.status}
                style={{ borderBottom: "1px solid var(--hairline)", color: isNa ? "var(--ink-soft)" : "var(--ink)" }}
              >
                <td style={{ padding: "var(--space-3)", width: "3rem", textAlign: "right" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "var(--text-lg)",
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      color: isTop ? "var(--gold)" : "var(--ink-faint)",
                    }}
                  >
                    {isNa ? "—" : i + 1}
                  </span>
                </td>
                <td style={{ padding: "var(--space-3)", fontWeight: 600 }}>{row.agencyName}</td>
                <td style={{ padding: "var(--space-3)", textAlign: "right" }}>
                  <span
                    data-testid="benchmark-pill"
                    role="img"
                    aria-label={t(statusLabelKey(row.status), locale)}
                    style={pillStyle(token)}
                  >
                    <span aria-hidden="true" style={{ width: "6px", height: "6px", borderRadius: "var(--r-full)", backgroundColor: token }} />
                    {t(statusLabelKey(row.status), locale)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
