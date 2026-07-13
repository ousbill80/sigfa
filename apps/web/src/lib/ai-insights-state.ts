/**
 * AI insights state model (IA-005).
 *
 * Pure, framework-free derivation of the direction insights surface and the
 * COMEX predictive block from the CONTRACT-008 AI endpoints (`/ai/forecast`,
 * `/ai/anomalies`, `/ai/feedback-insights`). The front NEVER models or scores:
 * it reads the typed responses and *explains* them (drivers / evidence / score
 * decomposition).
 *
 * Guarantees enforced here (garde-fous IA-005) :
 *   - `INSUFFICIENT_HISTORY` (422) is parsed into a FIRST-CLASS pedagogic state
 *     ("X / 90 jours"), never a raw error — {@link parseInsufficientHistory}.
 *   - `lowConfidence` is surfaced explicitly — {@link isLowConfidence}.
 *   - ZERO PII: identifiers (agent/agency/service UUIDs, `ackedBy`) are never
 *     surfaced; anomaly descriptions are scrubbed of raw UUIDs
 *     — {@link scrubPii}.
 *   - staffing recommendations stay ADVISORY (read-only) — this module exposes
 *     no execution affordance.
 *
 * @module lib/ai-insights-state
 */

/** Minimum history (days) required by every AI endpoint before it predicts. */
export const REQUIRED_HISTORY_DAYS = 90 as const;

/** Confidence below which a forecast point is flagged low-confidence (IA-002). */
export const LOW_CONFIDENCE_THRESHOLD = 0.5 as const;

/** Minimum feedback sample below which a quality score is not published (IA-004). */
export const INSUFFICIENT_SAMPLE_THRESHOLD = 30 as const;

/** Lifecycle of a single AI surface fetch. */
export type AiLoad = "loading" | "ready" | "empty" | "error" | "insufficient";

/** Connection status driving the offline banner. */
export type AiConnection = "connected" | "offline";

// ─── INSUFFICIENT_HISTORY (422) — first-class pedagogic state ──────────────────

/** Parsed pedagogic "X / 90 days" progress derived from a 422 response. */
export interface InsufficientHistory {
  /** Days of history required (always {@link REQUIRED_HISTORY_DAYS} per contract). */
  requiredDays: number;
  /** Days of history actually available so far. */
  availableDays: number;
  /** Progress ratio 0..1 (availableDays / requiredDays, clamped). */
  progress: number;
}

/** Shape of the contract ErrorResponse body (defensively typed). */
interface ErrorBodyLike {
  error?: {
    code?: unknown;
    details?: { requiredDays?: unknown; availableDays?: unknown } | unknown;
  };
}

/**
 * Parses a contract 422 body into a first-class {@link InsufficientHistory}.
 * Returns null when the body is not an `INSUFFICIENT_HISTORY` error, so callers
 * fall back to the neutral error state only for genuine technical failures.
 * @param body - The raw response body (unknown shape).
 * @returns The parsed progress, or null.
 */
export function parseInsufficientHistory(body: unknown): InsufficientHistory | null {
  const err = (body as ErrorBodyLike | null | undefined)?.error;
  if (!err || err.code !== "INSUFFICIENT_HISTORY") return null;

  const details = (err.details ?? {}) as { requiredDays?: unknown; availableDays?: unknown };
  const requiredDays =
    typeof details.requiredDays === "number" ? details.requiredDays : REQUIRED_HISTORY_DAYS;
  const availableDays = typeof details.availableDays === "number" ? details.availableDays : 0;

  const clampedAvailable = Math.max(0, Math.min(availableDays, requiredDays));
  const progress = requiredDays > 0 ? clampedAvailable / requiredDays : 0;

  return { requiredDays, availableDays: clampedAvailable, progress };
}

// ─── lowConfidence (IA-002) ────────────────────────────────────────────────────

/** A forecast confidence carrier (contract `ForecastHour`, defensively typed). */
export interface ConfidenceCarrier {
  /** Confidence index 0..1. */
  confidence?: number;
  /** Explicit low-confidence marker (additif CONTRACT-013). */
  lowConfidence?: boolean;
}

/**
 * Whether a forecast point should be visually flagged as low-confidence.
 * Trusts the contract's explicit `lowConfidence` marker first, then falls back
 * to `confidence < 0.5` (IA-002 rule) — never presents an uncertain point as
 * certain.
 * @param point - The confidence carrier.
 * @returns true when the point is low-confidence.
 */
