/**
 * Tests for the browser-safe @sigfa/contracts entry.
 * @module lib/contracts-entry.test
 */
import { describe, it, expect } from "vitest";
import {
  ticketCalledEvent,
  syncStateEvent,
  createSigfaClient,
  SYNC_RECENT_CALLS,
  TICKET_CALLED_SLA_MS,
} from "./contracts-entry";

describe("contracts-entry (browser-safe barrel)", () => {
  it("TV-001: re-exports the realtime event schemas", () => {
    expect(ticketCalledEvent.name).toBe("ticket:called");
    expect(syncStateEvent.name).toBe("sync:state");
  });

  it("TV-002: re-exports CONTRACT-012 constants", () => {
    expect(SYNC_RECENT_CALLS).toBe(4);
    expect(TICKET_CALLED_SLA_MS).toBe(500);
  });

  it("WEB-002: re-exports the typed client factory", () => {
    expect(typeof createSigfaClient).toBe("function");
    const client = createSigfaClient("core", "http://localhost:4010");
    expect(client).toHaveProperty("GET");
    expect(client).toHaveProperty("POST");
  });
});
