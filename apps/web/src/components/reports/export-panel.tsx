/**
 * ExportPanel — report export trigger + async job tracking (REP-003b).
 *
 * Design system v2 « Sérénité Premium »: calm --surface-1 card, --brand primary
 * action, tokens only, zero hard-coded value, zero emoji. Renders the 5 surface
 * states of the export flow:
 *   - nominal  : format/scope/period selectors + "start export" button;
 *   - loading  : PENDING/PROCESSING spinner + status label (poll in progress);
 *   - ready    : signed-URL download button (or "restart" when the URL expired);
 *   - error/failed : human message + restart action (never a silent dead link);
 *   - offline  : connection-required notice, action disabled.
 * The status verdict and download URL come from the hook (REP-003 contract) —
 * this component only renders. FR/EN via the `locale` prop.
 * @module components/reports/export-panel
 */
"use client";

import { type CSSProperties, type ReactElement } from "react";
import { Badge, Button, Card, Skeleton } from "@sigfa/ui";
import { t, type Locale } from "@/lib/i18n";
import {
  EXPORT_FORMATS,
  EXPORT_SCOPES,
  exportFormatLabelKey,
  exportScopeLabelKey,
  exportStatusLabelKey,
  isJobInFlight,
  type ExportFormat,
  type ExportScope,
} from "@/lib/reports-state";
import type { ExportPhase, ExportJob } from "@/lib/use-report-export";

/** Props for {@link ExportPanel}. */
export interface ExportPanelProps {
  /** Current workflow phase. */
  phase: ExportPhase;
  /** Current job snapshot (null before the first launch). */
  job: ExportJob | null;
  /** True when READY with a live (non-expired) signed URL. */
  downloadable: boolean;
  /** Selected format. */
  format: ExportFormat;
  /** Selected scope. */
  scope: ExportScope;
  /** Selected period (ex. "2026-07"). */
  period: string;
  /** Whether the app is offline (disables the trigger). */
  offline?: boolean;
  /** Active locale. */
  locale?: Locale;
  /** Format change handler. */
  onFormatChange: (format: ExportFormat) => void;
  /** Scope change handler. */
  onScopeChange: (scope: ExportScope) => void;
  /** Period change handler. */
  onPeriodChange: (period: string) => void;
  /** Launch handler. */
  onLaunch: () => void;
}

const sectionLabel: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  letterSpacing: "var(--tracking-tight)",
  textTransform: "uppercase",
  color: "var(--ink-soft)",
  marginBottom: "var(--space-2)",
};

const selectStyle: CSSProperties = {
  width: "100%",
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--r-md)",
  border: "1px solid var(--hairline)",
  backgroundColor: "var(--surface-2)",
  color: "var(--ink)",
  fontSize: "var(--text-md)",
  fontFamily: "inherit",
};

const fieldWrap: CSSProperties = { flex: "1 1 160px", minWidth: 0 };

/**
 * Report export panel.
 * @param props - {@link ExportPanelProps}.
 * @returns The panel element.
 */