export function isLowConfidence(point: ConfidenceCarrier): boolean {
  if (point.lowConfidence === true) return true;
  return typeof point.confidence === "number" && point.confidence < LOW_CONFIDENCE_THRESHOLD;
}

/**
 * Formats a confidence index (0..1) as a percentage integer string.
 * @param confidence - Confidence 0..1.
 * @returns e.g. "87 %".
 */
export function formatConfidence(confidence: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  return `${pct} %`;
}

// ─── ZERO PII scrubbing ────────────────────────────────────────────────────────

/** Matches a raw UUID anywhere in a string (v4-ish, tolerant). */
const UUID_RE =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/**
 * Removes any raw UUID from a human string so no agent/agency/service
 * identifier ever reaches the screen. The IA layer already expurges PII
 * (IA-004); this is defence in depth for free-text descriptions.
 * @param text - The raw text.
 * @returns The text with UUIDs replaced by a neutral placeholder.
 */
export function scrubPii(text: string): string {
  return text.replace(UUID_RE, "—").replace(/\s+—/g, " —").trim();
}

// ─── Forecast (affluence J/J+7) ────────────────────────────────────────────────

/** A contextual factor label token (contract `ContextualFactor`). */
export type ContextualFactor =
  | "END_OF_MONTH"
  | "CIVIL_SERVICE_PAY"
  | "PUBLIC_HOLIDAY"
  | "SCHOOL_START"
  | "NONE";

/** A single explainability driver (contract `ForecastDriver`). */
export interface ForecastDriverView {
  /** Driver factor name (already free of PII). */
  factor: string;
  /** Contribution direction. */
  direction: "up" | "down";
  /** Relative weight 0..1. */
  weight: number;
}

/** A derived forecast hour ready for the view. */
export interface ForecastPointView {
  /** Hour label (HH:MM). */
  hour: string;
  /** Expected tickets. */
  expectedTickets: number;
  /** Confidence 0..1. */
  confidence: number;
  /** Whether the point is low-confidence (explicit uncertainty). */
  lowConfidence: boolean;
  /** Explainability drivers (may be empty). */
  drivers: ForecastDriverView[];
}

/** The derived forecast surface. */
export interface ForecastView {
  /** Hourly points. */
  points: ForecastPointView[];
  /** Contextual factors detected (NONE filtered out for display). */
  factors: ContextualFactor[];
  /** Peak expected tickets across the day (0 when empty). */
  peakExpected: number;
  /** Whether ANY point is low-confidence (drives the surface-level badge). */
  hasLowConfidence: boolean;
}

/** Raw forecast response subset consumed here (defensively typed). */
interface RawForecast {
  forecast?: unknown;
  contextualFactors?: unknown;
}

/** Coerces a raw driver into a typed {@link ForecastDriverView}, or null. */
function toDriver(raw: unknown): ForecastDriverView | null {
  const d = raw as { factor?: unknown; direction?: unknown; weight?: unknown } | null;
  if (!d || typeof d.factor !== "string") return null;
  const direction = d.direction === "down" ? "down" : "up";
  const weight = typeof d.weight === "number" ? d.weight : 0;
  return { factor: scrubPii(d.factor), direction, weight };
}

/**
 * Derives the forecast surface from a `/ai/forecast` 200 body.
 * NONE factors are dropped from the display list (they carry no signal).
 * @param body - The raw forecast response.
 * @returns The derived {@link ForecastView}.
 */
export function deriveForecast(body: unknown): ForecastView {
  const raw = (body ?? {}) as RawForecast;
  const rawPoints = Array.isArray(raw.forecast) ? raw.forecast : [];

  const points: ForecastPointView[] = rawPoints.map((p) => {
    const pt = p as {
      hour?: unknown;
      expectedTickets?: unknown;
      confidence?: unknown;
      drivers?: unknown;
      lowConfidence?: unknown;
    };
    const confidence = typeof pt.confidence === "number" ? pt.confidence : 0;
    const drivers = Array.isArray(pt.drivers)
      ? pt.drivers.map(toDriver).filter((d): d is ForecastDriverView => d !== null)
      : [];
    return {
      hour: typeof pt.hour === "string" ? pt.hour : "",
      expectedTickets: typeof pt.expectedTickets === "number" ? pt.expectedTickets : 0,
      confidence,
      lowConfidence: isLowConfidence({
        confidence,
        lowConfidence: pt.lowConfidence === true,
      }),
      drivers,
    };
  });

  const rawFactors = Array.isArray(raw.contextualFactors) ? raw.contextualFactors : [];
  const factors = rawFactors.filter(
    (f): f is ContextualFactor => typeof f === "string" && f !== "NONE",
  ) as ContextualFactor[];

  const peakExpected = points.reduce((max, p) => Math.max(max, p.expectedTickets), 0);
  const hasLowConfidence = points.some((p) => p.lowConfidence);

  return { points, factors, peakExpected, hasLowConfidence };
}

