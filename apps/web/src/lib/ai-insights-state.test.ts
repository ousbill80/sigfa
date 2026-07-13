/**
 * Tests for ai-insights-state (IA-005) — pure derivation of the AI surfaces.
 *
 * Covers the non-negotiable guarantees: INSUFFICIENT_HISTORY as first-class
 * state ("X/90"), lowConfidence surfacing, ZERO PII scrubbing, explainability
 * (drivers/evidence/components), and the COMEX predictive risk level (danger
 * reserved for real risk).
 * @module lib/ai-insights-state.test
 */
import { describe, it, expect } from "vitest";
import {
  parseInsufficientHistory,
  isLowConfidence,
  formatConfidence,
  scrubPii,
  deriveForecast,
  deriveAnomalies,
  deriveFeedbackInsights,
  deriveComexPredictive,
  deriveRiskLevel,
  riskColor,
  aggregateDrivers,
  REQUIRED_HISTORY_DAYS,
  type ForecastPointView,
} from "./ai-insights-state";

describe("IA-005: aggregateDrivers — dé-surcharge des drivers", () => {
  const points: ForecastPointView[] = [
    {
      hour: "09:00",
      expectedTickets: 10,
      confidence: 0.9,
      lowConfidence: false,
      drivers: [
        { factor: "END_OF_MONTH", direction: "up", weight: 0.4 },
        { factor: "HOLIDAY", direction: "down", weight: 0.2 },
      ],
    },
    {
      hour: "10:00",
      expectedTickets: 20,
      confidence: 0.9,
      lowConfidence: false,
      drivers: [{ factor: "END_OF_MONTH", direction: "up", weight: 0.3 }],
    },
  ];

  it("IA-005: agrège par facteur (poids sommés) et trie par poids décroissant", () => {
    const agg = aggregateDrivers(points);
    expect(agg[0]!.factor).toBe("END_OF_MONTH");
    expect(agg[0]!.weight).toBeCloseTo(0.7);
    expect(agg[1]!.factor).toBe("HOLIDAY");
  });

  it("IA-005: direction dominante = côté le plus lourd, poids borné à 1", () => {
    const agg = aggregateDrivers([
      {
        hour: "11:00",
        expectedTickets: 5,
        confidence: 0.9,
        lowConfidence: false,
        drivers: [
          { factor: "X", direction: "down", weight: 0.9 },
          { factor: "X", direction: "up", weight: 0.3 },
        ],
      },
    ]);
    expect(agg[0]!.direction).toBe("down");
    expect(agg[0]!.weight).toBe(1);
  });

  it("IA-005: aucun driver → liste vide", () => {
    expect(aggregateDrivers([])).toEqual([]);
  });
});

const UUID = "55555555-5555-4555-a555-555555555505";

describe("IA-005: INSUFFICIENT_HISTORY → état pédagogique X/90, jamais erreur brute", () => {
  it("IA-005: parse un 422 INSUFFICIENT_HISTORY en progression X/90", () => {
    const body = {
      error: {
        code: "INSUFFICIENT_HISTORY",
        message: "…",
        details: { requiredDays: 90, availableDays: 42 },
      },
    };
    const parsed = parseInsufficientHistory(body);
    expect(parsed).not.toBeNull();
    expect(parsed?.requiredDays).toBe(90);
    expect(parsed?.availableDays).toBe(42);
    expect(parsed?.progress).toBeCloseTo(42 / 90);
  });

  it("IA-005: défaut requiredDays = 90 si absent", () => {
    const parsed = parseInsufficientHistory({
      error: { code: "INSUFFICIENT_HISTORY", details: { availableDays: 10 } },
    });
    expect(parsed?.requiredDays).toBe(REQUIRED_HISTORY_DAYS);
    expect(parsed?.availableDays).toBe(10);
  });

  it("IA-005: clamp availableDays entre 0 et requiredDays", () => {
    expect(parseInsufficientHistory({
      error: { code: "INSUFFICIENT_HISTORY", details: { requiredDays: 90, availableDays: 999 } },
    })?.availableDays).toBe(90);
    expect(parseInsufficientHistory({
      error: { code: "INSUFFICIENT_HISTORY", details: { requiredDays: 90, availableDays: -5 } },
    })?.availableDays).toBe(0);
  });

  it("IA-005: retourne null pour un autre code d'erreur (vraie erreur technique)", () => {
    expect(parseInsufficientHistory({ error: { code: "INTERNAL_SERVER_ERROR" } })).toBeNull();
    expect(parseInsufficientHistory(null)).toBeNull();
    expect(parseInsufficientHistory({})).toBeNull();
  });
});

