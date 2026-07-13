/**
 * IA-003 — Tests du backtest sur scénarios synthétiques étiquetés (⊛).
 *
 * Couvre : précision/rappel/F1 par type sur jeu étiqueté, scénario nominal → 0
 * anomalie (anti-faux-positif), détection combinée multi-types.
 *
 * Nommage strict : `IA-003: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  backtest,
  detectAll,
  type LabeledScenario,
} from "src/ai/anomaly-backtest.js";

const BANK = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const AGENCY = "33333333-3333-4333-a333-333333333333";
const SERVICE = "88888888-8888-4888-a888-888888888888";
const AGENT = "55555555-5555-4555-a555-555555555505";

/** Scénario QUEUE_STUCK positif (file gelée 30 min, 5 en attente). */
const stuckScenario: LabeledScenario = {
  id: "queue-stuck-positive",
  inputs: {
    queueStates: [
      {
        bankId: BANK,
        agencyId: AGENCY,
        serviceId: SERVICE,
        date: "2026-07-13",
        waitingTickets: 5,
        stuckMinutes: 30,
        countersOpen: 2,
      },
    ],
  },
  expected: ["QUEUE_STUCK"],
};

/** Scénario AGENT_INACTIVE_PATTERN positif (4 jours d'alertes / 7j). */
const inactiveScenario: LabeledScenario = {
  id: "agent-inactive-positive",
  inputs: {
    windowEndDate: "2026-07-13",
    inactiveAlerts: [
      { bankId: BANK, agencyId: AGENCY, agentId: AGENT, date: "2026-07-07" },
      { bankId: BANK, agencyId: AGENCY, agentId: AGENT, date: "2026-07-09" },
      { bankId: BANK, agencyId: AGENCY, agentId: AGENT, date: "2026-07-11" },
      { bankId: BANK, agencyId: AGENCY, agentId: AGENT, date: "2026-07-13" },
    ],
  },
  expected: ["AGENT_INACTIVE_PATTERN"],
};

/** Scénario SLA_SYSTEMIC positif (4 jours sous cible / 5). */
const slaScenario: LabeledScenario = {
  id: "sla-systemic-positive",
  inputs: {
    dailySla: [
      { bankId: BANK, agencyId: AGENCY, serviceId: SERVICE, date: "2026-07-09", slaRate: 0.5 },
      { bankId: BANK, agencyId: AGENCY, serviceId: SERVICE, date: "2026-07-10", slaRate: 0.6 },
      { bankId: BANK, agencyId: AGENCY, serviceId: SERVICE, date: "2026-07-11", slaRate: 0.55 },
      { bankId: BANK, agencyId: AGENCY, serviceId: SERVICE, date: "2026-07-12", slaRate: 0.9 },
      { bankId: BANK, agencyId: AGENCY, serviceId: SERVICE, date: "2026-07-13", slaRate: 0.7 },
    ],
  },
  expected: ["SLA_SYSTEMIC"],
};

/** Scénario NOMINAL : tout va bien → aucune anomalie attendue. */
const nominalScenario: LabeledScenario = {
  id: "nominal-healthy",
  inputs: {
    windowEndDate: "2026-07-13",
    queueStates: [
      {
        bankId: BANK,
        agencyId: AGENCY,
        serviceId: SERVICE,
        date: "2026-07-13",
        waitingTickets: 2, // < 3
        stuckMinutes: 5, // < 15
        countersOpen: 3,
      },
    ],
    inactiveAlerts: [
      { bankId: BANK, agencyId: AGENCY, agentId: AGENT, date: "2026-07-13" }, // 1 seule
    ],
    dailySla: [
      { bankId: BANK, agencyId: AGENCY, serviceId: SERVICE, date: "2026-07-12", slaRate: 0.95 },
      { bankId: BANK, agencyId: AGENCY, serviceId: SERVICE, date: "2026-07-13", slaRate: 0.92 },
    ],
  },
  expected: [],
};

describe("anomaly-backtest", () => {
  it("IA-003: scénario nominal → zéro anomalie (test anti-faux-positif)", () => {
    expect(detectAll(nominalScenario.inputs).size).toBe(0);
  });

  it("IA-003: précision/rappel/F1 par type calculés sur jeu étiqueté synthétique (test)", () => {
    const scenarios = [stuckScenario, inactiveScenario, slaScenario, nominalScenario];
    const result = backtest(scenarios);

    // Détection parfaite sur ce jeu : P=R=F1=1 pour chaque type positif.
    for (const type of ["QUEUE_STUCK", "AGENT_INACTIVE_PATTERN", "SLA_SYSTEMIC"] as const) {
      const m = result.perType[type];
      expect(m.precision).toBe(1);
      expect(m.recall).toBe(1);
      expect(m.f1).toBe(1);
      expect(m.tp).toBe(1);
      expect(m.fp).toBe(0);
      expect(m.fn).toBe(0);
    }
    // Aucun faux positif sur le scénario nominal.
    expect(result.nominalFalsePositives).toBe(0);
  });

  it("IA-003: backtest pénalise un faux positif (précision <1) — bruit mesuré", () => {
    // Un scénario étiqueté nominal mais qui déclenche QUEUE_STUCK.
    const noisy: LabeledScenario = {
      id: "noisy-false-positive",
      inputs: {
        queueStates: [
          {
            bankId: BANK,
            agencyId: AGENCY,
            serviceId: SERVICE,
            date: "2026-07-13",
            waitingTickets: 4,
            stuckMinutes: 20,
            countersOpen: 1,
          },
        ],
      },
      expected: [], // vérité : rien, mais le détecteur lèvera QUEUE_STUCK
    };
    const result = backtest([noisy]);
    expect(result.perType.QUEUE_STUCK.fp).toBe(1);
    expect(result.perType.QUEUE_STUCK.precision).toBe(0);
    expect(result.nominalFalsePositives).toBe(1);
  });

  it("IA-003: backtest pénalise un faux négatif (rappel <1)", () => {
    // Étiqueté SLA_SYSTEMIC mais données insuffisantes (2 jours sous cible seulement).
    const missed: LabeledScenario = {
      id: "missed-sla",
      inputs: {
        dailySla: [
          { bankId: BANK, agencyId: AGENCY, serviceId: SERVICE, date: "2026-07-12", slaRate: 0.5 },
          { bankId: BANK, agencyId: AGENCY, serviceId: SERVICE, date: "2026-07-13", slaRate: 0.6 },
        ],
      },
      expected: ["SLA_SYSTEMIC"],
    };
    const result = backtest([missed]);
    expect(result.perType.SLA_SYSTEMIC.fn).toBe(1);
    expect(result.perType.SLA_SYSTEMIC.recall).toBe(0);
  });

  it("IA-003: detectAll combine les 3 détecteurs sur un scénario multi-anomalies", () => {
    const combined = detectAll({
      ...stuckScenario.inputs,
      ...inactiveScenario.inputs,
      ...slaScenario.inputs,
    });
    expect([...combined].sort()).toEqual([
      "AGENT_INACTIVE_PATTERN",
      "QUEUE_STUCK",
      "SLA_SYSTEMIC",
    ]);
  });
});
