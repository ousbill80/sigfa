/**
 * CONTRACT-012 — Tests TDD : sync:state.recentCalls + KIOSK_SYSTEM_ERROR
 *
 * Critères d'acceptation :
 * - CONTRACT-012: recentCalls typé + SYNC_RECENT_CALLS=4 exporté + exemple valide son schéma (tests)
 * - CONTRACT-012: KIOSK_SYSTEM_ERROR dans l'enum + payload d'exemple valide (test)
 * - CONTRACT-012: 219+ tests contracts verts, zéro régression
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

import {
  syncStateEvent,
  alertManagerEvent,
  SYNC_RECENT_CALLS,
} from "./index.js";

// ─── Critère 1 : SYNC_RECENT_CALLS constante exportée ──────────────────────

describe("CONTRACT-012: SYNC_RECENT_CALLS constante exportée", () => {
  it("CONTRACT-012: SYNC_RECENT_CALLS est exporté depuis @sigfa/contracts", () => {
    expect(SYNC_RECENT_CALLS).toBeDefined();
  });

  it("CONTRACT-012: SYNC_RECENT_CALLS vaut 4", () => {
    expect(SYNC_RECENT_CALLS).toBe(4);
  });

  it("CONTRACT-012: SYNC_RECENT_CALLS est un number", () => {
    expect(typeof SYNC_RECENT_CALLS).toBe("number");
  });
});

// ─── Critère 2 : recentCalls dans sync:state.payloadSchema ──────────────────

describe("CONTRACT-012: recentCalls typé dans syncStateEvent.payloadSchema", () => {
  it("CONTRACT-012: sync:state valide un payload avec recentCalls (4 appels récents)", () => {
    const payload = {
      agencyId: "550e8400-e29b-41d4-a716-446655440002",
      queues: [
        {
          queueId: "550e8400-e29b-41d4-a716-446655440005",
          length: 5,
          estimate: 300,
          status: "OPEN",
        },
      ],
      counters: [
        {
          counterId: "550e8400-e29b-41d4-a716-446655440003",
          status: "OPEN",
          agentId: "550e8400-e29b-41d4-a716-446655440004",
        },
      ],
      recentCalls: [
        {
          ticketNumber: "A001",
          displayNumber: "OC-001",
          counterLabel: "Guichet 1",
          calledAt: new Date().toISOString(),
        },
        {
          ticketNumber: "A002",
          displayNumber: "OC-002",
          counterLabel: "Guichet 2",
          calledAt: new Date().toISOString(),
        },
        {
          ticketNumber: "B001",
          displayNumber: "CR-001",
          counterLabel: "Guichet 3",
          calledAt: new Date().toISOString(),
        },
        {
          ticketNumber: "B002",
          displayNumber: "CR-002",
          counterLabel: "Guichet 4",
          calledAt: new Date().toISOString(),
        },
      ],
      timestamp: new Date().toISOString(),
    };
    expect(() => syncStateEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("CONTRACT-012: sync:state valide un payload avec recentCalls vide (reconnexion à chaud)", () => {
    const payload = {
      agencyId: "550e8400-e29b-41d4-a716-446655440002",
      queues: [],
      counters: [],
      recentCalls: [],
      timestamp: new Date().toISOString(),
    };
    expect(() => syncStateEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("CONTRACT-012: sync:state valide un payload avec recentCalls partiel (< 4 éléments)", () => {
    const payload = {
      agencyId: "550e8400-e29b-41d4-a716-446655440002",
      queues: [],
      counters: [],
      recentCalls: [
        {
          ticketNumber: "A001",
          displayNumber: "OC-001",
          counterLabel: "Guichet 1",
          calledAt: new Date().toISOString(),
        },
      ],
      timestamp: new Date().toISOString(),
    };
    expect(() => syncStateEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("CONTRACT-012: chaque recentCall contient ticketNumber (string non vide)", () => {
    const payload = {
      agencyId: "550e8400-e29b-41d4-a716-446655440002",
      queues: [],
      counters: [],
      recentCalls: [
        {
          ticketNumber: "",
          displayNumber: "OC-001",
          counterLabel: "Guichet 1",
          calledAt: new Date().toISOString(),
        },
      ],
      timestamp: new Date().toISOString(),
    };
    expect(() => syncStateEvent.payloadSchema.parse(payload)).toThrow();
  });

  it("CONTRACT-012: chaque recentCall contient displayNumber (string non vide)", () => {
    const payload = {
      agencyId: "550e8400-e29b-41d4-a716-446655440002",
      queues: [],
      counters: [],
      recentCalls: [
        {
          ticketNumber: "A001",
          displayNumber: "",
          counterLabel: "Guichet 1",
          calledAt: new Date().toISOString(),
        },
      ],
      timestamp: new Date().toISOString(),
    };
    expect(() => syncStateEvent.payloadSchema.parse(payload)).toThrow();
  });

  it("CONTRACT-012: chaque recentCall contient counterLabel (string non vide)", () => {
    const payload = {
      agencyId: "550e8400-e29b-41d4-a716-446655440002",
      queues: [],
      counters: [],
      recentCalls: [
        {
          ticketNumber: "A001",
          displayNumber: "OC-001",
          counterLabel: "",
          calledAt: new Date().toISOString(),
        },
      ],
      timestamp: new Date().toISOString(),
    };
    expect(() => syncStateEvent.payloadSchema.parse(payload)).toThrow();
  });

  it("CONTRACT-012: chaque recentCall contient calledAt (datetime ISO 8601)", () => {
    const payload = {
      agencyId: "550e8400-e29b-41d4-a716-446655440002",
      queues: [],
      counters: [],
      recentCalls: [
        {
          ticketNumber: "A001",
          displayNumber: "OC-001",
          counterLabel: "Guichet 1",
          calledAt: "not-a-datetime",
        },
      ],
      timestamp: new Date().toISOString(),
    };
    expect(() => syncStateEvent.payloadSchema.parse(payload)).toThrow();
  });

  it("CONTRACT-012: sync:state.payloadSchema est un ZodType (duck-typing via _def)", () => {
    expect((syncStateEvent.payloadSchema as z.ZodTypeAny)._def).toBeDefined();
  });

  it("CONTRACT-012: SyncStatePayload inféré contient recentCalls avec les 4 champs requis (type-level)", () => {
    type SyncStatePayload = z.infer<typeof syncStateEvent.payloadSchema>;

    // Si recentCalls n'est pas dans le type, TypeScript erreur à la compilation
    const sample: SyncStatePayload = {
      agencyId: "550e8400-e29b-41d4-a716-446655440002",
      queues: [],
      counters: [],
      recentCalls: [
        {
          ticketNumber: "A001",
          displayNumber: "OC-001",
          counterLabel: "Guichet 1",
          calledAt: new Date().toISOString(),
        },
      ],
      timestamp: new Date().toISOString(),
    };

    expect(sample.recentCalls).toHaveLength(1);
    expect(sample.recentCalls[0]?.ticketNumber).toBe("A001");
    expect(sample.recentCalls[0]?.displayNumber).toBe("OC-001");
    expect(sample.recentCalls[0]?.counterLabel).toBe("Guichet 1");
  });
});

// ─── Critère 3 : KIOSK_SYSTEM_ERROR dans alertManagerTypeSchema ─────────────

describe("CONTRACT-012: KIOSK_SYSTEM_ERROR dans alertManagerEvent", () => {
  it("CONTRACT-012: alert:manager accepte le type KIOSK_SYSTEM_ERROR", () => {
    const payload = {
      type: "KIOSK_SYSTEM_ERROR",
      payload: {
        kioskId: "550e8400-e29b-41d4-a716-446655440006",
        agencyId: "550e8400-e29b-41d4-a716-446655440002",
        errorCode: "PRINTER_JAM",
        since: new Date().toISOString(),
      },
    };
    expect(() => alertManagerEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("CONTRACT-012: AlertManagerType contient 5 valeurs (4 existantes + KIOSK_SYSTEM_ERROR)", () => {
    const validTypes = [
      "AGENT_INACTIVE",
      "AGENT_DISCONNECTED_WITH_TICKET",
      "SLA_BREACH",
      "QUEUE_CRITICAL",
      "KIOSK_SYSTEM_ERROR",
    ];
    for (const type of validTypes) {
      const payload = { type, payload: {} };
      expect(
        () => alertManagerEvent.payloadSchema.parse(payload),
        `alert:manager doit accepter le type ${type}`,
      ).not.toThrow();
    }
  });

  it("CONTRACT-012: alert:manager rejette toujours un type inconnu après ajout KIOSK_SYSTEM_ERROR", () => {
    const payload = {
      type: "UNKNOWN_ALERT_TYPE",
      payload: {},
    };
    expect(() => alertManagerEvent.payloadSchema.parse(payload)).toThrow();
  });

  it("CONTRACT-012: alert:manager avec KIOSK_SYSTEM_ERROR accepte un payload contextuel libre", () => {
    const payload = {
      type: "KIOSK_SYSTEM_ERROR",
      payload: {
        kioskId: "550e8400-e29b-41d4-a716-446655440006",
        errorType: "NETWORK_FAILURE",
        retryCount: 3,
      },
    };
    expect(() => alertManagerEvent.payloadSchema.parse(payload)).not.toThrow();
  });
});
