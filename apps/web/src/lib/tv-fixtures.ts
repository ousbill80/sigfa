/**
 * Simulated TV realtime fixtures (RT-001 keeps sockets inactive).
 * Provides seed state and a scripted stream of ticket:called events so the
 * /tv route renders a realistic display without a live socket.
 * @module lib/tv-fixtures
 */
import type { TvState } from "./tv-state";

/** A seed nominal state used before any simulated event arrives. */
export const TV_SEED_STATE: TvState = {
  hero: {
    ticketNumber: "A047",
    displayNumber: "OC-047",
    counterLabel: "Guichet 3",
    calledAt: "2026-07-11T09:30:00Z",
  },
  previous: [
    { ticketNumber: "A046", displayNumber: "OC-046", counterLabel: "Guichet 1", calledAt: "2026-07-11T09:29:00Z" },
    { ticketNumber: "B012", displayNumber: "OC-012", counterLabel: "Guichet 4", calledAt: "2026-07-11T09:28:00Z" },
    { ticketNumber: "A045", displayNumber: "OC-045", counterLabel: "Guichet 2", calledAt: "2026-07-11T09:27:00Z" },
  ],
  queue: ["OC-048", "OC-049", "OC-050", "OC-051", "OC-052"],
  connection: "connected",
};

const UUID_TICKET = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const UUID_SERVICE = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb";
const UUID_AGENCY = "cccccccc-cccc-4ccc-accc-cccccccccccc";
const UUID_COUNTER = "dddddddd-dddd-4ddd-addd-dddddddddddd";

/**
 * Builds a valid ticket:called payload (contract shape) for the simulator.
 * @param number - Ticket number (ex. "A053").
 * @param counterLabel - Counter label (ex. "Guichet 2").
 * @returns A payload validating against ticketCalledEvent.payloadSchema.
 */
export function simulatedTicketCalled(number: string, counterLabel: string): unknown {
  return {
    ticket: {
      id: UUID_TICKET,
      number,
      status: "CALLED",
      serviceId: UUID_SERVICE,
      agencyId: UUID_AGENCY,
      channel: "KIOSK",
      createdAt: new Date().toISOString(),
    },
    counter: { id: UUID_COUNTER, label: counterLabel },
  };
}

/** A scripted burst of two calls (<500ms apart) for TV-002 queue tests. */
export const TV_BURST_SCRIPT: Array<{ number: string; counterLabel: string }> = [
  { number: "A053", counterLabel: "Guichet 5" },
  { number: "A054", counterLabel: "Guichet 6" },
];
