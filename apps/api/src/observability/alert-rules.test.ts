/**
 * Tests unitaires — NET-003 : règles d'alerte infra as-code + évaluation pure.
 *
 * Critères EARS :
 *  - CPU>80% / 5 min → WARNING vers ops
 *  - mem>85% / 5 min → WARNING vers ops
 *  - err>1% / 5 min → CRITICAL vers astreinte
 *  - RT p95 ≥ 500ms → dégradation
 *  - PostgreSQL/Redis down ou /health 503 → CRITICAL immédiat (sans fenêtre)
 *  - chaque règle nomme destinataire + fenêtre + sévérité
 *  - bascule aux BORNES EXACTES sur métriques simulées
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  buildAlertRules,
  isSustainedAbove,
  isDependencyDown,
  evaluateAlertRules,
  type MetricSample,
  type EvaluationInput,
} from "src/observability/alert-rules.js";
import {
  getObservabilityConfig,
  OPS_RECIPIENT_PLACEHOLDER,
  ONCALL_RECIPIENT_PLACEHOLDER,
} from "src/config/observability.js";

const NOW = 1_700_000_000_000;
const config = getObservabilityConfig();

/** Fenêtre de N échantillons datés, uniformes, dans les 5 dernières minutes. */
function samples(values: number[], nowMs = NOW): MetricSample[] {
  return values.map((value, i) => ({
    at: nowMs - (values.length - 1 - i) * 60_000,
    value,
  }));
}

const HEALTHY = { postgres: true, redis: true, healthOk: true } as const;

function input(partial: Partial<EvaluationInput>): EvaluationInput {
  return {
    nowMs: NOW,
    cpu: [],
    mem: [],
    errorRate: [],
    rtP95: [],
    health: { ...HEALTHY },
    ...partial,
  };
}

describe("NET-003: règles d'alerte as-code nomment sévérité, fenêtre et destinataire", () => {
  it("NET-003: 5 règles — CPU/mem/RT=WARNING→ops, err/dep=CRITICAL→astreinte", () => {
    const rules = buildAlertRules(config);
    const byId = new Map(rules.map((r) => [r.id, r]));
    expect(byId.get("cpu-high")?.severity).toBe("WARNING");
    expect(byId.get("cpu-high")?.recipient).toBe(OPS_RECIPIENT_PLACEHOLDER);
    expect(byId.get("cpu-high")?.windowS).toBe(300);
    expect(byId.get("mem-high")?.severity).toBe("WARNING");
    expect(byId.get("error-rate-high")?.severity).toBe("CRITICAL");
    expect(byId.get("error-rate-high")?.recipient).toBe(ONCALL_RECIPIENT_PLACEHOLDER);
    expect(byId.get("rt-latency-degraded")?.severity).toBe("WARNING");
    expect(byId.get("rt-latency-degraded")?.threshold).toBe(500);
    // dépendance = immédiat (fenêtre 0)
    expect(byId.get("dependency-down")?.severity).toBe("CRITICAL");
    expect(byId.get("dependency-down")?.windowS).toBe(0);
  });
});

describe("NET-003: bascule aux bornes exactes sur métrique simulée", () => {
  it("NET-003: valeur ÉGALE au seuil ne déclenche pas (> strict) — 80% pile", () => {
    expect(isSustainedAbove(samples([0.8, 0.8, 0.8]), 0.8, 300, NOW)).toBe(false);
  });

  it("NET-003: juste au-dessus du seuil sur toute la fenêtre → déclenche", () => {
    expect(isSustainedAbove(samples([0.81, 0.82, 0.9]), 0.8, 300, NOW)).toBe(true);
  });

  it("NET-003: un seul échantillon SOUS le seuil casse le sustain (anti-pic isolé)", () => {
    expect(isSustainedAbove(samples([0.9, 0.79, 0.9]), 0.8, 300, NOW)).toBe(false);
  });

  it("NET-003: fenêtre vide (aucun échantillon récent) → pas de déclenchement", () => {
    const old = samples([0.99], NOW - 3_600_000); // 1h dans le passé
    expect(isSustainedAbove(old, 0.8, 300, NOW)).toBe(false);
  });
});

