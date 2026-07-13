/**
 * ExportPanel — report export trigger + async job tracking (REP-003b).
 *
 * Design system v2 « Sérénité Premium »: calm --surface-1 card, --brand primary
 * action, tokens only, zero hard-coded value, zero emoji. Fields use the
 * tokenised `Select` / `Field` primitives (focus ring preserved). Renders the 5
 * surface states of the export flow:
 *   - nominal  : format/scope/period selectors + "start export" button;
 *   - loading  : a tokenised `Spinner` + status label (poll in progress);
 *   - ready    : signed-URL download button (or "restart" when the URL expired);
 *   - error/failed/expired : tonal Badge + paired icon + restart action (never a
 *     bare grey <p>, never a silent dead link);
 *   - offline  : the single page-level banner lives in the dashboard; here the
 *     trigger is simply disabled.
 * The status verdict and download URL come from the hook (REP-003 contract) —
 * this component only renders. FR/EN via the `locale` prop.
 * @module components/reports/export-panel
 */
"use client";

import { type ReactElement } from "react";
import { Badge, Button, Card, Field, SectionTitle, Select, Spinner } from "@sigfa/ui";
import { t, type Locale, type TranslationKey } from "@/lib/i18n";
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

const fieldWrap = { flex: "1 1 160px", minWidth: 0 } as const;

/** A small warning glyph paired with a tonal state badge (never colour alone). */
function AlertIcon(): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.5 15 14H1L8 1.5Z" />
      <path d="M8 6.5v3.5" />
      <path d="M8 12h.01" />
    </svg>
  );
}

/** A tonal state row: warning Badge + paired icon + a human sentence. */
function StateNotice({
  testId,
  badgeKey,
  message,
  locale,
}: {
  testId: string;
  badgeKey: TranslationKey;
  message: string;
  locale: Locale;
}): ReactElement {
  return (
    <div
      data-testid={testId}
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        flexWrap: "wrap",
        marginBottom: "var(--space-3)",
      }}
    >
      <Badge tone="warning" dot>
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}
        >
          <AlertIcon />
          {t(badgeKey, locale)}
        </span>
      </Badge>
      <span style={{ color: "var(--ink)", fontSize: "var(--text-sm)" }}>{message}</span>
    </div>
  );
}

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
      <header style={{ marginBottom: "var(--space-5)" }}>
        <SectionTitle size="xl">{t("reports.export.title", locale)}</SectionTitle>
        <p style={{ margin: "var(--space-1) 0 0", color: "var(--ink-soft)", fontSize: "var(--text-sm)" }}>
          {t("reports.export.subtitle", locale)}
        </p>
      </header>

      <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={fieldWrap}>
          <Select
            data-testid="export-format"
            label={t("reports.export.format", locale)}
            value={format}
            onChange={(e) => onFormatChange(e.target.value as ExportFormat)}
            options={EXPORT_FORMATS.map((f) => ({ value: f, label: t(exportFormatLabelKey(f), locale) }))}
          />
        </div>

        <div style={fieldWrap}>
          <Select
            data-testid="export-scope"
            label={t("reports.export.scope", locale)}
            value={scope}
            onChange={(e) => onScopeChange(e.target.value as ExportScope)}
            options={EXPORT_SCOPES.map((s) => ({ value: s, label: t(exportScopeLabelKey(s), locale) }))}
          />
        </div>

        <div style={fieldWrap}>
          <Field
            data-testid="export-period"
            type="month"
            label={t("reports.export.period", locale)}
            value={period}
            onChange={(e) => onPeriodChange(e.target.value)}
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

      {/* Job tracking area (states of the flow). */}
      <div style={{ marginTop: "var(--space-5)" }}>
        {phase === "idle" && !offline && (
          <p data-testid="export-empty" style={{ margin: 0, color: "var(--ink-faint)", fontSize: "var(--text-sm)" }}>
            {t("reports.export.empty", locale)}
          </p>
        )}

        {inFlight && (
          <div data-testid="export-loading" aria-busy="true" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <Spinner size="sm" label={t(exportStatusLabelKey(job?.status ?? "PENDING"), locale)} showLabel />
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
          <StateNotice
            testId="export-expired"
            badgeKey="reports.export.state.expired"
            message={t("reports.export.expired", locale)}
            locale={locale}
          />
        )}

        {phase === "failed" && (
          <StateNotice
            testId="export-failed"
            badgeKey="reports.export.state.failed"
            message={t("reports.export.status.failed", locale)}
            locale={locale}
          />
        )}

        {phase === "error" && (
          <StateNotice
            testId="export-error"
            badgeKey="reports.export.state.error"
            message={t("reports.export.error", locale)}
            locale={locale}
          />
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
