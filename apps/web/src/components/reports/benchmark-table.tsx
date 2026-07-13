/**
 * BenchmarkTable — inter-agency ranking as respiring row-cards (REP-003b).
 *
 * Design system v2 « Sérénité Premium »: the lined `<table>` (hierarchy by
 * borders = anti-pattern DS §5) is replaced by respiring row-cards separated by
 * space, not rules — a rounded rank chip (halo `--gold` for #1), the agency
 * name, the numeric value of the sorted KPI (`--font-display`, tabular-nums,
 * right-aligned), and a functional status pill. The pill colour is a pure
 * translation of the SERVER verdict (statusToken): VERT → --success, ORANGE →
 * --warning, ROUGE → --danger (bordered/dotted pill, never a solid red fill),
 * n/a → --info. Agencies without data (n/a) are relegated to the end by the
 * hook and rendered muted — never as red. `sortKpi` uses the tokenised `Select`
 * primitive (keeps focus ring). 4 states via Spinner/EmptyState (no rogue offline
 * banner — a single page-level one lives in the dashboard). FR/EN, tokens only.
 * @module components/reports/benchmark-table
 */
"use client";

import { useState, type CSSProperties, type ReactElement } from "react";
import { Card, EmptyState, SectionTitle, Select, Spinner } from "@sigfa/ui";
import { t, type Locale } from "@/lib/i18n";
import {
  SORT_KPIS,
  sortKpiLabelKey,
  statusToken,
  statusLabelKey,
  benchmarkValue,
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
  /** Whether the app is offline (freezes the ranking; banner is page-level). */
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

const rowCardStyle = (isNa: boolean, hovered: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: "var(--space-4)",
  padding: "var(--space-4)",
  borderRadius: "var(--r-md)",
  backgroundColor: hovered ? "var(--surface-2)" : "transparent",
  color: isNa ? "var(--ink-soft)" : "var(--ink)",
  transition: "background-color var(--dur-1) var(--ease)",
});

/** Rounded rank chip — #1 wears a soft --gold halo. */
const rankChipStyle = (isTop: boolean, isNa: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "2.25rem",
  height: "2.25rem",
  flex: "0 0 auto",
  borderRadius: "var(--r-full)",
  fontFamily: "var(--font-display)",
  fontSize: "var(--text-md)",
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
  color: isTop ? "var(--gold)" : isNa ? "var(--ink-faint)" : "var(--ink-soft)",
  backgroundColor: isTop ? "var(--gold-soft)" : "var(--surface-2)",
  boxShadow: isTop ? "0 0 0 3px var(--gold-soft)" : "none",
});

const valueStyle: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "var(--text-lg)",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "var(--tracking-numeric)",
  color: "var(--ink)",
  textAlign: "right",
  whiteSpace: "nowrap",
};

/** A single respiring benchmark row-card (hover surface = token, not a border). */
function BenchmarkRowCard({
  row,
  index,
  sortKpi,
  locale,
}: {
  row: BenchmarkRow;
  index: number;
  sortKpi: SortKpi;
  locale: Locale;
}): ReactElement {
  const [hovered, setHovered] = useState(false);
  const token = statusToken(row.status);
  const isNa = row.status === "n/a";
  const isTop = !isNa && index === 0;
  const value = benchmarkValue(row, sortKpi);
  return (
    <li
      data-testid="benchmark-row"
      data-status={row.status}
      style={rowCardStyle(isNa, hovered)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={rankChipStyle(isTop, isNa)} aria-hidden="true">
        {isNa ? "—" : index + 1}
      </span>
      <span style={{ flex: "1 1 auto", fontWeight: 600, minWidth: 0 }}>{row.agencyName}</span>
      <span data-testid="benchmark-value" style={{ ...valueStyle, minWidth: "6rem" }}>
        {value ?? t("reports.overview.value.none", locale)}
      </span>
      <span
        data-testid="benchmark-pill"
        role="img"
        aria-label={t(statusLabelKey(row.status), locale)}
        style={pillStyle(token)}
      >
        <span aria-hidden="true" style={{ width: "6px", height: "6px", borderRadius: "var(--r-full)", backgroundColor: token }} />
        {t(statusLabelKey(row.status), locale)}
      </span>
    </li>
  );
}

/**
 * Inter-agency benchmarking surface (respiring row-cards).
 * @param props - {@link BenchmarkTableProps}.
 * @returns The surface element.
 */
export function BenchmarkTable({
  rows,
  load,
  sortKpi,
  offline = false,
  locale = "fr",
  onSort,
}: BenchmarkTableProps): ReactElement {
  const kpiLabel = t(sortKpiLabelKey(sortKpi), locale);
  const header = (
    <header
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: "var(--space-4)",
        flexWrap: "wrap",
        marginBottom: "var(--space-5)",
      }}
    >
      <div>
        <SectionTitle size="xl">{t("reports.benchmark.title", locale)}</SectionTitle>
        <p style={{ margin: "var(--space-1) 0 0", color: "var(--ink-soft)", fontSize: "var(--text-sm)" }}>
          {t("reports.benchmark.subtitle", locale)}
        </p>
      </div>
      <div style={{ minWidth: "12rem" }}>
        <Select
          data-testid="benchmark-sort"
          label={t("reports.benchmark.sort", locale)}
          value={sortKpi}
          onChange={(e) => onSort(e.target.value as SortKpi)}
          options={SORT_KPIS.map((k) => ({ value: k, label: t(sortKpiLabelKey(k), locale) }))}
        />
      </div>
    </header>
  );

  if (load === "loading") {
    return (
      <Card data-testid="benchmark-loading" aria-busy="true" style={{ padding: "var(--space-6)" }}>
        {header}
        <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-8)" }}>
          <Spinner size="lg" label={t("reports.benchmark.title", locale)} />
        </div>
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
    <Card data-testid="benchmark-table" style={{ padding: "var(--space-6)" }} aria-disabled={offline || undefined}>
      {header}

      {/* Column kicker: rank / agency … value (of the sorted KPI) / status. */}
      <div
        aria-hidden="true"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          padding: "0 var(--space-4) var(--space-2)",
          color: "var(--ink-faint)",
          fontSize: "var(--text-xs)",
          textTransform: "uppercase",
        }}
      >
        <span style={{ width: "2.25rem", flex: "0 0 auto", textAlign: "center" }}>
          {t("reports.benchmark.col.rank", locale)}
        </span>
        <span style={{ flex: "1 1 auto" }}>{t("reports.benchmark.col.agency", locale)}</span>
        <span style={{ minWidth: "6rem", textAlign: "right" }}>{kpiLabel}</span>
        <span style={{ minWidth: "5rem", textAlign: "right" }}>{t("reports.benchmark.col.status", locale)}</span>
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        {rows.map((row, i) => (
          <BenchmarkRowCard key={row.agencyId} row={row} index={i} sortKpi={sortKpi} locale={locale} />
        ))}
      </ul>
    </Card>
  );
}
