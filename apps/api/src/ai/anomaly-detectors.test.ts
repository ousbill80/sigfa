/**
 * IA-003 — Tests unitaires des détecteurs d'anomalies (fonctions PURES).
 *
 * Couvre les critères ⊛ : QUEUE_STUCK (D3 ≥3 tickets/≥15 min), AGENT_INACTIVE_PATTERN
 * (≥3 alertes/7j, surchargable), SLA_SYSTEMIC (sous cible sur fenêtre récurrente),
 * énum FERMÉE, evidence structurée, référence alertes sans double comptage,
 * idempotence de clé, seuils surchargeables, isolation tenant, ZÉRO action auto.
 *
 * Nommage strict : `IA-003: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  ANOMALY_TYPES,
  DEFAULT_DETECTOR_THRESHOLDS,
  resolveThresholds,
  detectQueueStuck,
  detectAgentInactivePattern,
  detectSlaSystemic,
  subtractDays,
  type QueueStateObservation,
  type AgentInactiveAlertRecord,
  type DailySlaRecord,
} from "src/ai/anomaly-detectors.js";

const BANK_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const BANK_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const AGENCY = "33333333-3333-4333-a333-333333333333";
const SERVICE = "88888888-8888-4888-a888-888888888888";
const AGENT = "55555555-5555-4555-a555-555555555505";

describe("anomaly-detectors — énum & seuils", () => {
  it("IA-003: types limités à l'énum CONTRACT-008 (QUEUE_STUCK/AGENT_INACTIVE_PATTERN/SLA_SYSTEMIC) — aucune autre valeur (test structurel)", () => {
    expect([...ANOMALY_TYPES]).toEqual([
      "QUEUE_STUCK",
      "AGENT_INACTIVE_PATTERN",
      "SLA_SYSTEMIC",
    ]);
  });

  it("IA-003: seuils par défaut D3/CONTRACT-008 (15 min, 3 tickets, 3 alertes/7j)", () => {
    expect(DEFAULT_DETECTOR_THRESHOLDS.queueStuckMinutes).toBe(15);
    expect(DEFAULT_DETECTOR_THRESHOLDS.queueStuckMinWaiting).toBe(3);
    expect(DEFAULT_DETECTOR_THRESHOLDS.inactiveAlertThreshold).toBe(3);
    expect(DEFAULT_DETECTOR_THRESHOLDS.inactiveWindowDays).toBe(7);
  });

  it("IA-003: resolveThresholds fusionne surcharge banque partielle sans écraser les autres (CONTRACT-005)", () => {
    const merged = resolveThresholds({ queueStuckMinutes: 20 });
    expect(merged.queueStuckMinutes).toBe(20);
    expect(merged.queueStuckMinWaiting).toBe(3); // défaut préservé
  });

  it("IA-003: subtractDays est une arithmétique de calendrier pure et déterministe", () => {
    expect(subtractDays("2026-07-13", 6)).toBe("2026-07-07");
    expect(subtractDays("2026-03-01", 1)).toBe("2026-02-28");
  });
});

describe("QUEUE_STUCK (D3 — ≥3 tickets en attente sur ≥15 min)", () => {
  const obs = (over: Partial<QueueStateObservation> = {}): QueueStateObservation => ({
    bankId: BANK_A,
    agencyId: AGENCY,
    serviceId: SERVICE,
    date: "2026-07-13",
    waitingTickets: 3,
    stuckMinutes: 15,
    countersOpen: 1,
    ...over,
  });

  it("IA-003: QUEUE_STUCK levé sur scénario file gelée ≥15min avec attente, preuves (agency/service/fenêtre) présentes (test synthétique)", () => {
    const [c] = detectQueueStuck([obs()]);
    expect(c).toBeDefined();
    expect(c!.type).toBe("QUEUE_STUCK");
    expect(c!.agencyId).toBe(AGENCY);
    expect(c!.serviceId).toBe(SERVICE);
    const metrics = c!.evidence.map((e) => e.metric);
    expect(metrics).toContain("stuck_minutes");
    expect(metrics).toContain("waiting_tickets");
    const stuck = c!.evidence.find((e) => e.metric === "stuck_minutes")!;
    expect(stuck.threshold).toBe(15);
    expect(stuck.sample).toBe(15);
  });

  it("IA-003: QUEUE_STUCK NON levé si <3 tickets en attente (seuil D3)", () => {
    expect(detectQueueStuck([obs({ waitingTickets: 2 })])).toHaveLength(0);
  });

  it("IA-003: QUEUE_STUCK NON levé si <15 min de stagnation (seuil D3)", () => {
    expect(detectQueueStuck([obs({ stuckMinutes: 14 })])).toHaveLength(0);
  });

  it("IA-003: QUEUE_STUCK NON levé si aucun guichet ouvert (garde ≥1 guichet)", () => {
    expect(detectQueueStuck([obs({ countersOpen: 0 })])).toHaveLength(0);
  });

  it("IA-003: QUEUE_STUCK seuil surchargeable par banque (20 min)", () => {
    const th = resolveThresholds({ queueStuckMinutes: 20 });
    expect(detectQueueStuck([obs({ stuckMinutes: 15 })], th)).toHaveLength(0);
    expect(detectQueueStuck([obs({ stuckMinutes: 20 })], th)).toHaveLength(1);
  });

  it("IA-003: idempotence détecteur — re-run même fenêtre = même clé, zéro doublon", () => {
    const input = [obs(), obs()]; // même observation dupliquée
    const first = detectQueueStuck(input);
    const second = detectQueueStuck(input);
    expect(first).toHaveLength(1);
    expect(first[0]!.anomalyKey).toBe(second[0]!.anomalyKey);
  });
});

describe("AGENT_INACTIVE_PATTERN (≥3 alertes AGENT_INACTIVE / 7j — CONTRACT-008)", () => {
  const alert = (date: string, over: Partial<AgentInactiveAlertRecord> = {}): AgentInactiveAlertRecord => ({
    bankId: BANK_A,
    agencyId: AGENCY,
    agentId: AGENT,
    date,
    ...over,
  });

  it("IA-003: AGENT_INACTIVE_PATTERN = ≥3 alertes AGENT_INACTIVE / 7j glissants (seuil CONTRACT-008), surchargable par thresholds (test)", () => {
    const alerts = [alert("2026-07-08"), alert("2026-07-10"), alert("2026-07-13")];
    const [c] = detectAgentInactivePattern(alerts, "2026-07-13");
    expect(c).toBeDefined();
    expect(c!.type).toBe("AGENT_INACTIVE_PATTERN");
    expect(c!.agentId).toBe(AGENT);
    const ev = c!.evidence.find((e) => e.metric === "inactive_alerts")!;
    expect(ev.threshold).toBe(3);
    expect(ev.window).toBe("7d");
    expect(ev.sample).toBe(3);

    // Surcharge banque : seuil relevé à 4 → plus d'anomalie avec 3 alertes.
    const th = resolveThresholds({ inactiveAlertThreshold: 4 });
    expect(detectAgentInactivePattern(alerts, "2026-07-13", th)).toHaveLength(0);
  });

  it("IA-003: AGENT_INACTIVE_PATTERN NON levé avec 2 alertes seulement (<seuil)", () => {
    const alerts = [alert("2026-07-10"), alert("2026-07-13")];
    expect(detectAgentInactivePattern(alerts, "2026-07-13")).toHaveLength(0);
  });

  it("IA-003: référence les alertes agrégées SANS double comptage — plusieurs alertes le même jour comptent 1 jour", () => {
    const alerts = [
      alert("2026-07-13"),
      alert("2026-07-13"),
      alert("2026-07-13"),
    ];
    // 3 alertes mais 1 seul jour distinct → PAS le motif (évite le sur-comptage).
    expect(detectAgentInactivePattern(alerts, "2026-07-13")).toHaveLength(0);
  });

  it("IA-003: alertes hors fenêtre 7j glissante ignorées", () => {
    const alerts = [
      alert("2026-07-01"), // hors fenêtre (>7j)
      alert("2026-07-08"),
      alert("2026-07-10"),
    ];
    // Seulement 2 alertes dans la fenêtre [07-07 .. 07-13] → pas d'anomalie.
    expect(detectAgentInactivePattern(alerts, "2026-07-13")).toHaveLength(0);
  });

  it("IA-003: isolation tenant — détecteur ne mélange jamais deux banques sur le même agent", () => {
    const alerts = [
      alert("2026-07-08", { bankId: BANK_A }),
      alert("2026-07-10", { bankId: BANK_B }),
      alert("2026-07-13", { bankId: BANK_A }),
    ];
    // Banque A n'a que 2 jours ; banque B que 1 → aucune n'atteint le seuil 3.
    expect(detectAgentInactivePattern(alerts, "2026-07-13")).toHaveLength(0);
  });
});

describe("SLA_SYSTEMIC (taux SLA sous cible sur fenêtre récurrente)", () => {
  const day = (date: string, slaRate: number, over: Partial<DailySlaRecord> = {}): DailySlaRecord => ({
    bankId: BANK_A,
    agencyId: AGENCY,
    serviceId: SERVICE,
    date,
    slaRate,
    ...over,
  });

  it("IA-003: SLA_SYSTEMIC levé quand taux SLA (REP-001) sous cible sur fenêtre récurrente, taux+cible joints (test)", () => {
    const daily = [
      day("2026-07-09", 0.6),
      day("2026-07-10", 0.65),
      day("2026-07-11", 0.9),
      day("2026-07-12", 0.5),
      day("2026-07-13", 0.95),
    ];
    const [c] = detectSlaSystemic(daily);
    expect(c).toBeDefined();
    expect(c!.type).toBe("SLA_SYSTEMIC");
    const ev = c!.evidence.find((e) => e.metric === "sla_rate")!;
    expect(ev.threshold).toBe(0.8); // cible
    expect(ev.sample).toBe(3); // 3 jours sous cible sur 5
  });

  it("IA-003: SLA_SYSTEMIC NON levé si seulement 2 jours sous cible (<3)", () => {
    const daily = [
      day("2026-07-09", 0.6),
      day("2026-07-10", 0.9),
      day("2026-07-11", 0.9),
      day("2026-07-12", 0.5),
      day("2026-07-13", 0.95),
    ];
    expect(detectSlaSystemic(daily)).toHaveLength(0);
  });

  it("IA-003: SLA_SYSTEMIC seuil de cible surchargeable par banque", () => {
    const daily = [
      day("2026-07-11", 0.85),
      day("2026-07-12", 0.86),
      day("2026-07-13", 0.87),
    ];
    // Défaut 0.8 : tous au-dessus → rien.
    expect(detectSlaSystemic(daily)).toHaveLength(0);
    // Cible relevée à 0.9 : les 3 sous cible → anomalie.
    const th = resolveThresholds({ slaTargetRate: 0.9 });
    expect(detectSlaSystemic(daily, th)).toHaveLength(1);
  });
});

describe("garde-fou — ZÉRO action corrective", () => {
  it("IA-003: AUCUNE action corrective automatique émise (détecteurs purs, sortie descriptive seule)", () => {
    // Les détecteurs ne renvoient QUE des candidats descriptifs : aucune méthode
    // d'action, aucune mutation. On vérifie la forme (pas de champ 'action').
    const [c] = detectQueueStuck([
      {
        bankId: BANK_A,
        agencyId: AGENCY,
        serviceId: SERVICE,
        date: "2026-07-13",
        waitingTickets: 5,
        stuckMinutes: 30,
        countersOpen: 2,
      },
    ]);
    expect(c).toBeDefined();
    expect(Object.keys(c!)).not.toContain("action");
    expect(Object.keys(c!)).not.toContain("remediation");
    expect(c!.description.length).toBeGreaterThan(0);
  });
});
