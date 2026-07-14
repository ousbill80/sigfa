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
 *   - `INSUFFICIENT_HISTORY` (422) is a FIRST-CLASS pedagogic view (`Heading` +
 *     "X / 90 jours", reassuring tone), never a raw error nor a misleading empty
 *     chart.
 *   - `lowConfidence` is flagged as a `--warning-soft` banner with a paired icon.
 *   - staffing is ADVISORY: an explicit notice, and NO auto-execution control.
 *   - anomalies show STRUCTURED evidence (label/value pairs) and a NEUTRAL type
 *     badge; only the STATUS carries tone. `--danger` is never used as a fill.
 *   - the COMEX "agencies at risk" figure is `--ink` (no danger tint on the big
 *     number, DS §1); the risk is carried by a bordered `Badge` next to it.
 *   - ZERO PII: only already-expurged, scrubbed views reach the screen.
 *
 * Design System v2 « Sérénité Premium »: chrome from @sigfa/ui (KpiTile /
 * SectionTitle / Badge / Spinner), tokens only, FR/EN, zero emoji. The five
 * states (nominal/loading/empty/error/insufficient) plus the discreet offline
 * banner are all covered.
 * @module components/insights/ai-insights-dashboard
 */
"use client";

import type { CSSProperties, ReactElement } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Heading,
  IconAlerte,
  KpiTile,
  OfflineBanner,
  SectionTitle,
  Spinner,
} from "@sigfa/ui";
import { t, type Locale, type TranslationKey } from "@/lib/i18n";
import {
  aggregateDrivers,
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
  /** Optional retry handler for the dedicated error state. */
  onRetry?: () => void;
}

/** Max number of drivers shown before collapsing into "+N autres". */
const MAX_DRIVERS = 5;

const rootStyle: CSSProperties = {
  padding: "var(--space-6)",
  maxWidth: "1200px",
  margin: "0 auto",
  background: "var(--paper)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-6)",
};

const subtitleStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-sm)",
  color: "var(--ink-soft)",
  margin: 0,
};

