/**
 * TV screen state model — reducer, Zod validation of ticket:called payloads,
 * and derived view model for the full-screen call display.
 * @module lib/tv-state
 *
 * Code contre le mock Prism + événements simulés (RT-001 : sockets réels).
 * Le payload `ticket:called` est validé contre le schéma Zod du contrat
 * CONTRACT-002 ; tout payload invalide est ignoré (affichage stable).
 */
import {
  ticketCalledEvent,
  syncStateEvent,
  type TicketCalledPayload,
  type SyncStatePayload,
} from "@sigfa/contracts";

/** Number of previous calls displayed under the hero (Design System TV-001). */
export const TV_PREVIOUS_COUNT = 3 as const;

/** A single called ticket rendered on the TV screen. */
export interface TvCall {
  /** Human-readable ticket number (ex. "A047"). */
  ticketNumber: string;
  /** Display number shown on the TV in {code}-{NNN} form (ex. "OC-047"). */
  displayNumber: string;
  /** Counter label that called the ticket (ex. "Guichet 3"). */
  counterLabel: string;
  /** ISO 8601 timestamp of the call. */
  calledAt: string;
}

/** Connection status of the (simulated) realtime channel. */
export type TvConnection = "connected" | "offline";

/** Full TV state driving the display. */
export interface TvState {
  /** The current hero call, or null when the agency has no active call. */
  hero: TvCall | null;
  /** Up to {@link TV_PREVIOUS_COUNT} previous calls, most recent first. */
  previous: TvCall[];
  /** Queue of upcoming display numbers waiting to be called. */
  queue: string[];
  /** Connection status of the realtime channel. */
  connection: TvConnection;
}

/** Initial (empty) TV state. */
export const initialTvState: TvState = {
  hero: null,
  previous: [],
  queue: [],
  connection: "connected",
};

/** Actions accepted by the TV reducer. */
export type TvAction =
  | { type: "ticket:called"; payload: unknown }
  | { type: "sync:state"; payload: unknown }
  | { type: "connection"; status: TvConnection }
  | { type: "queue"; queue: string[] };

/**
 * Formats a ticket number into a TV display number.
 * Falls back to the raw number when it does not match the {letter}{digits} shape.
 * @param ticketNumber - Raw ticket number (ex. "A047").
 * @param code - Agency/tenant short code used as prefix (ex. "OC").
 * @returns Display number (ex. "OC-047") or the raw number if unparseable.
 */
export function toDisplayNumber(ticketNumber: string, code: string): string {
  const match = /^([A-Za-z]+)(\d+)$/.exec(ticketNumber.trim());
  if (!match) return ticketNumber;
  const prefix = code.trim() === "" ? match[1]! : code.trim();
  return `${prefix.toUpperCase()}-${match[2]!}`;
}

/**
 * Validates and parses a raw `ticket:called` payload against the contract schema.
 * @param raw - Untrusted payload from the (simulated) socket.
 * @returns The parsed payload, or null if it fails Zod validation.
 */
export function parseTicketCalled(raw: unknown): TicketCalledPayload | null {
  const result = ticketCalledEvent.payloadSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Validates and parses a raw `sync:state` payload against the contract schema.
 * @param raw - Untrusted payload from the (simulated) socket.
 * @returns The parsed payload, or null if it fails Zod validation.
 */
export function parseSyncState(raw: unknown): SyncStatePayload | null {
  const result = syncStateEvent.payloadSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Reduces a TV action into the next TV state.
 *
 * - `ticket:called` with an invalid payload is ignored (state unchanged).
 * - `sync:state` rebuilds the display from `recentCalls[]` without treating it
 *   as a new call (no flash/gong — that concern lives in the view layer).
 *
 * @param state - Current TV state.
 * @param action - Action to apply.
 * @returns Next TV state (same reference when the action is a no-op).
 */
export function tvReducer(state: TvState, action: TvAction): TvState {
  switch (action.type) {
    case "ticket:called": {
      const parsed = parseTicketCalled(action.payload);
      if (!parsed) {
        // Anormal : payload invalide → ignoré, affichage stable.
        return state;
      }
      const call: TvCall = {
        ticketNumber: parsed.ticket.number,
        displayNumber: toDisplayNumber(parsed.ticket.number, parsed.counter.label.slice(0, 2)),
        counterLabel: parsed.counter.label,
        calledAt: parsed.ticket.createdAt,
      };
      const previous = state.hero
        ? [state.hero, ...state.previous].slice(0, TV_PREVIOUS_COUNT)
        : state.previous;
      return { ...state, hero: call, previous };
    }
    case "sync:state": {
      const parsed = parseSyncState(action.payload);
      if (!parsed) return state;
      const calls: TvCall[] = parsed.recentCalls.map((c) => ({
        ticketNumber: c.ticketNumber,
        displayNumber: c.displayNumber,
        counterLabel: c.counterLabel,
        calledAt: c.calledAt,
      }));
      const [hero = null, ...rest] = calls;
      return {
        ...state,
        hero,
        previous: rest.slice(0, TV_PREVIOUS_COUNT),
      };
    }
    case "connection":
      return { ...state, connection: action.status };
    case "queue":
      return { ...state, queue: action.queue };
    default:
      return state;
  }
}
