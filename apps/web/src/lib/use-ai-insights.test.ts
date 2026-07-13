/**
 * Tests for useAiInsights (IA-005) — consumes ONLY CONTRACT-008 AI endpoints.
 *
 * Verifies GET /ai/forecast + /ai/anomalies + /ai/feedback-insights are called
 * (and that no rejected route is invented), the 5 states incl. the first-class
 * INSUFFICIENT_HISTORY (422), and that no client-side prediction is computed.
 * @module lib/use-ai-insights.test
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { createSigfaClient } from "@sigfa/contracts";
import { useAiInsights } from "./use-ai-insights";

const BASE = "http://localhost:4010";
const AGENCY = "33333333-3333-4333-a333-333333333333";

const forecastBody = {
  agencyId: AGENCY,
  date: "2026-07-15",
  contextualFactors: ["END_OF_MONTH"],
  forecast: [
    {
      hour: "10:00",
      expectedTickets: 38,
      confidence: 0.89,
      drivers: [{ factor: "END_OF_MONTH", direction: "up", weight: 0.35 }],
    },
    { hour: "14:00", expectedTickets: 12, confidence: 0.4, lowConfidence: true },
  ],
  meta: { modelVersion: "forecast-v1.2.0", computedAt: "2026-07-14T22:00:00Z", dataWindow: "2026-01-05/2026-07-14" },
};

const anomaliesBody = {
  data: [
    {
      id: "anomaly_01",
      type: "AGENT_INACTIVE_PATTERN",
      status: "open",
      agencyId: AGENCY,
      description: `Agent 55555555-5555-4555-a555-555555555505 : 4 alertes AGENT_INACTIVE sur 7 jours.`,
      detectedAt: "2026-07-11T08:00:00Z",
      evidence: [{ metric: "inactive_alerts", threshold: 3, window: "7d", sample: 4 }],
      meta: { modelVersion: "anomaly-v1.0.0", computedAt: "2026-07-11T08:00:00Z", dataWindow: "2026-07-04/2026-07-11" },
    },
  ],
  meta: { page: 1, limit: 20, total: 1 },
  aiMeta: { modelVersion: "anomaly-v1.0.0", computedAt: "2026-07-11T08:00:00Z", dataWindow: "2026-07-04/2026-07-11" },
};

const feedbackBody = {
  scope: "agency",
  period: "2026-07",
  agencyId: AGENCY,
  feedbackCount: 147,
  sentimentBreakdown: { positive: 68, neutral: 22.4, negative: 9.6 },
  recurrentThemes: [{ theme: "temps d'attente", frequency: 0.42, sentiment: "negative" }],
  qualityScores: { agency: { agencyId: AGENCY, score: 4.1, scale: 5, components: [{ key: "sentiment", value: 1.8 }] } },
  meta: { modelVersion: "nlp-v1", computedAt: "2026-07-14T22:00:00Z", dataWindow: "2026-01-05/2026-07-14" },
};

const insufficientBody = {
  error: {
    code: "INSUFFICIENT_HISTORY",
    message: "Historique insuffisant.",
    details: { requiredDays: 90, availableDays: 42 },
  },
};

function makeHook(agencyId = AGENCY) {
  const ai = createSigfaClient("ai", BASE);
  return renderHook(() => useAiInsights({ ai, agencyId, date: "2026-07-15", period: "2026-07" }));
}

describe("useAiInsights — endpoints CONTRACT-008 uniquement", () => {
  beforeEach(() => {
    server.use(
      http.get(`${BASE}/ai/forecast`, () => HttpResponse.json(forecastBody)),
      http.get(`${BASE}/ai/anomalies`, () => HttpResponse.json(anomaliesBody)),
      http.get(`${BASE}/ai/feedback-insights`, () => HttpResponse.json(feedbackBody)),
    );
  });

  it("IA-005: consomme /ai/forecast + /ai/anomalies + /ai/feedback-insights (aucun calcul client)", async () => {
    const called: string[] = [];
    server.use(
      http.get(`${BASE}/ai/forecast`, ({ request }) => {
        called.push(new URL(request.url).pathname);
        return HttpResponse.json(forecastBody);
      }),
      http.get(`${BASE}/ai/anomalies`, ({ request }) => {
        called.push(new URL(request.url).pathname);
        return HttpResponse.json(anomaliesBody);
      }),
      http.get(`${BASE}/ai/feedback-insights`, ({ request }) => {
        called.push(new URL(request.url).pathname);
        return HttpResponse.json(feedbackBody);
      }),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh();
    });
    expect(called).toContain("/ai/forecast");
    expect(called).toContain("/ai/anomalies");
    expect(called).toContain("/ai/feedback-insights");
  });

  it("IA-005: état nominal — insights assemblés (forecast, anomalies, feedback, comex)", async () => {
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.load).toBe("ready"));
    expect(result.current.insights?.forecast.peakExpected).toBe(38);
    expect(result.current.insights?.anomalies).toHaveLength(1);
    expect(result.current.insights?.feedback.score).toBe(4.1);
    expect(result.current.insights?.comex.openAnomalies).toBe(1);
  });

  it("IA-005: ZERO PII — description d'anomalie expurgée des UUID", async () => {
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.load).toBe("ready"));
    expect(result.current.insights?.anomalies[0]?.description).not.toContain(
      "55555555-5555-4555-a555-555555555505",
    );
  });
});

describe("useAiInsights — état INSUFFICIENT_HISTORY (422) de première classe", () => {
  it("IA-005: 422 sur /ai/forecast → load=insufficient + progression X/90", async () => {
    server.use(
      http.get(`${BASE}/ai/forecast`, () => HttpResponse.json(insufficientBody, { status: 422 })),
      http.get(`${BASE}/ai/anomalies`, () => HttpResponse.json(anomaliesBody)),
      http.get(`${BASE}/ai/feedback-insights`, () => HttpResponse.json(feedbackBody)),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.load).toBe("insufficient"));
    expect(result.current.history?.availableDays).toBe(42);
    expect(result.current.history?.requiredDays).toBe(90);
    expect(result.current.insights).toBeNull();
  });
});

describe("useAiInsights — états d'erreur / vide", () => {
  it("IA-005: 500 sur un endpoint → load=error (jamais une erreur brute pour l'utilisateur)", async () => {
    server.use(
      http.get(`${BASE}/ai/forecast`, () => HttpResponse.json({ error: { code: "INTERNAL_SERVER_ERROR" } }, { status: 500 })),
      http.get(`${BASE}/ai/anomalies`, () => HttpResponse.json(anomaliesBody)),
      http.get(`${BASE}/ai/feedback-insights`, () => HttpResponse.json(feedbackBody)),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.load).toBe("error"));
  });

  it("IA-005: réponses vides → load=empty", async () => {
    server.use(
      http.get(`${BASE}/ai/forecast`, () => HttpResponse.json({ agencyId: AGENCY, date: "2026-07-15", contextualFactors: ["NONE"], forecast: [], meta: {} })),
      http.get(`${BASE}/ai/anomalies`, () => HttpResponse.json({ data: [], meta: { page: 1, limit: 20, total: 0 }, aiMeta: {} })),
      http.get(`${BASE}/ai/feedback-insights`, () => HttpResponse.json({ scope: "agency", period: "2026-07", feedbackCount: 0, sentimentBreakdown: { positive: 0, neutral: 0, negative: 0 }, recurrentThemes: [], qualityScores: {}, meta: {} })),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.load).toBe("empty"));
  });

  it("IA-005: setConnection bascule le statut offline", () => {
    const { result } = makeHook();
    act(() => result.current.setConnection("offline"));
    expect(result.current.connection).toBe("offline");
  });
});
