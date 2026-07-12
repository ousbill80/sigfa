/**
 * CONTRACT-002 — Tests du contrat des événements Socket.io temps réel
 *
 * Chaque test est nommé "CONTRACT-002: <critère>" conformément à la story v2.
 * TDD : ces tests sont écrits AVANT l'implémentation de realtime.ts.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// Import de l'implémentation via le point d'entrée src/index.ts (qui re-exporte events/realtime.ts)
import {
  ticketCreatedEvent,
  ticketCalledEvent,
  ticketClosedEvent,
  counterStatusEvent,
  queueUpdatedEvent,
  agencyOfflineEvent,
  alertManagerEvent,
  kioskPrinterErrorEvent,
  syncRequestEvent,
  syncStateEvent,
  TICKET_CALLED_SLA_MS,
  ALL_EVENTS,
} from "./index.js";

// ─── Types attendus ──────────────────────────────────────────────────────────

type RealtimeEvent<TPayload extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  payloadSchema: TPayload;
  emitter: string;
  consumers: readonly string[];
  room: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertIsRealtimeEvent(evt: unknown, eventName: string): void {
  const e = evt as Record<string, unknown>;
  expect(e, `${eventName} doit exister`).toBeDefined();
  expect(typeof e["name"], `${eventName}.name doit être une string`).toBe(
    "string"
  );
  expect(e["payloadSchema"], `${eventName}.payloadSchema doit être un schéma Zod`).toBeDefined();
  // Vérifier que c'est bien un ZodType (duck-typing via .parse ou ._def)
  expect(
    typeof (e["payloadSchema"] as z.ZodTypeAny).parse,
    `${eventName}.payloadSchema.parse doit être une fonction`
  ).toBe("function");
  expect(typeof e["emitter"], `${eventName}.emitter doit être une string`).toBe(
    "string"
  );
  expect(
    Array.isArray(e["consumers"]),
    `${eventName}.consumers doit être un tableau`
  ).toBe(true);
  expect(typeof e["room"], `${eventName}.room doit être une string`).toBe(
    "string"
  );
}

// ─── Suite 1 : structure de chaque événement ─────────────────────────────────

describe("CONTRACT-002: chaque événement exporte name + payloadSchema Zod + emitter + consumers + room (test parcourant les exports)", () => {
  const events: Array<[string, unknown]> = [
    ["ticketCreatedEvent", ticketCreatedEvent],
    ["ticketCalledEvent", ticketCalledEvent],
    ["ticketClosedEvent", ticketClosedEvent],
    ["counterStatusEvent", counterStatusEvent],
    ["queueUpdatedEvent", queueUpdatedEvent],
    ["agencyOfflineEvent", agencyOfflineEvent],
    ["alertManagerEvent", alertManagerEvent],
    ["kioskPrinterErrorEvent", kioskPrinterErrorEvent],
    ["syncRequestEvent", syncRequestEvent],
    ["syncStateEvent", syncStateEvent],
  ];

  for (const [name, evt] of events) {
    it(`${name} a la structure RealtimeEvent complète`, () => {
      assertIsRealtimeEvent(evt, name);
    });
  }
});

// ─── Suite 2 : inventaire des 8 événements + sync ────────────────────────────

describe("CONTRACT-002: les 8 événements + sync:request/sync:state sont définis (test d'inventaire)", () => {
  it("ticket:created est défini avec le bon name", () => {
    expect(ticketCreatedEvent.name).toBe("ticket:created");
  });

  it("ticket:called est défini avec le bon name", () => {
    expect(ticketCalledEvent.name).toBe("ticket:called");
  });

  it("ticket:closed est défini avec le bon name", () => {
    expect(ticketClosedEvent.name).toBe("ticket:closed");
  });

  it("counter:status est défini avec le bon name", () => {
    expect(counterStatusEvent.name).toBe("counter:status");
  });

  it("queue:updated est défini avec le bon name", () => {
    expect(queueUpdatedEvent.name).toBe("queue:updated");
  });

  it("agency:offline est défini avec le bon name", () => {
    expect(agencyOfflineEvent.name).toBe("agency:offline");
  });

  it("alert:manager est défini avec le bon name", () => {
    expect(alertManagerEvent.name).toBe("alert:manager");
  });

  it("kiosk:printer-error est défini avec le bon name", () => {
    expect(kioskPrinterErrorEvent.name).toBe("kiosk:printer-error");
  });

  it("sync:request est défini avec le bon name", () => {
    expect(syncRequestEvent.name).toBe("sync:request");
  });

  it("sync:state est défini avec le bon name", () => {
    expect(syncStateEvent.name).toBe("sync:state");
  });

  it("ALL_EVENTS contient exactement 11 événements", () => {
    expect(ALL_EVENTS).toHaveLength(11);
    const names = ALL_EVENTS.map((e: RealtimeEvent) => e.name);
    expect(names).toContain("ticket:created");
    expect(names).toContain("ticket:called");
    expect(names).toContain("ticket:closed");
    expect(names).toContain("counter:status");
    expect(names).toContain("queue:updated");
    expect(names).toContain("agency:offline");
    expect(names).toContain("alert:manager");
    expect(names).toContain("kiosk:printer-error");
    expect(names).toContain("sync:request");
    expect(names).toContain("sync:state");
    expect(names).toContain("join:agency");
  });
});

// ─── Suite 3 : constante SLA ─────────────────────────────────────────────────

describe("CONTRACT-002: la constante TICKET_CALLED_SLA_MS = 500 est exportée (test d'inventaire)", () => {
  it("TICKET_CALLED_SLA_MS vaut 500", () => {
    expect(TICKET_CALLED_SLA_MS).toBe(500);
  });

  it("TICKET_CALLED_SLA_MS est un number", () => {
    expect(typeof TICKET_CALLED_SLA_MS).toBe("number");
  });
});

// ─── Suite 4 : validation Zod des payloads d'exemple ─────────────────────────

describe("CONTRACT-002: tout payload d'exemple valide son schéma (test par événement)", () => {
  it("ticket:created valide un payload complet", () => {
    const payload = {
      ticket: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        number: "A001",
        status: "WAITING",
        serviceId: "550e8400-e29b-41d4-a716-446655440001",
        agencyId: "550e8400-e29b-41d4-a716-446655440002",
        channel: "KIOSK",
        createdAt: new Date().toISOString(),
      },
      position: 3,
      estimate: 900,
    };
    expect(() => ticketCreatedEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("ticket:called valide un payload complet", () => {
    const payload = {
      ticket: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        number: "A001",
        status: "CALLED",
        serviceId: "550e8400-e29b-41d4-a716-446655440001",
        agencyId: "550e8400-e29b-41d4-a716-446655440002",
        channel: "KIOSK",
        createdAt: new Date().toISOString(),
      },
      counter: {
        id: "550e8400-e29b-41d4-a716-446655440003",
        label: "Guichet 1",
      },
    };
    expect(() => ticketCalledEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("ticket:closed valide un payload complet", () => {
    const payload = {
      ticketId: "550e8400-e29b-41d4-a716-446655440000",
      waitTime: 300,
      serviceTime: 180,
    };
    expect(() => ticketClosedEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("counter:status valide un payload complet", () => {
    const payload = {
      counterId: "550e8400-e29b-41d4-a716-446655440003",
      status: "OPEN",
      agentId: "550e8400-e29b-41d4-a716-446655440004",
    };
    expect(() => counterStatusEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("counter:status valide un payload sans agentId (optionnel)", () => {
    const payload = {
      counterId: "550e8400-e29b-41d4-a716-446655440003",
      status: "CLOSED",
    };
    expect(() => counterStatusEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("queue:updated valide un payload complet", () => {
    const payload = {
      queueId: "550e8400-e29b-41d4-a716-446655440005",
      length: 12,
      estimate: 720,
    };
    expect(() => queueUpdatedEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("agency:offline valide un payload complet", () => {
    const payload = {
      agencyId: "550e8400-e29b-41d4-a716-446655440002",
      since: new Date().toISOString(),
    };
    expect(() => agencyOfflineEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("alert:manager valide le type AGENT_INACTIVE", () => {
    const payload = {
      type: "AGENT_INACTIVE",
      payload: { agentId: "550e8400-e29b-41d4-a716-446655440004", since: 600 },
    };
    expect(() => alertManagerEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("alert:manager valide le type SLA_BREACH", () => {
    const payload = {
      type: "SLA_BREACH",
      payload: { ticketId: "550e8400-e29b-41d4-a716-446655440000", waitMs: 600000 },
    };
    expect(() => alertManagerEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("alert:manager valide le type AGENT_DISCONNECTED_WITH_TICKET", () => {
    const payload = {
      type: "AGENT_DISCONNECTED_WITH_TICKET",
      payload: {
        agentId: "550e8400-e29b-41d4-a716-446655440004",
        ticketId: "550e8400-e29b-41d4-a716-446655440000",
      },
    };
    expect(() => alertManagerEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("alert:manager valide le type QUEUE_CRITICAL", () => {
    const payload = {
      type: "QUEUE_CRITICAL",
      payload: { queueId: "550e8400-e29b-41d4-a716-446655440005", length: 50 },
    };
    expect(() => alertManagerEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("alert:manager rejette un type inconnu", () => {
    const payload = {
      type: "UNKNOWN_ALERT_TYPE",
      payload: {},
    };
    expect(() => alertManagerEvent.payloadSchema.parse(payload)).toThrow();
  });

  it("kiosk:printer-error valide un payload complet", () => {
    const payload = {
      kioskId: "550e8400-e29b-41d4-a716-446655440006",
      agencyId: "550e8400-e29b-41d4-a716-446655440002",
      since: new Date().toISOString(),
    };
    expect(() => kioskPrinterErrorEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("sync:request valide un payload complet", () => {
    const payload = {
      agencyId: "550e8400-e29b-41d4-a716-446655440002",
    };
    expect(() => syncRequestEvent.payloadSchema.parse(payload)).not.toThrow();
  });

  it("sync:state valide un payload complet", () => {
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
      // CONTRACT-012 : recentCalls ajouté (SYNC_RECENT_CALLS = 4 derniers CALLED)
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

  it("ticket:created rejette un payload invalide (position négative)", () => {
    const payload = {
      ticket: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        number: "A001",
        status: "WAITING",
        serviceId: "550e8400-e29b-41d4-a716-446655440001",
        agencyId: "550e8400-e29b-41d4-a716-446655440002",
        channel: "KIOSK",
        createdAt: new Date().toISOString(),
      },
      position: -1,
      estimate: 900,
    };
    expect(() => ticketCreatedEvent.payloadSchema.parse(payload)).toThrow();
  });
});

// ─── Suite 5 : modèle de rooms ───────────────────────────────────────────────

describe("CONTRACT-002: zéro type manuel — tous z.infer (revue + grep)", () => {
  it("tous les événements utilisent un payloadSchema Zod (duck-typing via _def)", () => {
    const events = [
      ticketCreatedEvent,
      ticketCalledEvent,
      ticketClosedEvent,
      counterStatusEvent,
      queueUpdatedEvent,
      agencyOfflineEvent,
      alertManagerEvent,
      kioskPrinterErrorEvent,
      syncRequestEvent,
      syncStateEvent,
    ];
    for (const evt of events) {
      // ZodType a toujours un _def
      expect(
        (evt.payloadSchema as z.ZodTypeAny)._def,
        `${evt.name}.payloadSchema doit être un ZodType`
      ).toBeDefined();
    }
  });

  it("les rooms utilisent le préfixe agency:{agencyId}", () => {
    // Tous les événements à scope agency ont room = 'agency:{agencyId}'
    const agencyEvents = [
      ticketCreatedEvent,
      ticketCalledEvent,
      ticketClosedEvent,
      counterStatusEvent,
      queueUpdatedEvent,
      agencyOfflineEvent,
      alertManagerEvent,
      kioskPrinterErrorEvent,
      syncRequestEvent,
      syncStateEvent,
    ];
    for (const evt of agencyEvents) {
      expect(
        evt.room,
        `${evt.name}.room doit être 'agency:{agencyId}'`
      ).toBe("agency:{agencyId}");
    }
  });
});

// ─── Suite 6 : typecheck strict ──────────────────────────────────────────────

describe("CONTRACT-002: typecheck strict vert, types consommables depuis @sigfa/contracts", () => {
  it("les types inférés sont cohérents avec les payloads valides", () => {
    // Vérifie que TypeScript infère correctement via z.infer
    type TicketCalledPayload = z.infer<typeof ticketCalledEvent.payloadSchema>;

    const sample: TicketCalledPayload = {
      ticket: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        number: "B002",
        status: "CALLED",
        serviceId: "550e8400-e29b-41d4-a716-446655440001",
        agencyId: "550e8400-e29b-41d4-a716-446655440002",
        channel: "MOBILE",
        createdAt: new Date().toISOString(),
      },
      counter: {
        id: "550e8400-e29b-41d4-a716-446655440003",
        label: "Guichet 2",
      },
    };

    expect(sample.ticket.status).toBe("CALLED");
    expect(sample.counter.label).toBe("Guichet 2");
  });

  it("AlertManagerType est bien énuméré sur 5 valeurs (CONTRACT-012 : ajout KIOSK_SYSTEM_ERROR)", () => {
    const validTypes = [
      "AGENT_INACTIVE",
      "SLA_BREACH",
      "AGENT_DISCONNECTED_WITH_TICKET",
      "QUEUE_CRITICAL",
      "KIOSK_SYSTEM_ERROR",
    ];
    for (const type of validTypes) {
      const payload = { type, payload: {} };
      expect(() => alertManagerEvent.payloadSchema.parse(payload)).not.toThrow();
    }
  });
});
