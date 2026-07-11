/**
 * Tests for the TV screen state model (TV-001).
 * @module lib/tv-state.test
 */
import { describe, it, expect } from "vitest";
import {
  tvReducer,
  initialTvState,
  parseTicketCalled,
  parseSyncState,
  toDisplayNumber,
  TV_PREVIOUS_COUNT,
  type TvState,
} from "./tv-state";

const UUID_A = "11111111-1111-4111-a111-111111111111";
const UUID_B = "22222222-2222-4222-a222-222222222222";
const UUID_C = "33333333-3333-4333-a333-333333333333";

/** Builds a valid ticket:called payload for a given ticket number/counter. */
function calledPayload(number: string, counterLabel: string, createdAt = "2026-07-11T09:30:00Z"): unknown {
  return {
    ticket: {
      id: UUID_A,
      number,
      status: "CALLED",
      serviceId: UUID_B,
      agencyId: UUID_C,
      channel: "KIOSK",
      createdAt,
    },
    counter: { id: UUID_B, label: counterLabel },
  };
}

describe("toDisplayNumber", () => {
  it("TV-001: formats a ticket number with the agency code prefix", () => {
    expect(toDisplayNumber("A047", "OC")).toBe("OC-047");
  });

  it("TV-001: falls back to the raw number when unparseable", () => {
    expect(toDisplayNumber("???", "OC")).toBe("???");
  });

  it("TV-001: uses the ticket letter when code is empty", () => {
    expect(toDisplayNumber("B012", "")).toBe("B-012");
  });
});

describe("parseTicketCalled", () => {
  it("TV-001: parses a valid ticket:called payload", () => {
    const parsed = parseTicketCalled(calledPayload("A047", "Guichet 3"));
    expect(parsed).not.toBeNull();
    expect(parsed?.ticket.number).toBe("A047");
  });

  it("TV-001: état error — payload Zod invalide retourne null", () => {
    expect(parseTicketCalled({ ticket: { number: 1 } })).toBeNull();
    expect(parseTicketCalled(null)).toBeNull();
    expect(parseTicketCalled({})).toBeNull();
  });
});

describe("tvReducer ticket:called", () => {
  it("TV-001: promotes the called ticket to hero", () => {
    const next = tvReducer(initialTvState, {
      type: "ticket:called",
      payload: calledPayload("A047", "Guichet 3"),
    });
    expect(next.hero?.displayNumber).toBe("GU-047");
    expect(next.hero?.counterLabel).toBe("Guichet 3");
  });

  it("TV-001: pushes the former hero into previous (most recent first)", () => {
    let s: TvState = initialTvState;
    s = tvReducer(s, { type: "ticket:called", payload: calledPayload("A045", "Guichet 1") });
    s = tvReducer(s, { type: "ticket:called", payload: calledPayload("A046", "Guichet 2") });
    s = tvReducer(s, { type: "ticket:called", payload: calledPayload("A047", "Guichet 3") });
    expect(s.hero?.counterLabel).toBe("Guichet 3");
    expect(s.previous.map((p) => p.counterLabel)).toEqual(["Guichet 2", "Guichet 1"]);
  });

  it("TV-001: previous never exceeds TV_PREVIOUS_COUNT", () => {
    let s: TvState = initialTvState;
    for (let i = 1; i <= 6; i++) {
      s = tvReducer(s, { type: "ticket:called", payload: calledPayload(`A00${i}`, `Guichet ${i}`) });
    }
    expect(s.previous).toHaveLength(TV_PREVIOUS_COUNT);
  });

  it("TV-001: état error — payload invalide ignoré, affichage stable", () => {
    const s = tvReducer(initialTvState, {
      type: "ticket:called",
      payload: calledPayload("A047", "Guichet 3"),
    });
    const next = tvReducer(s, { type: "ticket:called", payload: { bogus: true } });
    expect(next).toBe(s);
  });
});

describe("tvReducer sync:state (CONTRACT-012)", () => {
  it("TV-001: rebuilds hero + previous from recentCalls without adding a call", () => {
    const payload: unknown = {
      agencyId: UUID_C,
      queues: [],
      counters: [],
      recentCalls: [
        { ticketNumber: "A047", displayNumber: "OC-047", counterLabel: "Guichet 3", calledAt: "2026-07-11T09:30:00Z" },
        { ticketNumber: "A046", displayNumber: "OC-046", counterLabel: "Guichet 1", calledAt: "2026-07-11T09:29:00Z" },
        { ticketNumber: "B012", displayNumber: "OC-012", counterLabel: "Guichet 4", calledAt: "2026-07-11T09:28:00Z" },
      ],
      timestamp: "2026-07-11T09:30:05Z",
    };
    const next = tvReducer(initialTvState, { type: "sync:state", payload });
    expect(next.hero?.displayNumber).toBe("OC-047");
    expect(next.previous.map((p) => p.displayNumber)).toEqual(["OC-046", "OC-012"]);
  });

  it("TV-001: empty recentCalls yields an empty hero", () => {
    const payload: unknown = {
      agencyId: UUID_C,
      queues: [],
      counters: [],
      recentCalls: [],
      timestamp: "2026-07-11T09:30:05Z",
    };
    const next = tvReducer(initialTvState, { type: "sync:state", payload });
    expect(next.hero).toBeNull();
  });

  it("TV-001: invalid sync:state payload is ignored", () => {
    expect(parseSyncState({})).toBeNull();
    const next = tvReducer(initialTvState, { type: "sync:state", payload: {} });
    expect(next).toBe(initialTvState);
  });
});

describe("tvReducer connection + queue", () => {
  it("TV-001: état offline — connection status flips to offline", () => {
    const next = tvReducer(initialTvState, { type: "connection", status: "offline" });
    expect(next.connection).toBe("offline");
  });

  it("TV-001: queue action replaces the queue list", () => {
    const next = tvReducer(initialTvState, { type: "queue", queue: ["A048", "A049"] });
    expect(next.queue).toEqual(["A048", "A049"]);
  });
});
