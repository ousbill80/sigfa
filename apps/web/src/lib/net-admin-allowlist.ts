/**
 * net-admin-allowlist — client-side allow-list for the Super Admin network
 * console (NET-001-WEB).
 *
 * DOUBLE DEFENCE (R1, PRD "anormal"): the contract `NetworkOverviewResponse`
 * is already an allow-list server-side (`additionalProperties: false`, zero
 * PII). This module re-asserts that boundary on the CLIENT: it whitelists the
 * exact aggregate/counter fields and DROPS every other property — so even if a
 * PII field (phone, tracking_id, feedback, display_number, agent/conseiller
 * name, raw ticket line…) leaked into the payload by mistake, it is never
 * carried into the view model and never rendered. The console shows AGGREGATES
 * and COUNTERS only, never a raw business row.
 *
 * The sanitizer is total (never throws): unexpected shapes degrade to a safe,
 * empty aggregate rather than surfacing untrusted data.
 * @module lib/net-admin-allowlist
 */

/** Aggregated health of a bank's kiosk fleet (feu vert/orange/rouge). */
export type NetworkHealth = "VERT" | "ORANGE" | "ROUGE";

/**
 * Per-bank aggregate, allow-listed. Mirrors the contract `NetworkBankAggregate`
 * (bankId + bankLabel authorised — the platform knows its banks commercially —
 * plus counters only). ZERO PII, zero business content.
 */
export interface NetworkBankRow {
  bankId: string;
  bankLabel: string;
  agencyCount: number;
  kiosksOnline: number;
  kiosksOffline: number;
  totalTickets: number;
  uptimePercent: number | null;
  health: NetworkHealth | null;
}

/**
 * Network-level synthesis, allow-listed. Mirrors the counter fields of the
 * contract `AnonymizedNetworkAggregate` the console surfaces (totals + muted
 * rate + open incidents). No per-agency identity, no PII.
 */
export interface NetworkSynthesis {
  bankCount: number;
  agencyCount: number;
  totalTickets: number;
  kiosksOnline: number;
  kiosksOffline: number;
  /** Global muted-kiosk rate in % (offline / total), derived client-side. */
  mutedRatePercent: number;
  /** Open incidents (counter) — banks whose aggregated health is ROUGE. */
  openIncidents: number;
}

/** Sanitized, render-safe view model for the console. */
export interface NetworkOverviewView {
  period: string;
  generatedAt: string;
  synthesis: NetworkSynthesis;
  banks: NetworkBankRow[];
}

/**
 * The EXHAUSTIVE list of per-bank fields the client is allowed to read. Any
 * property outside this set is a boundary violation and is dropped.
 */
export const BANK_ALLOWED_FIELDS = [
  "bankId",
  "bankLabel",
  "agencyCount",
  "kiosksOnline",
  "kiosksOffline",
  "totalTickets",
  "uptimePercent",
  "health",
] as const;

/**
 * Fields that MUST NEVER appear in the console (PII / business content). Used
 * by the security assertion + tests to prove the boundary. If any of these is
 * present in a raw row, the allow-list drops it — it is never mapped.
 */
export const FORBIDDEN_PII_FIELDS = [
  "phone",
  "phoneHash",
  "trackingId",
  "tracking_id",
  "feedback",
  "displayNumber",
  "display_number",
  "agentName",
  "conseiller",
  "conseillerName",
  "customerName",
  "tickets",
  "ticketList",
] as const;

/** Reads a finite non-negative integer, or a fallback. */
function toCount(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : fallback;
}

/** Reads a percentage in [0,100], or null when absent/invalid. */
function toPercent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

/** Reads a non-empty string, or a fallback. */
function toText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** Coerces the health enum, or null when absent/unknown. */
function toHealth(value: unknown): NetworkHealth | null {
  return value === "VERT" || value === "ORANGE" || value === "ROUGE" ? value : null;
}

/**
 * Maps ONE raw bank object to an allow-listed row, reading ONLY whitelisted
 * fields. Every other property (incl. any PII) is ignored by construction.
 * Returns null when the mandatory identity fields are missing.
 * @param raw - Untrusted object from the response.
 * @returns The safe row, or null.
 */
export function sanitizeBankRow(raw: unknown): NetworkBankRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const bankId = toText(rec["bankId"]);
  const bankLabel = toText(rec["bankLabel"]);
  if (bankId === "" || bankLabel === "") return null;
  return {
    bankId,
    bankLabel,
    agencyCount: toCount(rec["agencyCount"]),
    kiosksOnline: toCount(rec["kiosksOnline"]),
    kiosksOffline: toCount(rec["kiosksOffline"]),
    totalTickets: toCount(rec["totalTickets"]),
    uptimePercent: toPercent(rec["uptimePercent"]),
    health: toHealth(rec["health"]),
  };
}

/** Empty, safe view model — used when the response shape is unusable. */
export function emptyNetworkView(period = "", generatedAt = ""): NetworkOverviewView {
  return {
    period,
    generatedAt,
    synthesis: {
      bankCount: 0,
      agencyCount: 0,
      totalTickets: 0,
      kiosksOnline: 0,
      kiosksOffline: 0,
      mutedRatePercent: 0,
      openIncidents: 0,
    },
    banks: [],
  };
}

/**
 * Sanitizes a raw `network-overview` response into a render-safe view model.
 * Applies the allow-list per bank and derives the network synthesis from the
 * (already whitelisted) rows plus the anonymized aggregate counters. Never
 * throws; an unusable shape yields an empty view.
 * @param raw - Untrusted response body from GET /admin/network-overview.
 * @returns The sanitized {@link NetworkOverviewView}.
 */
export function sanitizeNetworkOverview(raw: unknown): NetworkOverviewView {
  if (typeof raw !== "object" || raw === null) return emptyNetworkView();
  const rec = raw as Record<string, unknown>;
  const period = toText(rec["period"]);
  const generatedAt = toText(rec["generatedAt"]);

  const rawBanks = Array.isArray(rec["banks"]) ? rec["banks"] : [];
  const banks = rawBanks
    .map(sanitizeBankRow)
    .filter((r): r is NetworkBankRow => r !== null);

  // Prefer the server aggregate counters where available (bankCount /
  // agencyCount / totalTickets), otherwise derive from the sanitized rows.
  const aggregate =
    typeof rec["aggregate"] === "object" && rec["aggregate"] !== null
      ? (rec["aggregate"] as Record<string, unknown>)
      : {};

  const kiosksOnline = banks.reduce((s, b) => s + b.kiosksOnline, 0);
  const kiosksOffline = banks.reduce((s, b) => s + b.kiosksOffline, 0);
  const totalKiosks = kiosksOnline + kiosksOffline;
  const openIncidents = banks.filter((b) => b.health === "ROUGE").length;

  const synthesis: NetworkSynthesis = {
    bankCount: toCount(aggregate["bankCount"], banks.length),
    agencyCount: toCount(
      aggregate["agencyCount"],
      banks.reduce((s, b) => s + b.agencyCount, 0),
    ),
    totalTickets: toCount(
      aggregate["totalTickets"],
      banks.reduce((s, b) => s + b.totalTickets, 0),
    ),
    kiosksOnline,
    kiosksOffline,
    mutedRatePercent:
      totalKiosks === 0 ? 0 : Math.round((kiosksOffline / totalKiosks) * 1000) / 10,
    openIncidents,
  };

  return { period, generatedAt, synthesis, banks };
}