const cardStyle: CSSProperties = {
  padding: "var(--space-6)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
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

/** A single aggregated driver row — factor + tone badge + weight mini-bar. */
function DriverRow({
  factor,
  direction,
  weight,
}: {
  factor: string;
  direction: "up" | "down";
  weight: number;
}): ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
      <span style={{ minWidth: "9rem", ...labelStyle, color: "var(--ink)", fontWeight: 500 }}>
        {factor}
      </span>
      <span
        aria-hidden="true"
        style={{
          flex: "1 1 auto",
          height: "6px",
          borderRadius: "var(--r-full)",
          background: "var(--surface-2)",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${Math.round(weight * 100)}%`,
            background: direction === "up" ? "var(--warning)" : "var(--info)",
          }}
        />
      </span>
      <span
        style={{
          minWidth: "3rem",
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          ...labelStyle,
        }}
      >
        {(weight * 100).toFixed(0)}%
      </span>
    </div>
  );
}

/** Forecast surface — peak (KpiTile), context, and de-cluttered top drivers. */
function ForecastSection({
  forecast,
  locale,
}: {
  forecast: ForecastView;
  locale: Locale;
}): ReactElement {
  const drivers = aggregateDrivers(forecast.points);
  const shown = drivers.slice(0, MAX_DRIVERS);
  const rest = drivers.length - shown.length;
  return (
    <Card data-testid="ai-forecast" style={cardStyle}>
      <SectionTitle>{t("ai.forecast.title", locale)}</SectionTitle>
      <KpiTile
        data-testid="ai-forecast-peak"
        label={t("ai.forecast.peak", locale)}
        value={String(forecast.peakExpected)}
      />

      {forecast.hasLowConfidence && (
        <div
          data-testid="ai-lowconf-flag"
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "var(--space-3)",
            borderRadius: "var(--r-md)",
            background: "var(--warning-soft)",
            border: "1px solid var(--warning)",
            color: "var(--warning)",
            fontSize: "var(--text-sm)",
            fontWeight: 600,
          }}
        >
          <IconAlerte size={18} />
          {t("ai.lowconf.flag", locale)}
        </div>
      )}

      {forecast.factors.length > 0 && (
        <div style={labelStyle}>
          {t("ai.forecast.factors", locale)} : {forecast.factors.join(", ")}
        </div>
      )}

      {shown.length > 0 && (
        <div data-testid="ai-forecast-drivers" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span style={{ ...labelStyle, fontWeight: 600, color: "var(--ink)" }}>
            {t("ai.forecast.drivers", locale)}
          </span>
          {shown.map((d) => (
            <DriverRow key={d.factor} factor={d.factor} direction={d.direction} weight={d.weight} />
          ))}
          {rest > 0 && (
            <span data-testid="ai-drivers-more" style={labelStyle}>
              + {rest} {t("ai.drivers.others", locale)}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

/** Anomalies surface — structured evidence + status; distinct from an instant alert. */
function AnomaliesSection({
  anomalies,
  locale,
}: {
  anomalies: AnomalyView[];
  locale: Locale;
}): ReactElement {
  return (
    <Card data-testid="ai-anomalies" style={cardStyle}>
      <SectionTitle>{t("ai.anomalies.title", locale)}</SectionTitle>
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
            {/* Type is NEUTRAL (info); only the STATUS carries tone. */}
            <Badge tone="info">{t(anomalyTypeKey(a.type), locale)}</Badge>
            <Badge tone={a.status === "open" ? "warning" : "success"} dot>
              {t(anomalyStatusKey(a.status), locale)}
            </Badge>
          </div>
          <div style={labelStyle}>{a.description}</div>
          {a.evidence.length > 0 && (
            <dl
              data-testid="ai-anomaly-evidence"
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                columnGap: "var(--space-4)",
                rowGap: "var(--space-1)",
                margin: 0,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {a.evidence.flatMap((e, idx) => [
                <dt key={`m-${idx}`} style={{ ...labelStyle }}>
                  {t("ai.anomaly.metric", locale)}
                </dt>,
                <dd key={`mv-${idx}`} style={{ margin: 0, color: "var(--ink)", fontWeight: 500 }}>
                  {e.metric}
                </dd>,
                <dt key={`t-${idx}`} style={{ ...labelStyle }}>
                  {t("ai.anomaly.threshold", locale)}
                </dt>,
                <dd key={`tv-${idx}`} style={{ margin: 0, color: "var(--ink)" }}>
                  {e.threshold}
                </dd>,
                <dt key={`w-${idx}`} style={{ ...labelStyle }}>
                  {t("ai.anomaly.window", locale)}
                </dt>,
                <dd key={`wv-${idx}`} style={{ margin: 0, color: "var(--ink)" }}>
                  {e.window}
                </dd>,
                <dt key={`s-${idx}`} style={{ ...labelStyle }}>
                  {t("ai.anomaly.sample", locale)}
                </dt>,
                <dd key={`sv-${idx}`} style={{ margin: 0, color: "var(--ink)" }}>
                  {e.sample}
                </dd>,
              ])}
            </dl>
          )}
        </div>
      ))}
    </Card>
  );
}

/** Feedback quality surface — score (KpiTile, withheld if insufficient) + decomposition. */
function FeedbackSection({
  feedback,
  locale,
}: {
  feedback: FeedbackInsightsView;
  locale: Locale;
}): ReactElement {
  return (
    <Card data-testid="ai-feedback" style={cardStyle}>
      <SectionTitle>{t("ai.feedback.title", locale)}</SectionTitle>
      {feedback.insufficientSample || feedback.score === null ? (
        <div
          data-testid="ai-feedback-insufficient"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            color: "var(--warning)",
            fontSize: "var(--text-sm)",
            fontWeight: 600,
          }}
        >
          <IconAlerte size={18} />
          {t("ai.feedback.insufficient_sample", locale)}
        </div>
      ) : (
        <KpiTile
          data-testid="ai-feedback-score"
          label={t("ai.feedback.score", locale)}
          value={`${feedback.score.toFixed(1)}${feedback.scale !== null ? ` / ${feedback.scale}` : ""}`}
        />
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
  const atRisk = comex.level === "risk";
  return (
    <Card data-testid="ai-comex-predictive" style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)" }}>
        <SectionTitle size="xl">{t("ai.comex.title", locale)}</SectionTitle>
        <Badge tone={atRisk ? "danger" : comex.level === "watch" ? "warning" : "success"} dot>
          {t(comexLevelKey(comex.level), locale)}
        </Badge>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "var(--space-4)",
        }}
      >
        <KpiTile
          data-testid="ai-comex-load"
          label={t("ai.comex.expected_load", locale)}
          value={String(comex.expectedNetworkLoad)}
        />
        {/* Big number stays --ink (KpiTile); the risk is carried by a bordered Badge. */}
        <div data-testid="ai-comex-atrisk" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <KpiTile label={t("ai.comex.atrisk", locale)} value={String(comex.atRiskCount)} />
          {atRisk && (
            <span>
              <Badge tone="danger" dot>
                {t("ai.forecast.risk", locale)}
              </Badge>
            </span>
          )}
        </div>
        <KpiTile
          data-testid="ai-comex-open"
          label={t("ai.comex.open_anomalies", locale)}
          value={String(comex.openAnomalies)}
        />
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
  onRetry,
}: AiInsightsDashboardProps): ReactElement {
  if (load === "loading") {
    return (
      <div data-testid="ai-skeleton" aria-busy="true" style={{ padding: "var(--space-6)", background: "var(--paper)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", alignItems: "center", padding: "var(--space-8)" }}>
          <Spinner size="lg" label={t("ai.state.loading", locale)} showLabel />
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
        <Heading size="2xl">{t("ai.insufficient.title", locale)}</Heading>
        <Card style={{ ...cardStyle, width: "100%" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "var(--space-2)",
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              color: "var(--ink)",
            }}
          >
            <span style={{ fontSize: "var(--text-4xl)", fontVariantNumeric: "tabular-nums" }}>
              {history.availableDays}
            </span>
            <span style={{ fontSize: "var(--text-xl)", color: "var(--ink-soft)" }}>
              / {history.requiredDays} {t("ai.insufficient.days", locale)}
            </span>
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
        <EmptyState
          icon={<IconAlerte size={18} />}
          title={t("ai.state.error.title", locale)}
          description={t("ai.state.error", locale)}
          action={
            onRetry ? (
              <Button variant="secondary" size="dense" data-testid="ai-retry" onClick={onRetry}>
                {t("ai.state.retry", locale)}
              </Button>
            ) : undefined
          }
        />
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
        <Heading data-testid="ai-title" size="3xl">
          {t("ai.title", locale)}
        </Heading>
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
        <SectionTitle>{t("ai.staffing.title", locale)}</SectionTitle>
        <div data-testid="ai-advisory-notice" style={advisoryStyle}>
          {t("ai.advisory.notice", locale)}
        </div>
      </Card>

      <AnomaliesSection anomalies={insights.anomalies} locale={locale} />

      <FeedbackSection feedback={insights.feedback} locale={locale} />
    </div>
  );
}
