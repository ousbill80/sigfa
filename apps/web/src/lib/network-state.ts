/**
 * Network direction dashboard state model (WEB-004).
 *
 * Badge logic for the agency ranking (--success ≤ SLA, --warning ≤ 2×SLA,
 * --danger > 2×SLA — reserved for real breaches, never decorative; --info when
 * offline), the static Côte d'Ivoire city → SVG coordinate map (Leaflet-free),
 * pagination (20/page keeping the TMA-desc sort), and a reducer for the two
 * simulated realtime events agency:offline / alert:manager validated against the
 * @sigfa/contracts schemas.
 * @module lib/network-state
 */
import {
  agencyOfflineEvent,
  alertManagerEvent,
  type AlertManagerPayload,
} from "@sigfa/contracts";

/** Design-System status colour tokens for the ranking badge. */
export type BadgeToken =
  | "var(--success)"
  | "var(--warning)"
  | "var(--danger)"
  | "var(--info)";

/**
 * Maps a TMA (minutes) to a badge colour token given the SLA target.
 * `--danger` is used ONLY when TMA > 2×SLA (real breach) — never decorative
 * (Design System §9 / WEB-004). An offline agency is always `--info` regardless
 * of its last TMA (degraded state).
 * @param tma - Agency TMA in minutes.
 * @param slaMinutes - Configured SLA target in minutes.
 * @param offline - Whether the agency is currently offline.
 * @returns The badge colour token.
 */
export function benchmarkBadge(
  tma: number,
  slaMinutes: number,
  offline: boolean,
): BadgeToken {
  if (offline) return "var(--info)";
  if (tma <= slaMinutes) return "var(--success)";
  if (tma <= 2 * slaMinutes) return "var(--warning)";
  return "var(--danger)";
}

/** A point in the static Côte d'Ivoire SVG (viewBox 0 0 100 100). */
export interface MapPoint {
  /** X coordinate in the SVG viewBox. */
  x: number;
  /** Y coordinate in the SVG viewBox. */
  y: number;
}

/**
 * Static Côte d'Ivoire city coordinates within the committed SVG map.
 * Approximate positions in a 0–100 viewBox — zero external map dependency
 * (Leaflet excluded, offline-friendly).
 */
export const CI_CITY_COORDINATES: Record<string, MapPoint> = {
  Abidjan: { x: 68, y: 82 },
  Yamoussoukro: { x: 52, y: 58 },
  Bouaké: { x: 55, y: 45 },
  Korhogo: { x: 48, y: 18 },
  "San-Pédro": { x: 33, y: 88 },
  Daloa: { x: 38, y: 52 },
  "Man": { x: 22, y: 48 },
  Gagnoa: { x: 42, y: 66 },
  Abengourou: { x: 78, y: 60 },
};

/**
 * Resolves an agency city to a coordinate in the static CI map.
 * Case-insensitive; returns null for unknown cities (no phantom marker).
 * @param city - The agency city name.
 * @returns The map point, or null if the city is not on the map.
 */
export function cityCoordinate(city: string): MapPoint | null {
  const found = Object.keys(CI_CITY_COORDINATES).find(
    (k) => k.toLowerCase() === city.toLowerCase(),
  );
  return found ? CI_CITY_COORDINATES[found]! : null;
}

/** Page size for the ranking pagination (WEB-004: 20/page). */
export const PAGE_SIZE = 20;

/**
 * Returns the given (1-based) page of an already-sorted agency list.
 * The sort order is preserved because slicing does not reorder.
 * @param sorted - Agencies sorted by TMA descending.
 * @param page - 1-based page number.
 * @returns The page slice (empty array when out of range).
 */
export function paginate<T>(sorted: T[], page: number): T[] {
  const start = (page - 1) * PAGE_SIZE;
  return sorted.slice(start, start + PAGE_SIZE);
}

/** A single agency row in the network ranking. */
export interface NetworkAgency {
  /** Agency UUID. */
  agencyId: string;
  /** Agency display name. */
  agencyName: string;
  /** City used to position the map marker. */
  city: string;
  /** TMA in minutes. */
  tma: number;
  /** SLA rate, percent. */
  tauxSLA: number;
  /** Whether the agency is currently offline (agency:offline). */
  offline: boolean;
}

/** A network alert card, aggregated from every agency of the bank. */
export interface NetworkAlert {
  /** Stable id for the card. */
  id: string;
  /** Alert type (from the contract enum). */
  type: AlertManagerPayload["type"];
  /** Source agency UUID. */
  agencyId: string;
  /** Source agency display name (empty if unknown). */
  agencyName: string;
}

/** Full network dashboard state. */
export interface NetworkState {
  /** Agencies sorted by TMA descending. */
  agencies: NetworkAgency[];
  /** Configured SLA target in minutes for badges. */
  slaMinutes: number;
  /** Aggregated alert cards (source agency identified). */
  alerts: NetworkAlert[];
  /** Connection status (drives the offline/resync banner). */
  connection: "connected" | "offline";
}

/** Initial (empty) network state. */
export const initialNetworkState: NetworkState = {
  agencies: [],
  slaMinutes: 15,
  alerts: [],
  connection: "connected",
};

/** Actions accepted by the network reducer. */
export type NetworkAction =
  | { type: "seed"; agencies: NetworkAgency[]; slaMinutes: number }
  | { type: "agency:offline"; payload: unknown }
  | { type: "alert:manager"; payload: unknown; agencyId: string; id: string }
  | { type: "connection"; status: "connected" | "offline" };

/** Sorts agencies by TMA descending (worst first — direction focus). */
function sortByTmaDesc(agencies: NetworkAgency[]): NetworkAgency[] {
  return [...agencies].sort((a, b) => b.tma - a.tma);
}

/**
 * Reduces a network action into the next state.
 * Invalid realtime payloads (schema mismatch) leave the state unchanged.
 * @param state - Current state.
 * @param action - Action to apply.
 * @returns Next state.
 */
export function networkReducer(state: NetworkState, action: NetworkAction): NetworkState {
  switch (action.type) {
    case "seed":
      return { ...state, agencies: sortByTmaDesc(action.agencies), slaMinutes: action.slaMinutes };
    case "agency:offline": {
      const parsed = agencyOfflineEvent.payloadSchema.safeParse(action.payload);
      if (!parsed.success) return state;
      return {
        ...state,
        agencies: state.agencies.map((a) =>
          a.agencyId === parsed.data.agencyId ? { ...a, offline: true } : a,
        ),
      };
    }
    case "alert:manager": {
      const parsed = alertManagerEvent.payloadSchema.safeParse(action.payload);
      if (!parsed.success) return state;
      const source = state.agencies.find((a) => a.agencyId === action.agencyId);
      return {
        ...state,
        alerts: [
          ...state.alerts,
          {
            id: action.id,
            type: parsed.data.type,
            agencyId: action.agencyId,
            agencyName: source?.agencyName ?? "",
          },
        ],
      };
    }
    case "connection":
      return { ...state, connection: action.status };
    default:
      return state;
  }
}