describe("NET-003: alerte CPU>80% sur 5 min → WARNING routée vers ops (métrique simulée)", () => {
  it("NET-003: CPU soutenu >80% → WARNING vers ops", () => {
    const alerts = evaluateAlertRules(input({ cpu: samples([0.85, 0.9, 0.88]) }), config);
    const cpu = alerts.find((a) => a.ruleId === "cpu-high");
    expect(cpu?.severity).toBe("WARNING");
    expect(cpu?.recipient).toBe(OPS_RECIPIENT_PLACEHOLDER);
  });

  it("NET-003: CPU à 80% pile → aucune alerte", () => {
    const alerts = evaluateAlertRules(input({ cpu: samples([0.8, 0.8]) }), config);
    expect(alerts.find((a) => a.ruleId === "cpu-high")).toBeUndefined();
  });
});

describe("NET-003: alerte mem>85% sur 5 min → WARNING routée vers ops", () => {
  it("NET-003: mémoire soutenue >85% → WARNING vers ops", () => {
    const alerts = evaluateAlertRules(input({ mem: samples([0.86, 0.9]) }), config);
    const mem = alerts.find((a) => a.ruleId === "mem-high");
    expect(mem?.severity).toBe("WARNING");
    expect(mem?.recipient).toBe(OPS_RECIPIENT_PLACEHOLDER);
  });
});

describe("NET-003: alerte err>1% sur 5 min → CRITICAL routée vers astreinte on-call", () => {
  it("NET-003: taux d'erreur soutenu >1% → CRITICAL vers astreinte", () => {
    const alerts = evaluateAlertRules(input({ errorRate: samples([0.02, 0.015]) }), config);
    const err = alerts.find((a) => a.ruleId === "error-rate-high");
    expect(err?.severity).toBe("CRITICAL");
    expect(err?.recipient).toBe(ONCALL_RECIPIENT_PLACEHOLDER);
  });

  it("NET-003: err à 1% pile → aucune alerte (> strict)", () => {
    const alerts = evaluateAlertRules(input({ errorRate: samples([0.01, 0.01]) }), config);
    expect(alerts.find((a) => a.ruleId === "error-rate-high")).toBeUndefined();
  });
});

describe("NET-003: ticket:called p95 ≥ 500ms → alerte de dégradation (aligné SEC-004)", () => {
  it("NET-003: RT p95 > 500ms soutenu → dégradation WARNING", () => {
    const alerts = evaluateAlertRules(input({ rtP95: samples([550, 600]) }), config);
    expect(alerts.find((a) => a.ruleId === "rt-latency-degraded")?.severity).toBe("WARNING");
  });

  it("NET-003: RT p95 = 500ms pile → pas d'alerte (> strict, seuil de sortie)", () => {
    const alerts = evaluateAlertRules(input({ rtP95: samples([500, 500]) }), config);
    expect(alerts.find((a) => a.ruleId === "rt-latency-degraded")).toBeUndefined();
  });
});

describe("NET-003: PostgreSQL/Redis down ou /health 503 → CRITICAL immédiat (sans fenêtre)", () => {
  it("NET-003: PostgreSQL down → dependency-down immédiat", () => {
    expect(isDependencyDown({ postgres: false, redis: true, healthOk: true })).toBe(true);
  });

  it("NET-003: Redis down → dependency-down immédiat", () => {
    expect(isDependencyDown({ postgres: true, redis: false, healthOk: true })).toBe(true);
  });

  it("NET-003: /health 503 → dependency-down immédiat", () => {
    expect(isDependencyDown({ postgres: true, redis: true, healthOk: false })).toBe(true);
  });

  it("NET-003: tout sain → pas de dependency-down", () => {
    expect(isDependencyDown(HEALTHY)).toBe(false);
  });

  it("NET-003: dépendance down → CRITICAL vers astreinte SANS métrique de fenêtre", () => {
    const alerts = evaluateAlertRules(
      input({ health: { postgres: false, redis: true, healthOk: true } }),
      config
    );
    const dep = alerts.find((a) => a.ruleId === "dependency-down");
    expect(dep?.severity).toBe("CRITICAL");
    expect(dep?.recipient).toBe(ONCALL_RECIPIENT_PLACEHOLDER);
  });
});

describe("NET-003: métriques simulées saines → aucune alerte", () => {
  it("NET-003: tout sous les seuils et dépendances OK → zéro alerte", () => {
    const alerts = evaluateAlertRules(
      input({
        cpu: samples([0.5, 0.6]),
        mem: samples([0.7]),
        errorRate: samples([0.001]),
        rtP95: samples([200, 300]),
      }),
      config
    );
    expect(alerts).toHaveLength(0);
  });
});
