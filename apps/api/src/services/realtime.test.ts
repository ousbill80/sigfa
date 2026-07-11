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
