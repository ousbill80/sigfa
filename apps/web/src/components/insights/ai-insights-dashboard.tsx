/**
 * AiInsightsDashboard — direction AI insights + COMEX predictive (IA-005).
 *
 * A read-only steering surface for DIRECTOR+/network roles. It renders the four
 * AI insight surfaces (affluence forecast with drivers, advisory staffing,
 * anomalies with evidence, feedback quality with score decomposition) plus a
 * single-screen COMEX predictive synthesis. The component NEVER computes a
 * prediction — everything is derived upstream (ai-insights-state) from the
 * CONTRACT-008 endpoints.
 *
 * Non-negotiable guarantees rendered here:
 *   - `INSUFFICIENT_HISTORY` (422) is a FIRST-CLASS pedagogic view ("X / 90
 *     jours"), never a raw error nor a misleading empty chart.
 *   - `lowConfidence` is flagged visually (warning tone, explicit uncertainty).
 *   - staffing is ADVISORY: an explicit notice, and NO auto-execution control.
 *   - anomalies show their evidence and are visually distinguished from an
 *     instantaneous alert (aggregated-pattern wording); `--danger` is reserved
 *     for genuine risk.
 *   - ZERO PII: only already-expurged, scrubbed views reach the screen.
 *
 * Design System v2 « Sérénité Premium »: chrome from @sigfa/ui, tokens only,
 * FR/EN, zero emoji. The five states (nominal/loading/empty/error/insufficient)
 * plus the discreet offline banner are all covered.
 * @module components/insights/ai-insights-dashboard
 */
"use client";

import type { CSSProperties, ReactElement } from "react";
import { Badge, Card, EmptyState, OfflineBanner, Skeleton } from "@sigfa/ui";
import { t, type Locale, type TranslationKey } from "@/lib/i18n";
import {
  formatConfidence,
  riskColor,
  type AnomalyView,
  type ForecastView,
  type FeedbackInsightsView,
  type ComexPredictiveView,
  type InsufficientHistory,
} from "@/lib/ai-insights-state";
import type { AiInsights } from "@/lib/use-ai-insights";
import type { AiLoad } from "@/lib/ai-insights-state";

/** Props for {@link AiInsightsDashboard}. */
export interface AiInsightsDashboardProps {
  /** The assembled insights (null while loading/error/insufficient/empty). */
  insights: AiInsights | null;
  /** Fetch lifecycle (incl. first-class "insufficient"). */
  load: AiLoad;
  /** First-class INSUFFICIENT_HISTORY progress (present when load="insufficient"). */
  history: InsufficientHistory | null;
  /** Offline flag — discreet banner, surfaces kept visible. */
  offline?: boolean;
  /** Active locale. */
  locale?: Locale;
}

const rootStyle: CSSProperties = {
  padding: "var(--space-6)",
  maxWidth: "1200px",
  margin: "0 auto",
  background: "var(--paper)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-6)",
};

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "var(--text-xl)",
  fontWeight: 600,
  color: "var(--ink)",
  letterSpacing: "var(--tracking-tight)",
  margin: 0,
};

const subtitleStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-sm)",
  color: "var(--ink-soft)",
  margin: 0,
};

const sectionTitleStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--ink-soft)",
  letterSpacing: "0.02em",
  margin: 0,
};

const cardStyle: CSSProperties = {
  padding: "var(--space-6)",
  background: "var(--surface-1)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--r-lg)",
  boxShadow: "var(--shadow-1)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
};

const bigValueStyle: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "var(--text-3xl)",
  fontWeight: 600,
  lineHeight: 1,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "var(--tracking-numeric)",
  color: "var(--ink)",
};

const labelStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-sm)",
  color: "var(--ink-soft)",
};

const advisoryStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-sm)",
  fontWeight: 500,
  color: "var(--info)",
  background: "var(--surface-2)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--r-md)",
  padding: "var(--space-3)",
};

const lowConfStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--warning)",
};

/** i18n key for an anomaly type label. */
function anomalyTypeKey(type: AnomalyView["type"]): TranslationKey {
  return `ai.anomaly.type.${type}` as TranslationKey;
}

/** i18n key for an anomaly status label. */
function anomalyStatusKey(status: AnomalyView["status"]): TranslationKey {
  return `ai.anomaly.status.${status}` as TranslationKey;
}

/** i18n key for a COMEX risk level label. */
function comexLevelKey(level: ComexPredictiveView["level"]): TranslationKey {
  return `ai.comex.level.${level}` as TranslationKey;
}

