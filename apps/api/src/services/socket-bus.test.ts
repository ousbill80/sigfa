/**
 * Tests unitaires — RT-001a : `createSocketBus(io)` = adaptateur bus↔contrat.
 *
 * `emit(event, agencyId, payload)` :
 *  - valide `payload` contre le `payloadSchema` du CONTRAT
 *    (`@sigfa/contracts/events/realtime.js`) ;
 *  - invalide → NON diffusé + log (jamais de throw) ;
 *  - valide → `io.to('agency:'+agencyId).emit(event, payload)`.
 *
 * PARITÉ (AC5) : la validité de CHAQUE payload est vérifiée DIRECTEMENT contre
 * le schéma du contrat importé — le bus diffuse une forme conforme au contrat,
 * prouvé par événement.
 *
 * Nommage strict : `RT-001a: <description>`.
 *
 * @module
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Server } from "socket.io";
import {
  ticketCreatedEvent,
  ticketCalledEvent,
  ticketClosedEvent,
  queueUpdatedEvent,
  counterStatusEvent,
  alertManagerEvent,
  kioskPrinterErrorEvent,
} from "@sigfa/contracts/events/realtime.js";
import { createSocketBus } from "src/services/socket-bus.js";
import { isDisplayEvent, type EventName } from "src/services/realtime.js";
import { logger } from "src/lib/logger.js";

const AGENCY_ID = "00000000-0000-4000-a000-0000000000aa";
const OTHER_ID = "00000000-0000-4000-a000-0000000000bb";

/** Faux `Server` Socket.io : enregistre room ciblée + (event, payload) émis. */
function makeFakeIo(): {
  io: Server;
  toCalls: string[];
  emitCalls: Array<{ event: string; payload: unknown }>;
} {
  const toCalls: string[] = [];
  const emitCalls: Array<{ event: string; payload: unknown }> = [];
  const emitter = {
    emit: (event: string, payload: unknown): boolean => {
      emitCalls.push({ event, payload });
      return true;
    },
  };
  const io = {
    to: (room: string) => {
      toCalls.push(room);
      return emitter;
    },
  } as unknown as Server;
  return { io, toCalls, emitCalls };
}

/** Payloads conformes au contrat, un par événement (forme CONTRAT). */
const CONTRACT_PAYLOADS: Record<EventName, Record<string, unknown>> = {
  "ticket:created": {
    ticket: {
      id: "00000000-0000-4000-a000-000000000001",
      number: "A001",
      status: "WAITING",
      serviceId: "00000000-0000-4000-a000-000000000002",
      agencyId: AGENCY_ID,
      channel: "KIOSK",
      createdAt: "2026-07-12T10:00:00.000Z",
    },
    position: 3,
    estimate: 240,
  },
  "ticket:called": {
    ticket: {
      id: "00000000-0000-4000-a000-000000000001",
      number: "A001",
      status: "CALLED",
      serviceId: "00000000-0000-4000-a000-000000000002",
      agencyId: AGENCY_ID,
      channel: "KIOSK",
      createdAt: "2026-07-12T10:00:00.000Z",
    },
    counter: { id: "00000000-0000-4000-a000-000000000003", label: "Guichet 1" },
  },
  "ticket:closed": {
    ticketId: "00000000-0000-4000-a000-000000000001",
    waitTime: 120,
    serviceTime: 300,
  },
  "queue:updated": {
    queueId: "00000000-0000-4000-a000-000000000004",
    length: 5,
    estimate: 400,
  },
  "counter:status": {
    counterId: "00000000-0000-4000-a000-000000000003",
    status: "OPEN",
    agentId: "00000000-0000-4000-a000-000000000005",
  },
  "alert:manager": {
    type: "QUEUE_CRITICAL",
    payload: { queueId: "00000000-0000-4000-a000-000000000004", length: 12 },
  },
  "kiosk:printer-error": {
    kioskId: "00000000-0000-4000-a000-000000000006",
    agencyId: AGENCY_ID,
    since: "2026-07-12T10:00:00.000Z",
  },
};

/** Table nom→payloadSchema du CONTRAT (source de vérité de la parité). */
const CONTRACT_SCHEMAS = {
  "ticket:created": ticketCreatedEvent.payloadSchema,
  "ticket:called": ticketCalledEvent.payloadSchema,
  "ticket:closed": ticketClosedEvent.payloadSchema,
  "queue:updated": queueUpdatedEvent.payloadSchema,
  "counter:status": counterStatusEvent.payloadSchema,
  "alert:manager": alertManagerEvent.payloadSchema,
  "kiosk:printer-error": kioskPrinterErrorEvent.payloadSchema,
} as const;

const ALL: EventName[] = [
  "ticket:created",
  "ticket:called",
  "ticket:closed",
  "queue:updated",
  "counter:status",
  "alert:manager",
  "kiosk:printer-error",
];

afterEach(() => {
  vi.restoreAllMocks();
});

/** Room attendue par événement (F-SEC-TV-01) : affichage → publique, staff → :staff. */
function expectedRoom(event: EventName, agencyId: string): string {
  return isDisplayEvent(event) ? `agency:${agencyId}` : `agency:${agencyId}:staff`;
}

