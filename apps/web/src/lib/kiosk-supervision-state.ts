/**
 * Kiosk supervision state model (ADM-003b).
 *
 * Pure, deterministic helpers + reducer for the kiosk supervision screen:
 * status → Design-System v2 functional token mapping (SILENT = --danger carried
 * as a bordered/dotted pill, NEVER a solid red fill — DS v2 §1/§4), relative
 * "last seen" formatting (injected clock — testable without wall time), status
 * severity ordering (SILENT first — worst on top), per-agency aggregation for
 * the network view, and a reducer applying the contract-validated realtime
 * events (kiosk:silent / kiosk:recovered / kiosk:status). Invalid realtime
 * payloads (schema mismatch) leave the state unchanged.
 * @module lib/kiosk-supervision-state
 */
import {
  kioskSilentEvent,
  kioskRecoveredEvent,
  kioskStatusEvent,
} from "@sigfa/contracts";

/** Supervision status of a single kiosk (aligned with admin.yaml KioskStatus). */
export type KioskStatus = "ONLINE" | "DEGRADED" | "SILENT" | "NEVER_SEEN";

/** Design-System functional colour token for a supervision status. */
export type StatusToken =
  | "var(--success)"
  | "var(--warning)"
  | "var(--danger)"
  | "var(--ink-faint)";

/**
 * Maps a kiosk supervision status to its Design-System functional token.
 * `SILENT` → `--danger` (rendered as a dotted/bordered pill by the component,
 * never a solid red fill). `NEVER_SEEN` is neutral (not a fault). Tokens only.
 * @param status - The kiosk status.
 * @returns The functional colour token.
 */
export function statusToken(status: KioskStatus): StatusToken {
  switch (status) {
    case "ONLINE":
      return "var(--success)";
    case "DEGRADED":
      return "var(--warning)";
    case "SILENT":
      return "var(--danger)";
    case "NEVER_SEEN":
    default:
      return "var(--ink-faint)";
  }
}

/**
 * Severity rank for sorting (higher = worse, surfaced on top).
 * SILENT (alert) > DEGRADED > NEVER_SEEN > ONLINE.
 * @param status - The kiosk status.
 * @returns The severity rank (0..3).
 */
export function statusSeverity(status: KioskStatus): number {
  switch (status) {
    case "SILENT":
      return 3;
    case "DEGRADED":
      return 2;
    case "NEVER_SEEN":
      return 1;
    case "ONLINE":
    default:
      return 0;
  }
}

/** A single kiosk row on the supervision screen. */
export interface SupervisedKiosk {
  /** Kiosk UUID. */
  kioskId: string;
  /** Agency UUID hosting the kiosk. */
  agencyId: string;
  /** Current supervision status. */
  status: KioskStatus;
  /** Last heartbeat ISO timestamp, or null when NEVER_SEEN. */
  lastSeen: string | null;
}

/** Aggregated counters for the network view. */
export interface StatusCounts {
  /** Number of ONLINE kiosks. */
  online: number;
  /** Number of DEGRADED kiosks. */
  degraded: number;
  /** Number of SILENT (muette) kiosks. */
  silent: number;
  /** Number of NEVER_SEEN kiosks. */
  neverSeen: number;
}

/** Per-agency roll-up row for the network view. */
export interface AgencyRollup {
  /** Agency UUID. */
  agencyId: string;
  /** Aggregated counters for this agency. */
  counts: StatusCounts;
  /** Highest severity present in the agency (drives ordering + tone). */
  worst: number;
}

/** Full supervision state. */
export interface KioskSupervisionState {
  /** All supervised kiosks (unsorted; the view orders them). */
  kiosks: SupervisedKiosk[];
  /** Connection status (drives the offline/resync banner). */
  connection: "connected" | "offline";
}

/** Initial (empty) supervision state. */
export const initialKioskSupervisionState: KioskSupervisionState = {
  kiosks: [],
  connection: "connected",
};

/** Actions accepted by the supervision reducer. */
export type KioskSupervisionAction =
  | { type: "seed"; kiosks: SupervisedKiosk[] }
  | { type: "kiosk:silent"; payload: unknown }
  | { type: "kiosk:recovered"; payload: unknown }
  | { type: "kiosk:status"; payload: unknown }
  | { type: "connection"; status: "connected" | "offline" };

/** Upserts a kiosk (status + lastSeen) into the list, keyed by kioskId. */
function upsert(
  kiosks: SupervisedKiosk[],
  next: SupervisedKiosk,
): SupervisedKiosk[] {
  const idx = kiosks.findIndex((k) => k.kioskId === next.kioskId);
  if (idx === -1) return [...kiosks, next];
  const copy = [...kiosks];
  copy[idx] = { ...copy[idx]!, ...next };
  return copy;
}

/**
 * Reduces a supervision action into the next state.
 * Realtime payloads are validated against the @sigfa/contracts schemas; an
 * invalid payload leaves the state unchanged (no partial mutation).
 * @param state - Current state.
 * @param action - Action to apply.
 * @returns Next state.
 */
