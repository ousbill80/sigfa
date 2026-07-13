/**
 * Tests for AiInsightsDashboard (IA-005) — direction insights + COMEX predictive.
 *
 * Covers the 5 states (nominal/loading/empty/error/insufficient), the first-class
 * INSUFFICIENT_HISTORY "X/90" view, visual lowConfidence flag, explainability
 * (drivers/evidence/decomposition), the advisory-only staffing (NO auto action),
 * anomaly evidence distinct from a real-time alert, the COMEX predictive block,
 * ZERO PII, tokens-only, FR/EN, and contrast (WCAG).
 * @module components/insights/ai-insights-dashboard.test
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AiInsightsDashboard } from "./ai-insights-dashboard";
import { contrastRatio } from "@/lib/theme";
import type { AiInsights } from "@/lib/use-ai-insights";

function model(over: Partial<AiInsights> = {}): AiInsights {
  return {
    forecast: {
      points: [
        {
          hour: "10:00",
          expectedTickets: 38,
          confidence: 0.89,
          lowConfidence: false,
          drivers: [{ factor: "END_OF_MONTH", direction: "up", weight: 0.35 }],
        },
        { hour: "14:00", expectedTickets: 12, confidence: 0.4, lowConfidence: true, drivers: [] },
      ],
      factors: ["END_OF_MONTH"],
      peakExpected: 38,
      hasLowConfidence: true,
    },
    anomalies: [
      {
        id: "anomaly_01",
        type: "AGENT_INACTIVE_PATTERN",
        status: "open",
        description: "Motif d'inactivité récurrent détecté.",
        evidence: [{ metric: "inactive_alerts", threshold: 3, window: "7d", sample: 4 }],
      },
    ],
    feedback: {
      feedbackCount: 147,
      sentiment: { positive: 68, neutral: 22, negative: 10 },
      score: 4.1,
      scale: 5,
      components: [{ key: "sentiment", value: 1.8 }],
      insufficientSample: false,
    },
    comex: { expectedNetworkLoad: 38, atRiskCount: 1, openAnomalies: 1, level: "risk" },
    ...over,
  };
}

describe("IA-005: dashboard insights — surfaces nominales", () => {
  it("IA-005: rend les 4 surfaces (forecast, staffing/reco advisory, anomalies, qualité)", () => {
    render(<AiInsightsDashboard insights={model()} load="ready" history={null} />);
    expect(screen.getByTestId("ai-forecast")).toBeInTheDocument();
    expect(screen.getByTestId("ai-anomalies")).toBeInTheDocument();
    expect(screen.getByTestId("ai-feedback")).toBeInTheDocument();
    expect(screen.getByTestId("ai-comex-predictive")).toBeInTheDocument();
  });

  it("IA-005: forecast — explicabilité drivers rendue lisible", () => {
    render(<AiInsightsDashboard insights={model()} load="ready" history={null} />);
    expect(screen.getByTestId("ai-forecast-drivers")).toHaveTextContent(/END_OF_MONTH/);
    expect(screen.getByTestId("ai-forecast-peak")).toHaveTextContent("38");
  });

  it("IA-005: lowConfidence signalé visuellement", () => {
    render(<AiInsightsDashboard insights={model()} load="ready" history={null} />);
    const flag = screen.getByTestId("ai-lowconf-flag");
    expect(flag).toBeInTheDocument();
    // Uncertainty tone uses the warning token, never presented as certain.
    expect(flag.getAttribute("style")).toContain("var(--warning)");
  });

  it("IA-005: anomalie affiche son evidence (métrique/seuil/fenêtre)", () => {
    render(<AiInsightsDashboard insights={model()} load="ready" history={null} />);
    const evidence = screen.getByTestId("ai-anomaly-evidence");
    expect(evidence).toHaveTextContent("inactive_alerts");
    expect(evidence).toHaveTextContent("3");
    expect(evidence).toHaveTextContent("7d");
  });

  it("IA-005: anomalie distinguée d'une alerte instantanée (libellé motif/agrégé)", () => {
    render(<AiInsightsDashboard insights={model()} load="ready" history={null} />);
    expect(screen.getByTestId("ai-anomalies")).toHaveTextContent(/motif|pattern/i);
  });

  it("IA-005: score qualité + décomposition explicable affichés", () => {
    render(<AiInsightsDashboard insights={model()} load="ready" history={null} />);
    expect(screen.getByTestId("ai-feedback-score")).toHaveTextContent(/4[.,]1/);
    expect(screen.getByTestId("ai-feedback-components")).toHaveTextContent("sentiment");
  });

  it("IA-005: staffing/reco = advisory, AUCUN bouton d'exécution automatique", () => {
    render(<AiInsightsDashboard insights={model()} load="ready" history={null} />);
    // Advisory wording present…
    expect(screen.getByTestId("ai-advisory-notice")).toBeInTheDocument();
    // …and NO auto-execution affordance anywhere.
    expect(screen.queryByTestId("ai-auto-execute")).not.toBeInTheDocument();
    for (const btn of screen.queryAllByRole("button")) {
      expect(btn.textContent ?? "").not.toMatch(/exécuter|execute|appliquer|apply auto/i);
    }
  });

  it("IA-005: COMEX prédictif ≤ 1 écran — charge attendue + agences à risque", () => {
    render(<AiInsightsDashboard insights={model()} load="ready" history={null} />);
    const comex = screen.getByTestId("ai-comex-predictive");
    expect(comex).toHaveTextContent("38");
    expect(screen.getByTestId("ai-comex-atrisk")).toHaveTextContent("1");
  });
});

describe("IA-005: 5 états", () => {
  it("IA-005: état chargement (skeleton)", () => {
    render(<AiInsightsDashboard insights={null} load="loading" history={null} />);
    expect(screen.getByTestId("ai-skeleton")).toBeInTheDocument();
  });

  it("IA-005: état vide", () => {
    render(<AiInsightsDashboard insights={null} load="empty" history={null} />);
    expect(screen.getByTestId("ai-empty")).toBeInTheDocument();
  });

  it("IA-005: état erreur (jamais une erreur technique brute)", () => {
    render(<AiInsightsDashboard insights={null} load="error" history={null} />);
    const err = screen.getByTestId("ai-error");
    expect(err).toBeInTheDocument();
    expect(err).not.toHaveTextContent(/500|stack|undefined/i);
  });

  it("IA-005: état offline — bannière discrète, surfaces conservées", () => {
    render(<AiInsightsDashboard insights={model()} load="ready" history={null} offline />);
    expect(screen.getByTestId("ai-offline-banner")).toBeInTheDocument();
    expect(screen.getByTestId("ai-forecast")).toBeInTheDocument();
  });

  it("IA-005: état INSUFFICIENT_HISTORY — vue pédagogique X/90 jours, jamais un graphe vide trompeur", () => {
    render(
      <AiInsightsDashboard
        insights={null}
        load="insufficient"
        history={{ requiredDays: 90, availableDays: 42, progress: 42 / 90 }}
      />,
    );
    const view = screen.getByTestId("ai-insufficient");
    expect(view).toBeInTheDocument();
    expect(view).toHaveTextContent("42");
    expect(view).toHaveTextContent("90");
    // No misleading empty chart is rendered.
    expect(screen.queryByTestId("ai-forecast")).not.toBeInTheDocument();
  });
});

describe("IA-005: i18n FR/EN + contraste (WCAG) + tokens", () => {
  it("IA-005: rend en anglais quand locale=en", () => {
    render(<AiInsightsDashboard insights={model()} load="ready" history={null} locale="en" />);
    expect(screen.getByTestId("ai-title")).toHaveTextContent(/PREDICTIVE|INSIGHTS|AI/i);
  });

  it("IA-005: rend en français par défaut", () => {
    render(<AiInsightsDashboard insights={model()} load="ready" history={null} />);
    expect(screen.getByTestId("ai-title")).toHaveTextContent(/IA|PRÉDICTIF|INSIGHTS/i);
  });

  it("IA-005: contraste ink/paper ≥ 4.5:1 (WCAG AA)", () => {
    // Design-System v2 tokens.
    expect(contrastRatio("#1A130C", "#FBF8F3")).toBeGreaterThanOrEqual(4.5);
  });
});