// ─── Anomalies (evidence) ──────────────────────────────────────────────────────

/** Anomaly type token (contract `AnomalyType`). */
export type AnomalyType = "QUEUE_STUCK" | "AGENT_INACTIVE_PATTERN" | "SLA_SYSTEMIC";

/** Anomaly status token (contract `AnomalyStatus`). */
export type AnomalyStatus = "open" | "acked" | "resolved";

/** A single evidence row (contract `AnomalyEvidence`). */
export interface AnomalyEvidenceView {
  /** Observed metric. */
  metric: string;
  /** Threshold crossed. */
  threshold: number;
  /** Observation window (e.g. "7d"). */
  window: string;
  /** Sample size. */
  sample: number;
}

/** A derived anomaly ready for the view (PII-free). */
export interface AnomalyView {
  /** Anomaly id (opaque, non-PII). */
  id: string;
  /** Anomaly type. */
  type: AnomalyType;
  /** Lifecycle status. */
  status: AnomalyStatus;
  /** Human description, scrubbed of any raw UUID. */
  description: string;
  /** Structured evidence (may be empty). */
  evidence: AnomalyEvidenceView[];
}

/** Coerces a raw evidence entry, or null. */
function toEvidence(raw: unknown): AnomalyEvidenceView | null {
  const e = raw as { metric?: unknown; threshold?: unknown; window?: unknown; sample?: unknown } | null;
  if (!e || typeof e.metric !== "string") return null;
  return {
    metric: e.metric,
    threshold: typeof e.threshold === "number" ? e.threshold : 0,
    window: typeof e.window === "string" ? e.window : "",
    sample: typeof e.sample === "number" ? e.sample : 0,
  };
}

const ANOMALY_TYPES: readonly AnomalyType[] = [
  "QUEUE_STUCK",
  "AGENT_INACTIVE_PATTERN",
  "SLA_SYSTEMIC",
];
const ANOMALY_STATUSES: readonly AnomalyStatus[] = ["open", "acked", "resolved"];

/**
 * Derives the anomaly list from a `/ai/anomalies` 200 body.
 * Descriptions are scrubbed of raw UUIDs (ZERO PII). Unknown types/statuses are
 * dropped rather than displayed as-is.
 * @param body - The raw anomalies list response.
 * @returns The derived, PII-free anomaly views.
 */
export function deriveAnomalies(body: unknown): AnomalyView[] {
  const raw = (body as { data?: unknown } | null | undefined)?.data;
  const list = Array.isArray(raw) ? raw : [];

  const views: AnomalyView[] = [];
  for (const item of list) {
    const a = item as {
      id?: unknown;
      type?: unknown;
      status?: unknown;
      description?: unknown;
      evidence?: unknown;
    };
    if (typeof a.id !== "string") continue;
    if (!ANOMALY_TYPES.includes(a.type as AnomalyType)) continue;
    if (!ANOMALY_STATUSES.includes(a.status as AnomalyStatus)) continue;

    const evidence = Array.isArray(a.evidence)
      ? a.evidence.map(toEvidence).filter((e): e is AnomalyEvidenceView => e !== null)
      : [];

    views.push({
      id: a.id,
      type: a.type as AnomalyType,
      status: a.status as AnomalyStatus,
      description: scrubPii(typeof a.description === "string" ? a.description : ""),
      evidence,
    });
  }
  return views;
}

// ─── Feedback insights (quality scores) ────────────────────────────────────────

/** Sentiment split (contract `SentimentBreakdown`). */
export interface SentimentView {
  positive: number;
  neutral: number;
  negative: number;
}

/** A quality score decomposition component (contract `QualityScoreComponent`). */
export interface QualityComponentView {
  key: string;
  value: number;
}

/** The derived feedback-insights surface. */
export interface FeedbackInsightsView {
  /** Number of feedbacks analysed on the period. */
  feedbackCount: number;
  /** Sentiment split. */
  sentiment: SentimentView;
  /** Agency quality score value, null when not published. */
  score: number | null;
  /** Score scale (e.g. 5), null when no score. */
  scale: number | null;
  /** Score decomposition (explainability). */
  components: QualityComponentView[];
  /** true when the sample is below the publication threshold (INSUFFICIENT_SAMPLE). */
  insufficientSample: boolean;
}

