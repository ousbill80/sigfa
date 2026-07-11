/**
 * Manager dashboard state model (WEB-003).
 * SLA colour logic (--danger reserved for SLA breach/alerts), reducer for the
 * dashboard, and contract-validated handlers for queue:updated, counter:status
 * and alert:manager events.
 * @module lib/manager-state
 */
import {
  queueUpdatedEvent,
  counterStatusEvent,
  alertManagerEvent,
  type QueueUpdatedPayload,
  type CounterStatusPayload,
  type AlertManagerPayload,
} from "@sigfa/contracts";

/** Design-System status colour tokens usable for the TMA KPI. */
export type SlaColorToken = "var(--success)" | "var(--warning)" | "var(--danger)";

/**
 * Maps a TMA/SLA ratio to a colour token.
 * `--danger` is used ONLY when the SLA is breached (ratio > 1) — never
 * decorative (Design System §9 / WEB-003).
 * @param ratio - TMA divided by the configured SLA (1 = exactly at SLA).
 * @returns The colour token.
 */
export function slaColor(ratio: number): SlaColorToken {
  if (ratio > 1) return "var(--danger)";
  if (ratio >= 0.8) return "var(--warning)";
  return "var(--success)";
}

/** A single KPI value + unit (mirrors reporting.yaml KpiValue). */
export interface KpiValue {
  /** Numeric value, or null when not computable. */
  value: number | null;
  /** Unit (minutes | percent | score). */
  unit: string;
}

/** The dashboard KPI set consumed from GET /reports/kpis?scope=agency. */
export interface DashboardKpis {
  /** TMA (average wait), minutes. */
  tma: KpiValue;
  /** Abandonment rate, percent. */
  tauxAbandon: KpiValue;
  /** SLA rate, percent. */
  tauxSLA: KpiValue;
  /** NPS, nullable score. */
  nps: number | null;
}

/** Queue-by-service row updated via queue:updated. */
export interface ServiceQueue {
  /** Queue UUID. */
  queueId: string;
  /** Number of waiting tickets. */
  length: number;
  /** Estimated wait, seconds. */
  estimate: number;
}

/** Agent grid row updated via counter:status + alert:manager. */
export interface AgentRow {
  /** Counter UUID. */
  counterId: string;
  /** Counter label. */
  label: string;
  /** Agent display name. */
  agentName: string;
  /** Counter status. */
  status: "OPEN" | "PAUSED" | "CLOSED";
  /** Current ticket number, or null. */
  ticketNumber: string | null;
  /** Whether the agent is flagged by an inactivity/disconnect alert. */
  alerted: boolean;
}

/** A persistent manager alert card. */
export interface ManagerAlert {
  /** Stable id for acknowledgement. */
  id: string;
  /** Alert type. */
  type: AlertManagerPayload["type"];
  /** Optional counter id the alert concerns. */
  counterId?: string;
}

/** Full manager dashboard state. */
export interface ManagerState {
  /** KPI set (null while loading/empty). */
  kpis: DashboardKpis | null;
  /** Configured SLA target in minutes for the TMA colour. */
  slaMinutes: number;
  /** Queue-by-service rows. */
  queues: ServiceQueue[];
  /** Agent grid rows. */
  agents: AgentRow[];
  /** Active alert cards (persistent until acknowledged). */
  alerts: ManagerAlert[];
  /** Connection status. */
  connection: "connected" | "offline";
  /** Last successful sync timestamp (HH:MM), for the offline badge. */
  lastSync: string | null;
}

/** Initial (empty) manager state. */
export const initialManagerState: ManagerState = {
  kpis: null,
  slaMinutes: 15,
  queues: [],
  agents: [],
  alerts: [],
  connection: "connected",
  lastSync: null,
};

/** Actions accepted by the manager reducer. */
export type ManagerAction =
  | { type: "kpis"; kpis: DashboardKpis; lastSync: string }
  | { type: "queue:updated"; payload: unknown }
  | { type: "counter:status"; payload: unknown }
  | { type: "alert:manager"; payload: unknown; id: string }
  | { type: "acknowledge"; id: string }
  | { type: "seed-agents"; agents: AgentRow[] }
  | { type: "connection"; status: "connected" | "offline" };

/** Validates a queue:updated payload against the contract schema. */
export function parseQueueUpdated(raw: unknown): QueueUpdatedPayload | null {
  const r = queueUpdatedEvent.payloadSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Validates a counter:status payload against the contract schema. */
export function parseCounterStatus(raw: unknown): CounterStatusPayload | null {
  const r = counterStatusEvent.payloadSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Validates an alert:manager payload against the contract schema. */
export function parseAlertManager(raw: unknown): AlertManagerPayload | null {
  const r = alertManagerEvent.payloadSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/**
 * Reduces a manager action into the next state.
 * Invalid realtime payloads are ignored (state unchanged).
 * @param state - Current state.
 * @param action - Action to apply.
 * @returns Next state.
 */
export function managerReducer(state: ManagerState, action: ManagerAction): ManagerState {
  switch (action.type) {
    case "kpis":
      return { ...state, kpis: action.kpis, lastSync: action.lastSync };
    case "seed-agents":
      return { ...state, agents: action.agents };
    case "queue:updated": {
      const parsed = parseQueueUpdated(action.payload);
      if (!parsed) return state;
      const others = state.queues.filter((q) => q.queueId !== parsed.queueId);
      return {
        ...state,
        queues: [...others, { queueId: parsed.queueId, length: parsed.length, estimate: parsed.estimate }],
      };
    }
    case "counter:status": {
      const parsed = parseCounterStatus(action.payload);
      if (!parsed) return state;
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.counterId === parsed.counterId ? { ...a, status: parsed.status } : a,
        ),
      };
    }
    case "alert:manager": {
      const parsed = parseAlertManager(action.payload);
      if (!parsed) return state;
      // AGENT_INACTIVE / AGENT_DISCONNECTED_WITH_TICKET flag the agent row red.
      if (parsed.type === "AGENT_INACTIVE" || parsed.type === "AGENT_DISCONNECTED_WITH_TICKET") {
        const counterId = typeof parsed.payload.counterId === "string" ? parsed.payload.counterId : undefined;
        return {
          ...state,
          agents: state.agents.map((a) => (a.counterId === counterId ? { ...a, alerted: true } : a)),
        };
      }
      // SLA_BREACH (and other alerts) → persistent card until acknowledged.
      const counterId = typeof parsed.payload.counterId === "string" ? parsed.payload.counterId : undefined;
      return {
        ...state,
        alerts: [...state.alerts, { id: action.id, type: parsed.type, counterId }],
      };
    }
    case "acknowledge":
      return { ...state, alerts: state.alerts.filter((al) => al.id !== action.id) };
    case "connection":
      return { ...state, connection: action.status };
    default:
      return state;
  }
}

/**
 * Computes the TMA/SLA ratio for colouring, guarding against a zero SLA.
 * @param tmaMinutes - TMA value in minutes (null → 0 ratio).
 * @param slaMinutes - Configured SLA in minutes.
 * @returns The ratio (0 when SLA is not positive).
 */
export function tmaRatio(tmaMinutes: number | null, slaMinutes: number): number {
  if (tmaMinutes === null || slaMinutes <= 0) return 0;
  return tmaMinutes / slaMinutes;
}
