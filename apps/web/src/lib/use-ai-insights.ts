/**
 * useAiInsights — direction AI insights + COMEX predictive workflow (IA-005).
 *
 * Consumes ONLY the CONTRACT-008 AI endpoints through the typed @sigfa/contracts
 * `ai` client (mock Prism in dev, real API in F5/RT via env — no code change):
 *   - GET /ai/forecast?agencyId&date            (affluence + drivers)
 *   - GET /ai/anomalies?status=open             (evidence)
 *   - GET /ai/feedback-insights?period&scope    (quality scores)
 * The front NEVER models or scores; it fetches, derives (ai-insights-state) and
 * explains. No `/ai/staffing-recommendations` mutation is issued here (advisory
 * only — acknowledgement is a separate, human, explicit action out of scope for
 * the read-only insights surface).
 *
 * `422 INSUFFICIENT_HISTORY` on ANY endpoint is a FIRST-CLASS state (`load =
 * "insufficient"`), never a raw error. A genuine failure → `load = "error"`.
 * @module lib/use-ai-insights
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import {
  parseInsufficientHistory,
  deriveForecast,
  deriveAnomalies,
  deriveFeedbackInsights,
  deriveComexPredictive,
  type AiLoad,
  type AiConnection,
  type InsufficientHistory,
  type ForecastView,
  type AnomalyView,
  type FeedbackInsightsView,
  type ComexPredictiveView,
} from "./ai-insights-state";

/** Typed AI client (CONTRACT-008 endpoints). */
export type AiClient = ReturnType<typeof createSigfaClient<"ai">>;

/** The assembled insights model (null until a successful fetch). */
export interface AiInsights {
  /** Affluence forecast + drivers. */
  forecast: ForecastView;
  /** Open anomalies + evidence. */
  anomalies: AnomalyView[];
  /** Feedback quality insights. */
  feedback: FeedbackInsightsView;
  /** COMEX predictive synthesis (network anticipation, ≤ 1 screen). */
  comex: ComexPredictiveView;
}

/** Options for {@link useAiInsights}. */
export interface UseAiInsightsOptions {
  /** Typed AI client. */
  ai: AiClient;
  /** Agency scope (UUID) for forecast/anomalies. */
  agencyId: string;
  /** Forecast date (YYYY-MM-DD). */
  date: string;
  /** Feedback analysis period (e.g. "2026-07"). */
  period: string;
}

/** Result of {@link useAiInsights}. */
export interface UseAiInsightsResult {
  /** The assembled insights (null while loading / error / insufficient). */
  insights: AiInsights | null;
  /** Fetch lifecycle (incl. first-class "insufficient"). */
  load: AiLoad;
  /** First-class INSUFFICIENT_HISTORY progress (present when load="insufficient"). */
  history: InsufficientHistory | null;
  /** Connection status (offline banner). */
  connection: AiConnection;
  /** Fetches the three AI surfaces from the contract endpoints. */
  refresh: () => Promise<void>;
  /** Sets connection status (offline banner / resync). */
  setConnection: (status: AiConnection) => void;
}

/** A single endpoint outcome: ok data, an insufficient-history marker, or error. */
type Outcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "insufficient"; history: InsufficientHistory }
  | { kind: "error" };

/** Wraps an openapi-fetch result into an {@link Outcome}, mapping 422 first-class. */
function toOutcome<T>(res: { data?: T; error?: unknown }): Outcome<T> {
  if (res.data) return { kind: "ok", data: res.data };
  const history = parseInsufficientHistory(res.error);
  if (history) return { kind: "insufficient", history };
  return { kind: "error" };
}

/**
 * Direction AI insights hook.
 * @param options - {@link UseAiInsightsOptions}.
 * @returns {@link UseAiInsightsResult}.
 */
export function useAiInsights(options: UseAiInsightsOptions): UseAiInsightsResult {
  const { ai, agencyId, date, period } = options;
  const [insights, setInsights] = useState<AiInsights | null>(null);
  const [load, setLoad] = useState<AiLoad>("loading");
  const [history, setHistory] = useState<InsufficientHistory | null>(null);
  const [connection, setConnectionState] = useState<AiConnection>("connected");

  const refresh = useCallback(async (): Promise<void> => {
    setLoad("loading");
    setHistory(null);
    try {
      const [forecastRes, anomaliesRes, feedbackRes] = await Promise.all([
        ai.GET("/ai/forecast", { params: { query: { agencyId, date } } }),
        ai.GET("/ai/anomalies", { params: { query: { status: "open", agencyId } } }),
        ai.GET("/ai/feedback-insights", { params: { query: { period, scope: "agency", agencyId } } }),
      ]);

      const forecastOut = toOutcome(forecastRes);
      const anomaliesOut = toOutcome(anomaliesRes);
      const feedbackOut = toOutcome(feedbackRes);

      // INSUFFICIENT_HISTORY on ANY endpoint → first-class pedagogic state.
      const firstInsufficient = [forecastOut, anomaliesOut, feedbackOut].find(
        (o): o is { kind: "insufficient"; history: InsufficientHistory } =>
          o.kind === "insufficient",
      );
      if (firstInsufficient) {
        setHistory(firstInsufficient.history);
        setLoad("insufficient");
        return;
      }

      // A genuine failure on any endpoint → neutral error state.
      if (
        forecastOut.kind !== "ok" ||
        anomaliesOut.kind !== "ok" ||
        feedbackOut.kind !== "ok"
      ) {
        setLoad("error");
        return;
      }

      const forecast = deriveForecast(forecastOut.data);
      const anomalies = deriveAnomalies(anomaliesOut.data);
      const feedback = deriveFeedbackInsights(feedbackOut.data);
      const comex = deriveComexPredictive(forecast, anomalies);

      const empty =
        forecast.points.length === 0 &&
        anomalies.length === 0 &&
        feedback.feedbackCount === 0;

      setInsights({ forecast, anomalies, feedback, comex });
      setLoad(empty ? "empty" : "ready");
    } catch {
      setLoad("error");
    }
  }, [ai, agencyId, date, period]);

  const setConnection = useCallback((status: AiConnection): void => {
    setConnectionState(status);
  }, []);

  return useMemo(
    () => ({ insights, load, history, connection, refresh, setConnection }),
    [insights, load, history, connection, refresh, setConnection],
  );
}
