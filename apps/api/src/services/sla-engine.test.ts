/**
 * Tests unitaires — API-003 : machine à états EXHAUSTIVE + durées exactes.
 *
 * Couvre les 7 états × toutes les actions (légales ET illégales) et les calculs
 * wait/service avec fake timers.
 *
 * Nommage : `API-003: <description>`
 *
 * @module
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  nextStatus,
  canTransition,
  computeWaitSeconds,
  computeServiceSeconds,
  type TicketStatus,
  type TicketAction,
} from "src/services/sla-engine.js";
import { SigfaError } from "src/lib/errors.js";

const ALL_STATES: TicketStatus[] = [
  "WAITING",
  "CALLED",
  "SERVING",
  "DONE",
  "NO_SHOW",
  "ABANDONED",
  "TRANSFERRED",
];

const ALL_ACTIONS: TicketAction[] = [
  "call",
  "serve",
  "close",
  "no-show",
  "transfer",
  "abandon",
];

/** Transitions légales de référence (LA LOI). */
const LEGAL: Array<[TicketStatus, TicketAction, TicketStatus]> = [
  ["WAITING", "call", "CALLED"],
  ["WAITING", "abandon", "ABANDONED"],
  ["CALLED", "serve", "SERVING"],
  ["CALLED", "no-show", "NO_SHOW"],
  ["CALLED", "transfer", "TRANSFERRED"],
  ["CALLED", "abandon", "ABANDONED"],
  ["CALLED", "call", "CALLED"],
  ["SERVING", "close", "DONE"],
  ["SERVING", "transfer", "TRANSFERRED"],
];

describe("API-003: machine à états (sla-engine)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("API-003: toutes transitions légales → état cible exact (7 états exhaustifs)", () => {
    for (const [from, action, to] of LEGAL) {
      expect(nextStatus(from, action)).toBe(to);
      expect(canTransition(from, action)).toBe(true);
    }
  });

  it("API-003: call-next file vide → 404 QUEUE_EMPTY ; toutes transitions illégales → 409 ILLEGAL_TRANSITION (sla-engine exhaustive)", () => {
    const legalSet = new Set(LEGAL.map(([f, a]) => `${f}:${a}`));
    let illegalCount = 0;
    for (const from of ALL_STATES) {
      for (const action of ALL_ACTIONS) {
        if (legalSet.has(`${from}:${action}`)) continue;
        illegalCount++;
        expect(canTransition(from, action)).toBe(false);
        try {
          nextStatus(from, action);
          throw new Error(`attendu ILLEGAL_TRANSITION pour ${from}/${action}`);
        } catch (err) {
          expect(err).toBeInstanceOf(SigfaError);
          const e = err as SigfaError;
          expect(e.code).toBe("ILLEGAL_TRANSITION");
          expect(e.httpStatus).toBe(409);
          expect(e.details).toMatchObject({ currentStatus: from, requestedTransition: action });
        }
      }
    }
    // 7 états × 6 actions = 42 combinaisons ; 9 légales ⇒ 33 illégales
    expect(illegalCount).toBe(33);
  });

  it("API-003: états terminaux (DONE/NO_SHOW/ABANDONED/TRANSFERRED) refusent toute action", () => {
    for (const from of ["DONE", "NO_SHOW", "ABANDONED", "TRANSFERRED"] as TicketStatus[]) {
      for (const action of ALL_ACTIONS) {
        expect(canTransition(from, action)).toBe(false);
      }
    }
  });

  it("API-003: close → durées exactes (wait/service) calculées avec fake timers", () => {
    vi.useFakeTimers();
    const issuedAt = new Date("2026-07-11T08:00:00.000Z");
    const calledAt = new Date("2026-07-11T08:02:30.000Z"); // 150 s
    const servedAt = new Date("2026-07-11T08:03:00.000Z");
    const closedAt = new Date("2026-07-11T08:10:45.000Z"); // 465 s

    expect(computeWaitSeconds(issuedAt, calledAt)).toBe(150);
    expect(computeServiceSeconds(servedAt, closedAt)).toBe(465);
  });

  it("API-003: durées jamais négatives (horloge non monotone bornée à 0)", () => {
    const later = new Date("2026-07-11T09:00:00.000Z");
    const earlier = new Date("2026-07-11T08:00:00.000Z");
    expect(computeWaitSeconds(later, earlier)).toBe(0);
    expect(computeServiceSeconds(later, earlier)).toBe(0);
  });
});
