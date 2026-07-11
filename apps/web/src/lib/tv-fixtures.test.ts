/**
 * Tests for TV simulation fixtures (TV-001).
 * @module lib/tv-fixtures.test
 */
import { describe, it, expect } from "vitest";
import { TV_SEED_STATE, simulatedTicketCalled, TV_BURST_SCRIPT } from "./tv-fixtures";
import { parseTicketCalled, TV_PREVIOUS_COUNT } from "./tv-state";

describe("TV fixtures", () => {
  it("TV-001: seed state has a hero and at most TV_PREVIOUS_COUNT previous calls", () => {
    expect(TV_SEED_STATE.hero).not.toBeNull();
    expect(TV_SEED_STATE.previous.length).toBeLessThanOrEqual(TV_PREVIOUS_COUNT);
    expect(TV_SEED_STATE.connection).toBe("connected");
  });

  it("TV-001: simulatedTicketCalled produces a contract-valid payload", () => {
    const payload = simulatedTicketCalled("A053", "Guichet 5");
    const parsed = parseTicketCalled(payload);
    expect(parsed).not.toBeNull();
    expect(parsed?.ticket.number).toBe("A053");
    expect(parsed?.counter.label).toBe("Guichet 5");
  });

  it("TV-002: burst script contains two calls", () => {
    expect(TV_BURST_SCRIPT).toHaveLength(2);
  });
});
