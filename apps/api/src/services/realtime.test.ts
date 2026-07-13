/**
 * Tests unitaires — bus temps réel typé + validation Zod (forme CONTRAT).
 *
 * RT-001a : signature `emit(event, agencyId, payload)` ; les `EVENT_SCHEMAS`
 * RÉFÉRENCENT directement le CONTRAT (`*.payloadSchema`, importés tels quels
 * depuis `@sigfa/contracts` — plus de transcription depuis l'unification zod v4).
 * Couvre `queue:updated` (strict {queueId,length,estimate}), la validation par
 * événement, `createNoopBus`/`createCaptureBus` avec l'agencyId capturé.
 *
 * Nommage : `API-003:` / `API-007:` / `API-011:` conservés (non-régression).
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
const SERVICE_ID = "55555555-5555-4555-a555-555555555555";
const AGENT_ID = "66666666-6666-4666-a666-666666666666";

/** Résumé de ticket conforme au contrat. */
function ticketSummary(status: "WAITING" | "CALLED"): Record<string, unknown> {
  return {
    id: TICKET_ID,
    number: "A001",
    status,
    serviceId: SERVICE_ID,
    agencyId: AGENCY_ID,
    channel: "KIOSK",
    createdAt: "2026-07-12T10:00:00.000Z",
  };
}

describe("API-003: realtime bus (typé Zod, injectable, forme CONTRAT)", () => {
  it("API-003: queue:updated payload = {queueId,length,estimate} — zéro liste de tickets", () => {
    const bus = createCaptureBus();
    bus.emit("queue:updated", AGENCY_ID, { queueId: QUEUE_ID, length: 5, estimate: 40 });
    expect(bus.ofType("queue:updated")).toHaveLength(1);
    // L'agencyId d'émission est capturé en 2e position.
    expect(bus.ofType("queue:updated")[0]?.agencyId).toBe(AGENCY_ID);

    // length négatif → rejet
    const bad = queueUpdatedSchema.safeParse({ queueId: QUEUE_ID, length: -1, estimate: 0 });
    expect(bad.success).toBe(false);
  });

  it("API-003: bus valide chaque payload — ticket:created/called/closed (forme contrat) capturés", () => {
    const bus = createCaptureBus();
    bus.emit("ticket:created", AGENCY_ID, {
      ticket: ticketSummary("WAITING"),
      position: 2,
      estimate: 120,
    } as never);
    bus.emit("ticket:called", AGENCY_ID, {
      ticket: ticketSummary("CALLED"),
      counter: { id: COUNTER_ID, label: "Guichet 1" },
    } as never);
    bus.emit("ticket:closed", AGENCY_ID, {
      ticketId: TICKET_ID,
      waitTime: 120,
      serviceTime: 300,
    });
    expect(bus.events.map((e) => e.event)).toEqual([
      "ticket:created",
      "ticket:called",
      "ticket:closed",
    ]);
    expect(bus.events.every((e) => e.agencyId === AGENCY_ID)).toBe(true);
  });

  it("API-003: payload invalide → SigfaError REALTIME_INVALID_PAYLOAD (jamais d'événement corrompu)", () => {
    expect(() =>
      validateEvent("ticket:created", {
        ticket: { ...ticketSummary("WAITING"), id: "not-a-uuid" },
        position: 0,
        estimate: 0,
      } as never)
    ).toThrowError(SigfaError);
  });

  it("API-003: noop bus valide sans transporter (production sans socket)", () => {
    const bus = createNoopBus();
    expect(() =>
      bus.emit("queue:updated", AGENCY_ID, { queueId: QUEUE_ID, length: 0, estimate: 0 })
    ).not.toThrow();
  });
});

describe("API-007: alert:manager convergé sur la forme contractuelle unique { type, payload }", () => {
  it("API-007: QUEUE_CRITICAL émis en { type, payload } (union héritée supprimée)", () => {
    const bus = createCaptureBus();
    bus.emit("alert:manager", AGENCY_ID, {
      type: "QUEUE_CRITICAL",
      payload: { queueId: QUEUE_ID, serviceId: SERVICE_ID, length: 12, overflowQueueIds: [] },
    });
    const captured = bus.ofType("alert:manager")[0];
    const alert = captured?.payload as { type: string; payload: Record<string, unknown> };
    expect(alert.type).toBe("QUEUE_CRITICAL");
    expect(alert.payload["queueId"]).toBe(QUEUE_ID);
    expect(captured?.agencyId).toBe(AGENCY_ID);
  });

  it("API-007: les 5 types d'alerte API-007/004/005 sont acceptés sous { type, payload }", () => {
    for (const type of [
      "AGENT_INACTIVE",
      "AGENT_DISCONNECTED_WITH_TICKET",
      "SLA_BREACH",
      "QUEUE_CRITICAL",
      "KIOSK_SYSTEM_ERROR",
    ] as const) {
      expect(alertManagerSchema.safeParse({ type, payload: { any: 1 } }).success).toBe(true);
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
      validateEvent("alert:manager", { event: "QUEUE_CRITICAL" } as never)
    ).toThrowError(SigfaError);
  });

  it("API-007: counter:status accepte OPEN|PAUSED|CLOSED (LA LOI CONTRACT-002)", () => {
    const bus = createCaptureBus();
    bus.emit("counter:status", AGENCY_ID, {
      counterId: COUNTER_ID,
      status: "CLOSED",
      agentId: AGENT_ID,
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
    bus.emit("kiosk:printer-error", AGENCY_ID, {
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