export function ExportPanel({
  phase,
  job,
  downloadable,
  format,
  scope,
  period,
  offline = false,
  locale = "fr",
  onFormatChange,
  onScopeChange,
  onPeriodChange,
  onLaunch,
}: ExportPanelProps): ReactElement {
  const inFlight = phase === "launching" || (job !== null && isJobInFlight(job.status) && phase === "polling");
  const canRestart = phase === "failed" || phase === "error" || (phase === "ready" && !downloadable);

  return (
    <Card data-testid="export-panel" style={{ padding: "var(--space-6)" }}>
      <header style={{ marginBottom: "var(--space-4)" }}>
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
          {t("reports.export.title", locale)}
        </h2>
        <p style={{ margin: "var(--space-1) 0 0", color: "var(--ink-soft)", fontSize: "var(--text-sm)" }}>
          {t("reports.export.subtitle", locale)}
        </p>
      </header>

      <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={fieldWrap}>
          <div style={sectionLabel}>{t("reports.export.format", locale)}</div>
          <select
            data-testid="export-format"
            aria-label={t("reports.export.format", locale)}
            value={format}
            onChange={(e) => onFormatChange(e.target.value as ExportFormat)}
            style={selectStyle}
          >
            {EXPORT_FORMATS.map((f) => (
              <option key={f} value={f}>
                {t(exportFormatLabelKey(f), locale)}
              </option>
            ))}
          </select>
        </div>

        <div style={fieldWrap}>
          <div style={sectionLabel}>{t("reports.export.scope", locale)}</div>
          <select
            data-testid="export-scope"
            aria-label={t("reports.export.scope", locale)}
            value={scope}
            onChange={(e) => onScopeChange(e.target.value as ExportScope)}
            style={selectStyle}
          >
            {EXPORT_SCOPES.map((s) => (
              <option key={s} value={s}>
                {t(exportScopeLabelKey(s), locale)}
              </option>
            ))}
          </select>
        </div>

        <div style={fieldWrap}>
          <div style={sectionLabel}>{t("reports.export.period", locale)}</div>
          <input
            data-testid="export-period"
            type="month"
            aria-label={t("reports.export.period", locale)}
            value={period}
            onChange={(e) => onPeriodChange(e.target.value)}
            style={selectStyle}
          />
        </div>

        <div style={fieldWrap}>
          <Button
            variant="primary"
            data-testid="export-launch"
            disabled={offline || inFlight}
            onClick={onLaunch}
            style={{ width: "100%" }}
          >
            {t("reports.export.launch", locale)}
          </Button>
        </div>
      </div>

      {offline && (
        <p data-testid="export-offline" role="status" style={{ marginTop: "var(--space-4)", color: "var(--info)", fontSize: "var(--text-sm)" }}>
          {t("reports.export.offline", locale)}
        </p>
      )}

      {/* Job tracking area (5 states of the flow). */}
      <div style={{ marginTop: "var(--space-5)" }}>
        {phase === "idle" && !offline && (
          <p data-testid="export-empty" style={{ margin: 0, color: "var(--ink-faint)", fontSize: "var(--text-sm)" }}>
            {t("reports.export.empty", locale)}
          </p>
        )}

        {inFlight && (
          <div data-testid="export-loading" aria-busy="true" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <Skeleton style={{ height: "20px", width: "20px", borderRadius: "var(--r-full)" }} />
            <span style={{ color: "var(--ink-soft)", fontSize: "var(--text-sm)" }}>
              {t(exportStatusLabelKey(job?.status ?? "PENDING"), locale)}
            </span>
          </div>
        )}

        {phase === "ready" && downloadable && job?.downloadUrl && (
          <div data-testid="export-ready" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <Badge tone="success" dot>
              {t("reports.export.status.ready", locale)}
            </Badge>
            <a
              data-testid="export-download"
              href={job.downloadUrl}
              className="sig-btn sig-btn--primary sig-btn--md"
              style={{ textDecoration: "none" }}
              download
            >
              {t("reports.export.download", locale)}
            </a>
          </div>
        )}

        {phase === "ready" && !downloadable && (
          <p data-testid="export-expired" role="alert" style={{ margin: "0 0 var(--space-3)", color: "var(--ink)", fontSize: "var(--text-sm)" }}>
            {t("reports.export.expired", locale)}
          </p>
        )}

        {phase === "failed" && (
          <p data-testid="export-failed" role="alert" style={{ margin: "0 0 var(--space-3)", color: "var(--ink)", fontSize: "var(--text-sm)" }}>
            {t("reports.export.status.failed", locale)}
          </p>
        )}

        {phase === "error" && (
          <p data-testid="export-error" role="alert" style={{ margin: "0 0 var(--space-3)", color: "var(--ink)", fontSize: "var(--text-sm)" }}>
            {t("reports.export.error", locale)}
          </p>
        )}

        {canRestart && (
          <Button
            variant="secondary"
            size="dense"
            data-testid="export-retry"
            disabled={offline}
            onClick={onLaunch}
          >
            {t("reports.export.retry", locale)}
          </Button>
        )}
      </div>
    </Card>
  );
}