/** Forecast surface — peak, contextual factors and explainability drivers. */
function ForecastSection({
  forecast,
  locale,
}: {
  forecast: ForecastView;
  locale: Locale;
}): ReactElement {
  return (
    <Card data-testid="ai-forecast" style={cardStyle}>
      <h2 style={sectionTitleStyle}>{t("ai.forecast.title", locale)}</h2>
      <div>
        <span style={labelStyle}>{t("ai.forecast.peak", locale)} — </span>
        <span data-testid="ai-forecast-peak" style={bigValueStyle}>
          {forecast.peakExpected}
        </span>
      </div>

      {forecast.hasLowConfidence && (
        <div data-testid="ai-lowconf-flag" style={lowConfStyle}>
          {t("ai.lowconf.flag", locale)}
        </div>
      )}

      {forecast.factors.length > 0 && (
        <div style={labelStyle}>
          {t("ai.forecast.factors", locale)} : {forecast.factors.join(", ")}
        </div>
      )}

      <div data-testid="ai-forecast-drivers" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
        {forecast.points.flatMap((p) =>
          p.drivers.map((d) => (
            <Badge key={`${p.hour}-${d.factor}`} tone={d.direction === "up" ? "warning" : "info"}>
              {d.factor} · {(d.weight * 100).toFixed(0)}%
            </Badge>
          )),
        )}
      </div>
    </Card>
  );
}

