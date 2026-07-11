/**
 * Tests for the manager dashboard state model (WEB-003).
 * @module lib/manager-state.test
 */
import { describe, it, expect } from "vitest";
import {
  slaColor,
  tmaRatio,
  managerReducer,
  initialManagerState,
  parseQueueUpdated,
  parseCounterStatus,
  parseAlertManager,
  type ManagerState,
  type AgentRow,
} from "./manager-state";

const QUEUE_ID = "13131313-1313-4131-a131-131313131313";
const COUNTER_ID = "cccccccc-cccc-4ccc-accc-cccccccccccc";
const AGENT_ID = "66666666-6666-4666-a666-666666666666";

const agents: AgentRow[] = [
  { counterId: COUNTER_ID, label: "Guichet 1", agentName: "Koné A.", status: "OPEN", ticketNumber: "A047", alerted: false },
];

describe("slaColor — --danger réservé au dépassement SLA", () => {
  it("WEB-003: ratio < 0.8 → --success", () => {
    expect(slaColor(0.5)).toBe("var(--success)");
  });
  it("WEB-003: 0.8 ≤ ratio ≤ 1 → --warning", () => {
    expect(slaColor(0.8)).toBe("var(--warning)");
    expect(slaColor(1)).toBe("var(--warning)");
  });
  it("WEB-003: ratio > 1 (dépassement SLA) → --danger", () => {
    expect(slaColor(1.01)).toBe("var(--danger)");
    expect(slaColor(2)).toBe("var(--danger)");
  });
  it("WEB-003: --danger jamais rendu en deçà du SLA", () => {
    for (const r of [0, 0.3, 0.79, 0.8, 0.99, 1]) {
      expect(slaColor(r)).not.toBe("var(--danger)");
    }
  });
});

describe("tmaRatio", () => {
  it("WEB-003: calcule TMA/SLA", () => {
    expect(tmaRatio(12, 15)).toBeCloseTo(0.8);
    expect(tmaRatio(18, 15)).toBeCloseTo(1.2);
  });
  it("WEB-003: SLA nul ou TMA null → ratio 0 (pas de 0 trompeur en danger)", () => {
    expect(tmaRatio(null, 15)).toBe(0);
    expect(tmaRatio(10, 0)).toBe(0);
  });
});

describe("managerReducer — queue:updated", () => {
  it("WEB-003: met à jour la file par service sans rechargement", () => {
    const payload = { queueId: QUEUE_ID, length: 12, estimate: 1440 };
    const next = managerReducer(initialManagerState, { type: "queue:updated", payload });
    expect(next.queues).toHaveLength(1);
    expect(next.queues[0]).toMatchObject({ queueId: QUEUE_ID, length: 12 });
  });
  it("WEB-003: remplace la file existante (pas de doublon)", () => {
    let s = managerReducer(initialManagerState, { type: "queue:updated", payload: { queueId: QUEUE_ID, length: 12, estimate: 1440 } });
    s = managerReducer(s, { type: "queue:updated", payload: { queueId: QUEUE_ID, length: 5, estimate: 600 } });
    expect(s.queues).toHaveLength(1);
    expect(s.queues[0]?.length).toBe(5);
  });
  it("WEB-003: payload invalide ignoré", () => {
    expect(parseQueueUpdated({})).toBeNull();
    const next = managerReducer(initialManagerState, { type: "queue:updated", payload: {} });
    expect(next).toBe(initialManagerState);
  });
});

describe("managerReducer — counter:status", () => {
  it("WEB-003: met à jour le statut de l'agent dans la grille", () => {
    const seeded: ManagerState = { ...initialManagerState, agents };
    const payload = { counterId: COUNTER_ID, status: "PAUSED", agentId: AGENT_ID };
    const next = managerReducer(seeded, { type: "counter:status", payload });
    expect(next.agents[0]?.status).toBe("PAUSED");
  });
  it("WEB-003: payload invalide ignoré", () => {
    expect(parseCounterStatus({ counterId: "x" })).toBeNull();
  });
});

describe("managerReducer — alert:manager", () => {
  it("WEB-003: SLA_BREACH → card persistante", () => {
    const payload = { type: "SLA_BREACH", payload: { counterId: COUNTER_ID } };
    const next = managerReducer(initialManagerState, { type: "alert:manager", payload, id: "a1" });
    expect(next.alerts).toHaveLength(1);
    expect(next.alerts[0]).toMatchObject({ id: "a1", type: "SLA_BREACH" });
  });
  it("WEB-003: acquittement retire la card", () => {
    const payload = { type: "SLA_BREACH", payload: {} };
    let s = managerReducer(initialManagerState, { type: "alert:manager", payload, id: "a1" });
    s = managerReducer(s, { type: "acknowledge", id: "a1" });
    expect(s.alerts).toHaveLength(0);
  });
  it("WEB-003: AGENT_INACTIVE → ligne grille en alerte (rouge)", () => {
    const seeded: ManagerState = { ...initialManagerState, agents };
    const payload = { type: "AGENT_INACTIVE", payload: { counterId: COUNTER_ID } };
    const next = managerReducer(seeded, { type: "alert:manager", payload, id: "a2" });
    expect(next.agents[0]?.alerted).toBe(true);
    // pas de card pour une alerte agent
    expect(next.alerts).toHaveLength(0);
  });
  it("WEB-003: AGENT_DISCONNECTED_WITH_TICKET → ligne en alerte", () => {
    const seeded: ManagerState = { ...initialManagerState, agents };
    const payload = { type: "AGENT_DISCONNECTED_WITH_TICKET", payload: { counterId: COUNTER_ID } };
    const next = managerReducer(seeded, { type: "alert:manager", payload, id: "a3" });
    expect(next.agents[0]?.alerted).toBe(true);
  });
  it("WEB-003: payload d'alerte invalide ignoré", () => {
    expect(parseAlertManager({ type: "NOPE", payload: {} })).toBeNull();
    const next = managerReducer(initialManagerState, { type: "alert:manager", payload: { type: "NOPE" }, id: "x" });
    expect(next).toBe(initialManagerState);
  });
});

describe("managerReducer — connection & kpis", () => {
  it("WEB-003: offline fige la connexion", () => {
    const next = managerReducer(initialManagerState, { type: "connection", status: "offline" });
    expect(next.connection).toBe("offline");
  });
  it("WEB-003: kpis met à jour les valeurs + lastSync", () => {
    const kpis = {
      tma: { value: 12, unit: "minutes" },
      tauxAbandon: { value: 4, unit: "percent" },
      tauxSLA: { value: 87, unit: "percent" },
      nps: 42,
    };
    const next = managerReducer(initialManagerState, { type: "kpis", kpis, lastSync: "14:37" });
    expect(next.kpis?.tma.value).toBe(12);
    expect(next.lastSync).toBe("14:37");
  });
  it("WEB-003: seed-agents initialise la grille", () => {
    const next = managerReducer(initialManagerState, { type: "seed-agents", agents });
    expect(next.agents).toHaveLength(1);
  });
});