describe("IA-005: lowConfidence signalé visuellement (incertitude explicite)", () => {
  it("IA-005: marqueur explicite lowConfidence=true prime", () => {
    expect(isLowConfidence({ confidence: 0.9, lowConfidence: true })).toBe(true);
  });

  it("IA-005: fallback confidence < 0.5", () => {
    expect(isLowConfidence({ confidence: 0.4 })).toBe(true);
    expect(isLowConfidence({ confidence: 0.5 })).toBe(false);
    expect(isLowConfidence({ confidence: 0.87 })).toBe(false);
  });

  it("IA-005: formatConfidence en pourcentage entier", () => {
    expect(formatConfidence(0.87)).toBe("87 %");
    expect(formatConfidence(1)).toBe("100 %");
    expect(formatConfidence(1.5)).toBe("100 %");
    expect(formatConfidence(-0.2)).toBe("0 %");
  });
});

describe("IA-005: ZERO PII — aucun identifiant brut affiché", () => {
  it("IA-005: scrubPii retire les UUID bruts d'une description", () => {
    const scrubbed = scrubPii(`Agent ${UUID} : 4 alertes AGENT_INACTIVE sur 7 jours.`);
    expect(scrubbed).not.toContain(UUID);
    expect(scrubbed).toContain("alertes AGENT_INACTIVE");
  });

  it("IA-005: deriveAnomalies expurge les UUID des descriptions", () => {
    const anomalies = deriveAnomalies({
      data: [
        {
          id: "anomaly_01",
          type: "AGENT_INACTIVE_PATTERN",
          status: "open",
          description: `Agent ${UUID} : motif d'inactivité.`,
          evidence: [{ metric: "inactive_alerts", threshold: 3, window: "7d", sample: 4 }],
        },
      ],
    });
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.description).not.toContain(UUID);
    expect(anomalies[0]?.evidence[0]?.metric).toBe("inactive_alerts");
  });
});

describe("IA-005: forecast — explicabilité (drivers) + peak + lowConfidence surface", () => {
  it("IA-005: dérive points, drivers, pic et facteurs (NONE filtré)", () => {
    const view = deriveForecast({
      contextualFactors: ["END_OF_MONTH", "NONE"],
      forecast: [
        {
          hour: "10:00",
          expectedTickets: 38,
          confidence: 0.89,
          drivers: [{ factor: "END_OF_MONTH", direction: "up", weight: 0.35 }],
        },
        { hour: "14:00", expectedTickets: 12, confidence: 0.4, lowConfidence: true },
      ],
    });
    expect(view.points).toHaveLength(2);
    expect(view.peakExpected).toBe(38);
    expect(view.factors).toEqual(["END_OF_MONTH"]);
    expect(view.points[0]?.drivers[0]?.factor).toBe("END_OF_MONTH");
    expect(view.points[1]?.lowConfidence).toBe(true);
    expect(view.hasLowConfidence).toBe(true);
  });

  it("IA-005: forecast vide → peak 0, pas de lowConfidence", () => {
    const view = deriveForecast({ forecast: [], contextualFactors: ["NONE"] });
    expect(view.peakExpected).toBe(0);
    expect(view.hasLowConfidence).toBe(false);
    expect(view.factors).toEqual([]);
  });
});