/**
 * Derives the feedback-insights surface from a `/ai/feedback-insights` 200 body.
 * When the sample is insufficient, the score is withheld (null) rather than
 * shown as a misleading value.
 * @param body - The raw feedback-insights response.
 * @returns The derived {@link FeedbackInsightsView}.
 */
export function deriveFeedbackInsights(body: unknown): FeedbackInsightsView {
  const raw = (body ?? {}) as {
    feedbackCount?: unknown;
    sentimentBreakdown?: { positive?: unknown; neutral?: unknown; negative?: unknown };
    qualityScores?: { agency?: unknown };
    insufficientSample?: unknown;
  };

  const sb = raw.sentimentBreakdown ?? {};
  const sentiment: SentimentView = {
    positive: typeof sb.positive === "number" ? sb.positive : 0,
    neutral: typeof sb.neutral === "number" ? sb.neutral : 0,
    negative: typeof sb.negative === "number" ? sb.negative : 0,
  };

  const agency = raw.qualityScores?.agency as
    | { score?: unknown; scale?: unknown; components?: unknown; insufficientSample?: unknown }
    | undefined;

  const feedbackCount = typeof raw.feedbackCount === "number" ? raw.feedbackCount : 0;
  const sampleFlag =
    raw.insufficientSample === true ||
    agency?.insufficientSample === true ||
    feedbackCount < INSUFFICIENT_SAMPLE_THRESHOLD;

  const components: QualityComponentView[] = Array.isArray(agency?.components)
    ? (agency.components as unknown[])
        .map((c) => {
          const comp = c as { key?: unknown; value?: unknown };
          if (typeof comp.key !== "string") return null;
          return { key: comp.key, value: typeof comp.value === "number" ? comp.value : 0 };
        })
        .filter((c): c is QualityComponentView => c !== null)
    : [];

  const score =
    !sampleFlag && agency && typeof agency.score === "number" ? agency.score : null;
  const scale = score !== null && agency && typeof agency.scale === "number" ? agency.scale : null;

  return {
    feedbackCount,
    sentiment,
    score,
    scale,
    components,
    insufficientSample: sampleFlag,
  };
}

// ─── COMEX predictive block (≤ 1 écran) ────────────────────────────────────────

/** Risk tier of a COMEX row — derives colour but `--danger` only for real risk. */
export type RiskLevel = "ok" | "watch" | "risk";

/** The COMEX predictive synthesis (network anticipation, ≤ 1 screen). */
export interface ComexPredictiveView {
  /** Expected network load (sum of peak expected tickets across agencies). */
  expectedNetworkLoad: number;
  /** Count of agencies flagged at risk (open anomalies present). */
  atRiskCount: number;
  /** Total open anomalies across the network. */
  openAnomalies: number;
  /** Overall network risk level. */
  level: RiskLevel;
}

/**
 * Derives the overall network risk level from open anomalies and low-confidence
 * signals. `--danger` (mapped from "risk") is reserved for genuine risk (≥1
 * open anomaly). Low-confidence alone is a "watch", never a red alert.
 * @param openAnomalies - Number of open anomalies.
 * @param hasLowConfidence - Whether the forecast carries low-confidence points.
 * @returns The risk level.
 */
export function deriveRiskLevel(openAnomalies: number, hasLowConfidence: boolean): RiskLevel {
  if (openAnomalies > 0) return "risk";
  if (hasLowConfidence) return "watch";
  return "ok";
}

/**
 * Assembles the COMEX predictive synthesis from the already-derived forecast and
 * anomaly views. Kept to network-level aggregates (≤ 1 screen, zero PII).
 * @param forecast - Derived forecast view.
 * @param anomalies - Derived anomaly views.
 * @returns The {@link ComexPredictiveView}.
 */
export function deriveComexPredictive(
  forecast: ForecastView,
  anomalies: AnomalyView[],
): ComexPredictiveView {
  const openAnomalies = anomalies.filter((a) => a.status === "open").length;
  return {
    expectedNetworkLoad: forecast.peakExpected,
    atRiskCount: openAnomalies > 0 ? 1 : 0,
    openAnomalies,
    level: deriveRiskLevel(openAnomalies, forecast.hasLowConfidence),
  };
}

/** Maps a risk level to a Design-System status colour token. */
export function riskColor(level: RiskLevel): string {
  switch (level) {
    case "risk":
      return "var(--danger)";
    case "watch":
      return "var(--warning)";
    default:
      return "var(--success)";
  }
}