export function kioskSupervisionReducer(
  state: KioskSupervisionState,
  action: KioskSupervisionAction,
): KioskSupervisionState {
  switch (action.type) {
    case "seed":
      return { ...state, kiosks: action.kiosks };
    case "kiosk:silent": {
      const parsed = kioskSilentEvent.payloadSchema.safeParse(action.payload);
      if (!parsed.success) return state;
      const { kioskId, agencyId, since } = parsed.data;
      return {
        ...state,
        kiosks: upsert(state.kiosks, {
          kioskId,
          agencyId,
          status: "SILENT",
          lastSeen: since,
        }),
      };
    }
    case "kiosk:recovered": {
      const parsed = kioskRecoveredEvent.payloadSchema.safeParse(action.payload);
      if (!parsed.success) return state;
      const { kioskId, agencyId, status, since } = parsed.data;
      return {
        ...state,
        kiosks: upsert(state.kiosks, { kioskId, agencyId, status, lastSeen: since }),
      };
    }
    case "kiosk:status": {
      const parsed = kioskStatusEvent.payloadSchema.safeParse(action.payload);
      if (!parsed.success) return state;
      const { kioskId, agencyId, status, since } = parsed.data;
      return {
        ...state,
        kiosks: upsert(state.kiosks, { kioskId, agencyId, status, lastSeen: since }),
      };
    }
    case "connection":
      return { ...state, connection: action.status };
    default:
      return state;
  }
}

/**
 * Orders kiosks for the agency view: worst severity first (SILENT on top),
 * ties broken by oldest lastSeen (the most concerning). Pure (no mutation).
 * @param kiosks - The kiosks to order.
 * @returns A new, ordered array.
 */
export function orderBySeverity(kiosks: SupervisedKiosk[]): SupervisedKiosk[] {
  return [...kiosks].sort((a, b) => {
    const sev = statusSeverity(b.status) - statusSeverity(a.status);
    if (sev !== 0) return sev;
    const ta = a.lastSeen ? Date.parse(a.lastSeen) : Number.POSITIVE_INFINITY;
    const tb = b.lastSeen ? Date.parse(b.lastSeen) : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
}

/**
 * Counts kiosks by status.
 * @param kiosks - The kiosks to aggregate.
 * @returns The status counters.
 */
export function countStatuses(kiosks: SupervisedKiosk[]): StatusCounts {
  const counts: StatusCounts = { online: 0, degraded: 0, silent: 0, neverSeen: 0 };
  for (const k of kiosks) {
    if (k.status === "ONLINE") counts.online += 1;
    else if (k.status === "DEGRADED") counts.degraded += 1;
    else if (k.status === "SILENT") counts.silent += 1;
    else counts.neverSeen += 1;
  }
  return counts;
}

/**
 * Number of active alerts (SILENT kiosks) — surfaced as a counter in the header.
 * @param kiosks - The kiosks to inspect.
 * @returns The count of SILENT kiosks.
 */
export function activeAlertCount(kiosks: SupervisedKiosk[]): number {
  return kiosks.filter((k) => k.status === "SILENT").length;
}

/**
 * Rolls kiosks up per agency for the network view, ordered by severity
 * descending (agencies with SILENT kiosks first). Only agencies with at least
 * one non-ONLINE kiosk keep a non-zero `worst`, but every agency is returned.
 * @param kiosks - All supervised kiosks.
 * @returns Per-agency roll-ups, worst-first.
 */
export function rollupByAgency(kiosks: SupervisedKiosk[]): AgencyRollup[] {
  const byAgency = new Map<string, SupervisedKiosk[]>();
  for (const k of kiosks) {
    const list = byAgency.get(k.agencyId) ?? [];
    list.push(k);
    byAgency.set(k.agencyId, list);
  }
  const rows: AgencyRollup[] = [];
  for (const [agencyId, list] of byAgency) {
    const worst = list.reduce((m, k) => Math.max(m, statusSeverity(k.status)), 0);
    rows.push({ agencyId, counts: countStatuses(list), worst });
  }
  return rows.sort((a, b) => b.worst - a.worst);
}

/**
 * Formats a relative "last seen" duration from an ISO timestamp and an injected
 * "now" clock (deterministic — no wall clock in tests). Returns null when the
 * kiosk was never seen (no timestamp).
 * @param lastSeen - The last heartbeat ISO timestamp, or null.
 * @param nowMs - The current time in epoch milliseconds (injected).
 * @param locale - "fr" or "en".
 * @returns A short relative string (e.g. "il y a 12 s"), or null.
 */
export function relativeLastSeen(
  lastSeen: string | null,
  nowMs: number,
  locale: "fr" | "en",
): string | null {
  if (!lastSeen) return null;
  const then = Date.parse(lastSeen);
  if (Number.isNaN(then)) return null;
  const deltaSec = Math.max(0, Math.round((nowMs - then) / 1000));
  const fr = locale === "fr";
  if (deltaSec < 60) {
    return fr ? `il y a ${deltaSec} s` : `${deltaSec}s ago`;
  }
  const min = Math.floor(deltaSec / 60);
  if (min < 60) {
    return fr ? `il y a ${min} min` : `${min}min ago`;
  }
  const hours = Math.floor(min / 60);
  if (hours < 24) {
    return fr ? `il y a ${hours} h` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return fr ? `il y a ${days} j` : `${days}d ago`;
}