describe("RT-001a: createSocketBus — adaptateur bus↔contrat (7 événements)", () => {
  it.each(ALL)(
    "RT-001a: %s — diffusé dans la room ségrégée par rôle, payload conforme au payloadSchema du CONTRAT (parité)",
    (event) => {
      const { io, toCalls, emitCalls } = makeFakeIo();
      const errorSpy = vi
        .spyOn(logger, "error")
        .mockImplementation(() => undefined as never);
      const bus = createSocketBus(io);
      const payload = CONTRACT_PAYLOADS[event];

      bus.emit(event, AGENCY_ID, payload as never);

      // Diffusion dans la ROOM SÉGRÉGÉE (F-SEC-TV-01), une seule fois, event correct
      expect(toCalls).toEqual([expectedRoom(event, AGENCY_ID)]);
      expect(emitCalls).toHaveLength(1);
      expect(emitCalls[0]?.event).toBe(event);
      // PARITÉ : le payload diffusé valide le schéma du CONTRAT
      const diffused = emitCalls[0]?.payload;
      expect(CONTRACT_SCHEMAS[event].safeParse(diffused).success).toBe(true);
      // Aucun log d'erreur sur le chemin valide
      expect(errorSpy).not.toHaveBeenCalled();
    }
  );

  // ── F-SEC-TV-01 : ségrégation par rôle — allowlist stricte ──
  it("F-SEC-TV-01: événements d'AFFICHAGE → room publique agency:{id} (DISPLAY inclus)", () => {
    const displayEvents: EventName[] = ["ticket:called", "queue:updated"];
    for (const event of displayEvents) {
      const { io, toCalls } = makeFakeIo();
      const bus = createSocketBus(io);
      bus.emit(event, AGENCY_ID, CONTRACT_PAYLOADS[event] as never);
      expect(toCalls).toEqual([`agency:${AGENCY_ID}`]);
      expect(isDisplayEvent(event)).toBe(true);
    }
  });

  it("F-SEC-TV-01: événements STAFF → room réservée agency:{id}:staff (DISPLAY JAMAIS destinataire)", () => {
    const staffEvents: EventName[] = [
      "ticket:created",
      "ticket:closed",
      "counter:status",
      "alert:manager",
      "kiosk:printer-error",
    ];
    for (const event of staffEvents) {
      const { io, toCalls } = makeFakeIo();
      const bus = createSocketBus(io);
      bus.emit(event, AGENCY_ID, CONTRACT_PAYLOADS[event] as never);
      // JAMAIS diffusé dans la room publique agency:{id} (que rejoint DISPLAY).
      expect(toCalls).toEqual([`agency:${AGENCY_ID}:staff`]);
      expect(toCalls).not.toContain(`agency:${AGENCY_ID}`);
      expect(isDisplayEvent(event)).toBe(false);
    }
  });

  it("F-SEC-TV-01: alert:manager (métriques SLA/agentId) ne part JAMAIS vers la room publique", () => {
    const { io, toCalls, emitCalls } = makeFakeIo();
    const bus = createSocketBus(io);
    bus.emit("alert:manager", AGENCY_ID, {
      type: "AGENT_INACTIVE",
      payload: { agentId: "a1", inactiveMinutes: 12 },
    } as never);
    expect(toCalls).toEqual([`agency:${AGENCY_ID}:staff`]);
    expect(emitCalls).toHaveLength(1);
    expect(emitCalls[0]?.event).toBe("alert:manager");
  });

  it("RT-001a: diffuse dans la room de l'agencyId PASSÉ (2e argument), pas d'un champ du payload", () => {
    const { io, toCalls } = makeFakeIo();
    const bus = createSocketBus(io);
    // agencyId d'émission ≠ agencyId embarqué éventuellement dans le payload
    // (queue:updated = événement d'affichage → room publique).
    bus.emit("queue:updated", OTHER_ID, {
      queueId: "00000000-0000-4000-a000-000000000004",
      length: 1,
      estimate: 2,
    });
    expect(toCalls).toEqual([`agency:${OTHER_ID}`]);
  });

  it("RT-001a: payload invalide (post-validation) → NON diffusé + log, JAMAIS de throw", () => {
    const { io, toCalls, emitCalls } = makeFakeIo();
    const errorSpy = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined as never);
    const bus = createSocketBus(io);

    expect(() =>
      // ticket.id non-uuid, counter.label vide → viole le contrat ticket:called
      bus.emit("ticket:called", AGENCY_ID, {
        ticket: {
          id: "not-a-uuid",
          number: "A001",
          status: "CALLED",
          serviceId: "also-bad",
          agencyId: AGENCY_ID,
          channel: "KIOSK",
          createdAt: "2026-07-12T10:00:00.000Z",
        },
        counter: { id: "00000000-0000-4000-a000-000000000003", label: "" },
      } as never)
    ).not.toThrow();

    expect(toCalls).toEqual([]);
    expect(emitCalls).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("RT-001a: une émission invalide n'empêche pas les émissions valides suivantes", () => {
    const { io, emitCalls } = makeFakeIo();
    vi.spyOn(logger, "error").mockImplementation(() => undefined as never);
    const bus = createSocketBus(io);

    bus.emit("queue:updated", AGENCY_ID, {
      queueId: "bad",
      length: -1,
      estimate: 0,
    } as never);
    bus.emit("queue:updated", AGENCY_ID, {
      queueId: "00000000-0000-4000-a000-000000000004",
      length: 2,
      estimate: 3,
    });

    expect(emitCalls).toHaveLength(1);
    expect(emitCalls[0]?.event).toBe("queue:updated");
  });
});
