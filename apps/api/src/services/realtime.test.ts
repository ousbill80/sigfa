/**
 * Tests unitaires — API-003 : bus temps réel typé + validation Zod.
 *
 * Couvre le contrat `queue:updated = {length, estimate}` uniquement et la
 * validation stricte des payloads.
 *
 * Nommage : `API-003: <description>`
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  createCaptureBus,
  createNoopBus,
  validateEvent,
  queueUpdatedSchema,
  alertManagerSchema,
} from "src/services/realtime.js";
import { SigfaError } from "src/lib/errors.js";

const QUEUE_ID = "11111111-1111-4111-a111-111111111111";
const TICKET_ID = "22222222-2222-4222-a222-222222222222";
const AGENCY_ID = "33333333-3333-4333-a333-333333333333";
const COUNTER_ID = "44444444-4444-4444-a444-444444444444";

describe("API-003: realtime bus (typé Zod, injectable)", () => {
  it("API-003: queue:updated payload = {length, estimate} uniquement — zéro liste de tickets (contrat Zod)", () => {
    const bus = createCaptureBus();
    bus.emit("queue:updated", { queueId: QUEUE_ID, length: 5, estimate: 40 });
    expect(bus.ofType("queue:updated")).toHaveLength(1);

    // Toute clé supplémentaire (ex: une liste de tickets) → rejet strict
    const withTickets = queueUpdatedSchema.safeParse({
      queueId: QUEUE_ID,
      length: 5,
      estimate: 40,
      tickets: [{ id: TICKET_ID }],
    });
    expect(withTickets.success).toBe(false);
  });

  it("API-003: bus valide chaque payload — ticket:created/called/closed conformes capturés", () => {
    const bus = createCaptureBus();
    bus.emit("ticket:created", {
      ticketId: TICKET_ID,
      queueId: QUEUE_ID,
      agencyId: AGENCY_ID,
      displayNumber: "OC-001",
      status: "WAITING",
    });
    bus.emit("ticket:called", {
      ticketId: TICKET_ID,
      queueId: QUEUE_ID,
      counterId: COUNTER_ID,
      displayNumber: "OC-001",
      status: "CALLED",
    });
    bus.emit("ticket:closed", {
      ticketId: TICKET_ID,
      queueId: QUEUE_ID,
      counterId: COUNTER_ID,
      status: "DONE",
      waitTime: 120,
      serviceTime: 300,
    });
    expect(bus.events.map((e) => e.event)).toEqual([
      "ticket:created",
      "ticket:called",
      "ticket:closed",
    ]);
  });

  it("API-003: payload invalide → SigfaError REALTIME_INVALID_PAYLOAD (jamais d'événement corrompu)", () => {
    expect(() =>
      validateEvent("ticket:created", {
        ticketId: "not-a-uuid",
        queueId: QUEUE_ID,
        agencyId: AGENCY_ID,
        displayNumber: "OC-001",
        status: "WAITING",
      })
    ).toThrowError(SigfaError);
  });

  it("API-003: noop bus valide sans transporter (production sans socket)", () => {
    const bus = createNoopBus();
    expect(() =>
      bus.emit("queue:updated", { queueId: QUEUE_ID, length: 0, estimate: 0 })
    ).not.toThrow();
  });
});

describe("API-007: alert:manager convergé sur la forme contractuelle unique { type, payload }", () => {
  it("API-007: QUEUE_CRITICAL émis en { type, payload } (union héritée supprimée)", () => {
    const bus = createCaptureBus();
    bus.emit("alert:manager", {
      type: "QUEUE_CRITICAL",
      payload: {
        queueId: QUEUE_ID,
        serviceId: "55555555-5555-4555-a555-555555555555",
        length: 12,
        overflowQueueIds: [],
      },
    });
    const alert = bus.ofType("alert:manager")[0]?.payload as {
      type: string;
      payload: Record<string, unknown>;
    };
    expect(alert.type).toBe("QUEUE_CRITICAL");
    expect(alert.payload["queueId"]).toBe(QUEUE_ID);
  });

  it("API-007: les 5 types d'alerte API-007/004/005 sont acceptés sous { type, payload }", () => {
    for (const type of [
      "AGENT_INACTIVE",
      "AGENT_DISCONNECTED_WITH_TICKET",
      "SLA_BREACH",
      "QUEUE_CRITICAL",
      "KIOSK_SYSTEM_ERROR",
    ] as const) {
      expect(
        alertManagerSchema.safeParse({ type, payload: { any: 1 } }).success
      ).toBe(true);
    }
  });

  it("API-007: forme héritée { event: QUEUE_CRITICAL, … } REJETÉE (plus d'union)", () => {
    const legacy = alertManagerSchema.safeParse({
      event: "QUEUE_CRITICAL",
      queueId: QUEUE_ID,
      serviceId: QUEUE_ID,
      length: 3,
      overflowQueueIds: [],
    });
    expect(legacy.success).toBe(false);
    expect(() =>
      validateEvent("alert:manager", {
        event: "QUEUE_CRITICAL",
      } as never)
    ).toThrowError(SigfaError);
  });

  it("API-007: counter:status accepte OPEN|PAUSED|CLOSED (LA LOI CONTRACT-002)", () => {
    const bus = createCaptureBus();
    bus.emit("counter:status", {
      counterId: COUNTER_ID,
      status: "CLOSED",
      agentId: "66666666-6666-4666-a666-666666666666",
    });
    expect(bus.ofType("counter:status")).toHaveLength(1);
    expect(() =>
      validateEvent("counter:status", {
        counterId: COUNTER_ID,
        status: "OFFLINE" as never,
      })
    ).toThrowError(SigfaError);
  });
});

describe("API-011: kiosk:printer-error (CONTRACT-003)", () => {
  it("API-011: kiosk:printer-error valide {kioskId, agencyId, since} et rejette un payload malformé", () => {
    const bus = createCaptureBus();
    bus.emit("kiosk:printer-error", {
      kioskId: "14141414-1414-4141-a141-141414141414",
      agencyId: AGENCY_ID,
      since: "2026-07-12T10:00:00.000Z",
    });
    expect(bus.ofType("kiosk:printer-error")).toHaveLength(1);
    expect(() =>
      validateEvent("kiosk:printer-error", {
        kioskId: "not-a-uuid",
        agencyId: AGENCY_ID,
        since: "2026-07-12T10:00:00.000Z",
      } as never)
    ).toThrowError(SigfaError);
  });
});