describe("IA-005: anomalies — evidence + types valides seulement", () => {
  it("IA-005: ignore les types/statuts inconnus", () => {
    const anomalies = deriveAnomalies({
      data: [
        { id: "a1", type: "QUEUE_STUCK", status: "open", description: "File bloquée." },
        { id: "a2", type: "UNKNOWN_TYPE", status: "open", description: "x" },
        { id: "a3", type: "SLA_SYSTEMIC", status: "weird", description: "y" },
      ],
    });
    expect(anomalies.map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("IA-005: feedback insights — score retenu si échantillon insuffisant", () => {
  it("IA-005: score publié quand échantillon suffisant", () => {
    const view = deriveFeedbackInsights({
      feedbackCount: 147,
      sentimentBreakdown: { positive: 68, neutral: 22, negative: 10 },
      qualityScores: {
        agency: {
          score: 4.1,
          scale: 5,
          components: [{ key: "sentiment", value: 1.8 }],
        },
      },
    });
    expect(view.score).toBe(4.1);
    expect(view.scale).toBe(5);
    expect(view.insufficientSample).toBe(false);
    expect(view.components[0]?.key).toBe("sentiment");
  });

  it("IA-005: score retenu (null) si échantillon insuffisant (< 30)", () => {
    const view = deriveFeedbackInsights({
      feedbackCount: 12,
      sentimentBreakdown: { positive: 50, neutral: 30, negative: 20 },
      qualityScores: { agency: { score: 4.5, scale: 5 } },
    });
    expect(view.insufficientSample).toBe(true);
    expect(view.score).toBeNull();
    expect(view.scale).toBeNull();
  });

  it("IA-005: respecte le flag insufficientSample explicite du contrat", () => {
    const view = deriveFeedbackInsights({
      feedbackCount: 200,
      insufficientSample: true,
      sentimentBreakdown: { positive: 1, neutral: 1, negative: 1 },
      qualityScores: { agency: { score: 3, scale: 5 } },
    });
    expect(view.insufficientSample).toBe(true);
    expect(view.score).toBeNull();
  });
});

describe("IA-005: robustesse — coercition défensive des payloads partiels", () => {
  it("IA-005: deriveForecast tolère un body vide/invalide", () => {
    const view = deriveForecast(null);
    expect(view.points).toEqual([]);
    expect(view.peakExpected).toBe(0);
    expect(view.factors).toEqual([]);
  });

  it("IA-005: deriveForecast coerce des champs absents en valeurs sûres", () => {
    const view = deriveForecast({ forecast: [{}], contextualFactors: "not-array" });
    expect(view.points[0]?.hour).toBe("");
    expect(view.points[0]?.expectedTickets).toBe(0);
    expect(view.points[0]?.confidence).toBe(0);
    expect(view.points[0]?.drivers).toEqual([]);
  });

  it("IA-005: deriveForecast ignore un driver sans factor", () => {
    const view = deriveForecast({
      forecast: [{ hour: "9:00", expectedTickets: 5, confidence: 0.8, drivers: [{}, { factor: "history_trend", direction: "down" }] }],
      contextualFactors: [],
    });
    expect(view.points[0]?.drivers).toHaveLength(1);
    expect(view.points[0]?.drivers[0]?.direction).toBe("down");
    expect(view.points[0]?.drivers[0]?.weight).toBe(0);
  });

  it("IA-005: deriveAnomalies tolère data absent et description manquante", () => {
    expect(deriveAnomalies(null)).toEqual([]);
    expect(deriveAnomalies({ data: "x" })).toEqual([]);
    const anomalies = deriveAnomalies({
      data: [
        { type: "QUEUE_STUCK", status: "open", description: "no id" },
        { id: "ok", type: "QUEUE_STUCK", status: "open" },
      ],
    });
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.description).toBe("");
    expect(anomalies[0]?.evidence).toEqual([]);
  });

  it("IA-005: deriveAnomalies ignore une evidence sans métrique", () => {
    const anomalies = deriveAnomalies({
      data: [{ id: "a", type: "SLA_SYSTEMIC", status: "acked", description: "x", evidence: [{}, { metric: "sla_rate" }] }],
    });
    expect(anomalies[0]?.evidence).toHaveLength(1);
    expect(anomalies[0]?.evidence[0]?.metric).toBe("sla_rate");
    expect(anomalies[0]?.evidence[0]?.threshold).toBe(0);
  });

  it("IA-005: deriveFeedbackInsights tolère un body vide", () => {
    const view = deriveFeedbackInsights(null);
    expect(view.feedbackCount).toBe(0);
    expect(view.sentiment).toEqual({ positive: 0, neutral: 0, negative: 0 });
    expect(view.score).toBeNull();
    expect(view.insufficientSample).toBe(true);
    expect(view.components).toEqual([]);
  });

  it("IA-005: deriveFeedbackInsights ignore un composant sans clé", () => {
    const view = deriveFeedbackInsights({
      feedbackCount: 50,
      sentimentBreakdown: { positive: 40, neutral: 40, negative: 20 },
      qualityScores: { agency: { score: 3.9, scale: 5, components: [{}, { key: "wait", value: 0.6 }] } },
    });
    expect(view.components).toHaveLength(1);
    expect(view.components[0]?.key).toBe("wait");
  });
});

describe("IA-005: COMEX prédictif — danger réservé au vrai risque", () => {
  it("IA-005: risk quand ≥1 anomalie ouverte", () => {
    expect(deriveRiskLevel(1, false)).toBe("risk");
    expect(riskColor("risk")).toBe("var(--danger)");
  });

  it("IA-005: watch (jamais danger) quand seulement lowConfidence", () => {
    expect(deriveRiskLevel(0, true)).toBe("watch");
    expect(riskColor("watch")).toBe("var(--warning)");
  });

  it("IA-005: ok quand aucun signal", () => {
    expect(deriveRiskLevel(0, false)).toBe("ok");
    expect(riskColor("ok")).toBe("var(--success)");
  });

  it("IA-005: synthèse prédictive — charge attendue + agences à risque", () => {
    const forecast = deriveForecast({
      contextualFactors: ["NONE"],
      forecast: [{ hour: "10:00", expectedTickets: 40, confidence: 0.9 }],
    });
    const anomalies = deriveAnomalies({
      data: [{ id: "a1", type: "QUEUE_STUCK", status: "open", description: "x" }],
    });
    const predictive = deriveComexPredictive(forecast, anomalies);
    expect(predictive.expectedNetworkLoad).toBe(40);
    expect(predictive.openAnomalies).toBe(1);
    expect(predictive.atRiskCount).toBe(1);
    expect(predictive.level).toBe("risk");
  });
});
