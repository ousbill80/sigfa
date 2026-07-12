/**
 * Tests unitaires — API-006 : émetteur typé `emitTicketCalled` (validation Zod).
 *
 * Critère d'acceptation #2 : « payload non conforme → événement bloqué + log ».
 * Test PUR (pas de Testcontainers) : on injecte un faux `Server` Socket.io et on
 * espionne `logger.error` pour prouver que le payload violant le schéma est
 * bloqué (aucun émit) tandis qu'un payload valide est bien émis dans la room.
 *
 * Couvre socket-server.ts lignes 302-315 (branche safeParse-fail + branche succès).
 *
 * Nommage strict : `API-006: <description>`.
 *
 * @module
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Server } from "socket.io";
import { emitTicketCalled } from "src/services/socket-server.js";
import { logger } from "src/lib/logger.js";

const AGENCY_ID = "00000000-0000-4000-a000-0000000000aa";

/** Payload STRICTEMENT conforme à ticketCalledPayloadSchema. */
function validPayload(): Record<string, unknown> {
  return {
    ticket: {
      id: "00000000-0000-4000-a000-000000000001",
      number: "T001",
      status: "CALLED",
      serviceId: "00000000-0000-4000-a000-000000000002",
      agencyId: AGENCY_ID,
      channel: "KIOSK",
      createdAt: new Date().toISOString(),
    },
    counter: { id: "00000000-0000-4000-a000-000000000003", label: "G1" },
  };
}

/**
 * Construit un faux `Server` Socket.io minimal : `io.to(room).emit(event, payload)`.
 * Enregistre les appels pour assertion (room ciblée, event, payload).
 */
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API-006: emitTicketCalled — validation Zod du payload", () => {
  it(
    "API-006: payload VALIDE → émet ticket:called dans agency:{id}, aucun logger.error",
    () => {
      const { io, toCalls, emitCalls } = makeFakeIo();
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(
        () => undefined as never
      );

      emitTicketCalled(io, AGENCY_ID, validPayload());

      // Événement émis exactement une fois dans la bonne room
      expect(toCalls).toEqual([`agency:${AGENCY_ID}`]);
      expect(emitCalls).toHaveLength(1);
      expect(emitCalls[0]?.event).toBe("ticket:called");
      // Chemin d'erreur NON pris
      expect(errorSpy).not.toHaveBeenCalled();
    }
  );

  it(
    "API-006: payload NON conforme (schéma violé) → événement bloqué + logger.error",
    () => {
      const { io, toCalls, emitCalls } = makeFakeIo();
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(
        () => undefined as never
      );

      // Viole le schéma : ticket.id n'est pas un uuid, counter.label vide,
      // et createdAt absent → safeParse échoue.
      const invalidPayload = {
        ticket: {
          id: "not-a-uuid",
          number: "",
          status: "CALLED",
          serviceId: "also-not-a-uuid",
          agencyId: AGENCY_ID,
          channel: "KIOSK",
        },
        counter: { id: "00000000-0000-4000-a000-000000000003", label: "" },
      };

      emitTicketCalled(io, AGENCY_ID, invalidPayload);

      // AUCUN événement émis : ni ciblage de room, ni emit
      expect(toCalls).toEqual([]);
      expect(emitCalls).toEqual([]);
      // Le chemin de log d'erreur EST pris, avec le bon message
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [meta, msg] = errorSpy.mock.calls[0] ?? [];
      expect(msg).toBe("socket:emit:ticket:called:invalid-payload");
      expect(meta).toMatchObject({ agencyId: AGENCY_ID });
      expect(Array.isArray((meta as { issues?: unknown[] }).issues)).toBe(true);
    }
  );

  it(
    "API-006: payload complètement absent (undefined) → bloqué + logger.error",
    () => {
      const { io, toCalls, emitCalls } = makeFakeIo();
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(
        () => undefined as never
      );

      emitTicketCalled(io, AGENCY_ID, undefined);

      expect(toCalls).toEqual([]);
      expect(emitCalls).toEqual([]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[1]).toBe(
        "socket:emit:ticket:called:invalid-payload"
      );
    }
  );
});