/** Anomalies surface — evidence + status; distinguished from an instant alert. */
function AnomaliesSection({
  anomalies,
  locale,
}: {
  anomalies: AnomalyView[];
  locale: Locale;
}): ReactElement {
  return (
    <Card data-testid="ai-anomalies" style={cardStyle}>
      <h2 style={sectionTitleStyle}>{t("ai.anomalies.title", locale)}</h2>
      <p style={subtitleStyle}>{t("ai.anomalies.subtitle", locale)}</p>
      {anomalies.map((a) => (
        <div
          key={a.id}
          data-testid="ai-anomaly"
          style={{
            borderTop: "1px solid var(--hairline)",
            paddingTop: "var(--space-3)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}
        >
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
            <Badge tone={a.status === "open" ? "warning" : "info"}>
              {t(anomalyTypeKey(a.type), locale)}
            </Badge>
            <Badge tone="info">{t(anomalyStatusKey(a.status), locale)}</Badge>
          </div>
          <div style={labelStyle}>{a.description}</div>
          {a.evidence.length > 0 && (
            <div
              data-testid="ai-anomaly-evidence"
              style={{ ...labelStyle, fontVariantNumeric: "tabular-nums" }}
            >
              {t("ai.anomaly.evidence", locale)} :{" "}
              {a.evidence
                .map(
                  (e) =>
                    `${e.metric} (${t("ai.anomaly.threshold", locale)} ${e.threshold}, ${t(
                      "ai.anomaly.window",
                      locale,
                    )} ${e.window}, ${t("ai.anomaly.sample", locale)} ${e.sample})`,
                )
                .join(" · ")}
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

/** Feedback quality surface — score (withheld if insufficient) + decomposition. */
function FeedbackSection({
  feedback,
  locale,
}: {
  feedback: FeedbackInsightsView;
  locale: Locale;
}): ReactElement {
  return (
    <Card data-testid="ai-feedback" style={cardStyle}>
      <h2 style={sectionTitleStyle}>{t("ai.feedback.title", locale)}</h2>
      {feedback.insufficientSample || feedback.score === null ? (
        <div data-testid="ai-feedback-insufficient" style={lowConfStyle}>
          {t("ai.feedback.insufficient_sample", locale)}
        </div>
      ) : (
        <div>
          <span style={labelStyle}>{t("ai.feedback.score", locale)} — </span>
          <span data-testid="ai-feedback-score" style={bigValueStyle}>
            {feedback.score.toFixed(1)}
            {feedback.scale !== null && <span style={labelStyle}> / {feedback.scale}</span>}
          </span>
        </div>
      )}

      <div style={labelStyle}>
        {t("ai.feedback.sentiment", locale)} : {t("ai.feedback.positive", locale)}{" "}
        {feedback.sentiment.positive}% · {t("ai.feedback.neutral", locale)} {feedback.sentiment.neutral}
        % · {t("ai.feedback.negative", locale)} {feedback.sentiment.negative}%
      </div>

      {feedback.components.length > 0 && (
        <div data-testid="ai-feedback-components" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
          {feedback.components.map((c) => (
            <Badge key={c.key} tone="info">
              {c.key} · {c.value.toFixed(1)}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

/** COMEX predictive synthesis — network anticipation on a single screen. */
function ComexPredictiveSection({
  comex,
  locale,
}: {
  comex: ComexPredictiveView;
  locale: Locale;
}): ReactElement {
  return (
    <Card data-testid="ai-comex-predictive" style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={sectionTitleStyle}>{t("ai.comex.title", locale)}</h2>
        <Badge
          tone={comex.level === "risk" ? "danger" : comex.level === "watch" ? "warning" : "success"}
        >
          {t(comexLevelKey(comex.level), locale)}
        </Badge>
      </div>
      <div style={{ display: "flex", gap: "var(--space-6)", flexWrap: "wrap" }}>
        <div>
          <div style={labelStyle}>{t("ai.comex.expected_load", locale)}</div>
          <div data-testid="ai-comex-load" style={bigValueStyle}>
            {comex.expectedNetworkLoad}
          </div>
        </div>
        <div>
          <div style={labelStyle}>{t("ai.comex.atrisk", locale)}</div>
          <div
            data-testid="ai-comex-atrisk"
            style={{ ...bigValueStyle, color: riskColor(comex.level) }}
          >
            {comex.atRiskCount}
          </div>
        </div>
        <div>
          <div style={labelStyle}>{t("ai.comex.open_anomalies", locale)}</div>
          <div data-testid="ai-comex-open" style={bigValueStyle}>
            {comex.openAnomalies}
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * AI insights dashboard (direction + COMEX predictive).
 * @param props - {@link AiInsightsDashboardProps}.
 * @returns The dashboard element.
 */
export function AiInsightsDashboard({
  insights,
  load,
  history,
  offline = false,
  locale = "fr",
}: AiInsightsDashboardProps): ReactElement {
  if (load === "loading") {
    return (
      <div data-testid="ai-skeleton" aria-busy="true" style={{ padding: "var(--space-6)", background: "var(--paper)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} data-testid="ai-skeleton-card" height="120px" radius="var(--r-lg)" />
          ))}
        </div>
      </div>
    );
  }

  if (load === "insufficient" && history) {
    return (
      <div
        data-testid="ai-insufficient"
        role="status"
        style={{ ...rootStyle, alignItems: "flex-start" }}
      >
        <h1 data-testid="ai-title" style={titleStyle}>
          {t("ai.title", locale)}
        </h1>
        <Card style={{ ...cardStyle, width: "100%" }}>
          <h2 style={sectionTitleStyle}>{t("ai.insufficient.title", locale)}</h2>
          <div style={bigValueStyle}>
            {history.availableDays} / {history.requiredDays}
          </div>
          <div style={labelStyle}>{t("ai.insufficient.progress", locale)}</div>
          {/* Pure token-driven progress bar (no misleading empty chart). */}
          <div
            role="progressbar"
            aria-valuenow={history.availableDays}
            aria-valuemin={0}
            aria-valuemax={history.requiredDays}
            style={{
              height: "8px",
              width: "100%",
              background: "var(--surface-2)",
              borderRadius: "var(--r-full)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.round(history.progress * 100)}%`,
                background: "var(--brand)",
              }}
            />
          </div>
          <p style={subtitleStyle}>{t("ai.insufficient.hint", locale)}</p>
        </Card>
      </div>
    );
  }

  if (load === "error" || (load !== "empty" && insights === null)) {
    return (
      <div data-testid="ai-error" role="alert" style={{ padding: "var(--space-6)" }}>
        <EmptyState title={t("ai.title", locale)} description={t("ai.state.error", locale)} />
      </div>
    );
  }

  if (load === "empty" || insights === null) {
    return (
      <div data-testid="ai-empty" style={{ padding: "var(--space-6)" }}>
        <EmptyState title={t("ai.title", locale)} description={t("ai.state.empty", locale)} />
      </div>
    );
  }

  return (
    <div data-testid="ai-insights-dashboard" style={rootStyle}>
      <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <h1 data-testid="ai-title" style={titleStyle}>
          {t("ai.title", locale)}
        </h1>
        <p style={subtitleStyle}>{t("ai.subtitle", locale)}</p>
      </header>

      {offline && (
        <div style={{ marginBottom: "var(--space-2)" }}>
          <OfflineBanner data-testid="ai-offline-banner" message={t("ai.state.offline", locale)} />
        </div>
      )}

      {/* COMEX predictive synthesis — ≤ 1 screen, at the top for the direction. */}
      <ComexPredictiveSection comex={insights.comex} locale={locale} />

      <ForecastSection forecast={insights.forecast} locale={locale} />

      {/* Advisory staffing notice — read-only, NO auto-execution control. */}
      <Card data-testid="ai-staffing" style={cardStyle}>
        <h2 style={sectionTitleStyle}>{t("ai.staffing.title", locale)}</h2>
        <div data-testid="ai-advisory-notice" style={advisoryStyle}>
          {t("ai.advisory.notice", locale)}
        </div>
      </Card>

      <AnomaliesSection anomalies={insights.anomalies} locale={locale} />

      <FeedbackSection feedback={insights.feedback} locale={locale} />
    </div>
  );
}
