/**
 * agent-status — machine à états de disponibilité de l'agent (API-007).
 *
 * LA LOI (agents.yaml §164, AgentStatus) : 5 états
 * AVAILABLE / SERVING / PAUSED / ABSENT / OFFLINE.
 *
 * Transitions LÉGALES (contrat) :
 *   AVAILABLE ↔ SERVING · AVAILABLE ↔ PAUSED · AVAILABLE ↔ ABSENT ·
 *   AVAILABLE ↔ OFFLINE.
 * Toute autre transition → 409 `ILLEGAL_AGENT_TRANSITION` (avec statut courant
 * et statut demandé dans `details`).
 *
 * Règles métier API-007 :
 *  - SERVING est PILOTÉ par le cycle ticket (serve → SERVING, close/no-show →
 *    AVAILABLE) : un forçage manuel vers SERVING via l'API est REFUSÉ (409).
 *  - SERVING → ABSENT/OFFLINE/PAUSED avec ticket ouvert non transféré → 409.
 *
 * Le statut COURANT de l'agent est dérivé de la dernière ligne
 * `agent_status_history.to_status` (aucune colonne `users.status` — DB inchangée).
 * `counter:status` (LA LOI CONTRACT-002, OPEN|PAUSED|CLOSED) est émis à chaque
 * transition : AVAILABLE/SERVING→OPEN, PAUSED→PAUSED, ABSENT/OFFLINE→CLOSED.
 *
 * @module
 */

import type { Client, PoolClient } from "pg";
import { SigfaError } from "src/lib/errors.js";
import type { RealtimeBus } from "src/services/realtime.js";

/** Client PG (connexion ou transaction). */
type Db = Client | PoolClient;

/** Les 5 états de disponibilité de l'agent (LA LOI AgentStatus). */
export type AgentStatus =
  | "AVAILABLE"
  | "SERVING"
  | "PAUSED"
  | "ABSENT"
  | "OFFLINE";

/** Statut de départ par défaut d'un agent jamais journalisé. */
export const DEFAULT_AGENT_STATUS: AgentStatus = "OFFLINE";

/**
 * Transitions légales manuelles (via l'API) : source → cibles autorisées.
 * SERVING n'est JAMAIS une cible manuelle (piloté par le ticket).
 */
const MANUAL_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  AVAILABLE: ["PAUSED", "ABSENT", "OFFLINE"],
  SERVING: ["AVAILABLE"],
  PAUSED: ["AVAILABLE"],
  ABSENT: ["AVAILABLE"],
  OFFLINE: ["AVAILABLE"],
};

/**
 * Transitions pilotées par le cycle ticket (jamais exposées à l'API manuelle).
 * AVAILABLE→SERVING (serve) et SERVING→AVAILABLE (close/no-show).
 */
const CYCLE_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  AVAILABLE: ["SERVING"],
  SERVING: ["AVAILABLE"],
  PAUSED: [],
  ABSENT: [],
  OFFLINE: [],
};

/** Mappe un statut agent vers le statut de guichet contractuel (counter:status). */
export function agentStatusToCounterStatus(
  status: AgentStatus
): "OPEN" | "PAUSED" | "CLOSED" {
  if (status === "AVAILABLE" || status === "SERVING") return "OPEN";
  if (status === "PAUSED") return "PAUSED";
  return "CLOSED";
}

/**
 * Présence de l'agent AUJOURD'HUI, dérivée de la machine à états (CONTRACT-014).
 *
 * Sémantique retenue : présent = statut dont le guichet n'est PAS fermé
 * (`agentStatusToCounterStatus(status) !== "CLOSED"`), soit :
 * - AVAILABLE / SERVING → présent (en service, guichet OPEN) ;
 * - PAUSED → présent (pause courte : l'agent est physiquement en agence et
 *   reprendra le service — son guichet est PAUSED, pas fermé) ;
 * - ABSENT / OFFLINE → absent (pas en service aujourd'hui, guichet CLOSED).
 *
 * Un agent jamais journalisé est OFFLINE par défaut (`DEFAULT_AGENT_STATUS`)
 * donc absent. Ce booléen est la SEULE donnée dérivée exposable publiquement :
 * jamais le statut brut, jamais d'horaire (zéro PII, D5).
 *
 * @param status - Statut courant de l'agent
 * @returns `true` si l'agent est présent en agence maintenant
 */
export function isAgentPresent(status: AgentStatus): boolean {
  return agentStatusToCounterStatus(status) !== "CLOSED";
}

/**
 * Lit EN LOT le statut courant d'un ensemble d'agents (dernière ligne
 * d'historique par agent) en UNE seule requête — jamais de N+1, condition
 * de perf des routes publiques (CONTRACT-014). Même ordre de résolution que
 * `getCurrentStatus` (`changed_at DESC, id DESC`).
 *
 * @param db       - Connexion PG
 * @param agentIds - Agents ciblés (UUID)
 * @returns Map agentId → statut courant. Un agent jamais journalisé est ABSENT
 *          de la Map : l'appelant applique `DEFAULT_AGENT_STATUS` (OFFLINE).
 */
export async function getCurrentStatuses(
  db: Db,
  agentIds: readonly string[]
): Promise<Map<string, AgentStatus>> {
  if (agentIds.length === 0) return new Map();
  const res = await db.query(
    `SELECT DISTINCT ON (agent_id) agent_id, to_status
       FROM agent_status_history
      WHERE agent_id = ANY($1::uuid[])
      ORDER BY agent_id, changed_at DESC, id DESC`,
    [agentIds]
  );
  const statuses = new Map<string, AgentStatus>();
  for (const row of res.rows as Array<{ agent_id: string; to_status: AgentStatus }>) {
    statuses.set(row.agent_id, row.to_status);
  }
  return statuses;
}

/**
 * Lève une 409 `ILLEGAL_AGENT_TRANSITION` conforme au contrat.
 *
 * @param from            - Statut courant
 * @param to              - Statut demandé
 * @param activeTicketId  - Ticket ouvert bloquant (optionnel)
 * @throws {SigfaError} 409 ILLEGAL_AGENT_TRANSITION
 */
function illegalTransition(
  from: AgentStatus,
  to: AgentStatus,
  activeTicketId?: string
): never {
  throw new SigfaError(
    "ILLEGAL_AGENT_TRANSITION",
    activeTicketId
      ? "Transition illégale : un ticket est en cours de traitement. Transférez ou clôturez le ticket avant de changer de statut."
      : `Transition illégale depuis ${from} vers ${to}.`,
    409,
    {
      currentStatus: from,
      requestedStatus: to,
      ...(activeTicketId ? { activeTicketId } : {}),
    }
  );
}

/**
 * Lit le statut courant d'un agent (dernière ligne d'historique).
 *
 * @param db      - Connexion PG
 * @param agentId - Agent ciblé
 * @returns Statut courant, `OFFLINE` si aucun historique
 */
export async function getCurrentStatus(
  db: Db,
  agentId: string
): Promise<AgentStatus> {
  const res = await db.query(
    `SELECT to_status FROM agent_status_history
      WHERE agent_id = $1 ORDER BY changed_at DESC, id DESC LIMIT 1`,
    [agentId]
  );
  const row = res.rows[0] as { to_status: AgentStatus } | undefined;
  return row?.to_status ?? DEFAULT_AGENT_STATUS;
}

/** Résout l'agence de contexte d'un agent (agency_users). */
async function resolveAgentAgency(
  db: Db,
  agentId: string,
  bankId: string
): Promise<string> {
  const res = await db.query(
    `SELECT agency_id FROM agency_users
      WHERE user_id = $1 AND bank_id = $2 ORDER BY created_at ASC LIMIT 1`,
    [agentId, bankId]
  );
  const row = res.rows[0] as { agency_id: string } | undefined;
  if (!row) {
    throw new SigfaError(
      "UNPROCESSABLE_ENTITY",
      "Agent sans affectation d'agence — transition impossible.",
      422,
      { agentId }
    );
  }
  return row.agency_id;
}

/** Recherche un ticket ouvert (CALLED/SERVING) affecté à l'agent. */
export async function findOpenTicketForAgent(
  db: Db,
  agentId: string
): Promise<string | null> {
  const res = await db.query(
    `SELECT id FROM tickets
      WHERE agent_id = $1 AND status IN ('CALLED','SERVING')
      ORDER BY called_at DESC LIMIT 1`,
    [agentId]
  );
  const row = res.rows[0] as { id: string } | undefined;
  return row?.id ?? null;
}

/** Résultat d'une transition de statut appliquée. */
export interface StatusChangeResult {
  /** Agent concerné. */
  id: string;
  /** Nouveau statut. */
  status: AgentStatus;
  /** Statut précédent. */
  previousStatus: AgentStatus;
  /** Horodatage ISO 8601 de la transition. */
  updatedAt: string;
}

/** Dépendances d'une transition de statut. */
export interface ChangeStatusDeps {
  db: Db;
  bus: RealtimeBus;
  bankId: string;
  agentId: string;
  /** Statut cible demandé. */
  target: AgentStatus;
  /** `true` si la transition est pilotée par le cycle ticket (serve/close). */
  cycle?: boolean;
}

/**
 * Vérifie la légalité d'une transition manuelle et refuse un forçage SERVING.
 *
 * @param from   - Statut courant
 * @param to     - Statut demandé
 * @param cycle  - Transition pilotée par le ticket ?
 */
function assertLegalTransition(
  from: AgentStatus,
  to: AgentStatus,
  cycle: boolean
): void {
  if (from === to) illegalTransition(from, to);
  const allowed = cycle ? CYCLE_TRANSITIONS[from] : MANUAL_TRANSITIONS[from];
  if (!allowed.includes(to)) illegalTransition(from, to);
}

/**
 * Applique une transition de statut : valide la légalité, refuse un forçage
 * SERVING manuel, bloque SERVING→(ABSENT/OFFLINE/PAUSED) avec ticket ouvert,
 * journalise dans `agent_status_history` et émet `counter:status`.
 *
 * @param deps - Dépendances et cible de la transition
 * @returns Résultat de la transition (statuts + horodatage)
 * @throws {SigfaError} 409 ILLEGAL_AGENT_TRANSITION sur transition interdite
 */
export async function changeAgentStatus(
  deps: ChangeStatusDeps
): Promise<StatusChangeResult> {
  const { db, bus, bankId, agentId, target } = deps;
  const cycle = deps.cycle ?? false;
  const from = await getCurrentStatus(db, agentId);

  // SERVING → sortie (hors AVAILABLE) : d'abord le cas « ticket ouvert non
  // transféré » (409 avec activeTicketId, LA LOI §164), puis la légalité générale.
  if (from === "SERVING" && target !== "AVAILABLE") {
    const openTicket = await findOpenTicketForAgent(db, agentId);
    if (openTicket) illegalTransition(from, target, openTicket);
  }

  assertLegalTransition(from, target, cycle);

  const agencyId = await resolveAgentAgency(db, agentId, bankId);
  const inserted = await db.query(
    `INSERT INTO agent_status_history (bank_id, agency_id, agent_id, from_status, to_status)
     VALUES ($1, $2, $3, $4, $5) RETURNING changed_at`,
    [bankId, agencyId, agentId, from, target]
  );
  const changedAt = (inserted.rows[0] as { changed_at: Date }).changed_at;

  await emitCounterStatus(bus, db, agentId, target);

  return {
    id: agentId,
    status: target,
    previousStatus: from,
    updatedAt: changedAt.toISOString(),
  };
}

/**
 * Émet `counter:status` pour le guichet de l'agent (LA LOI CONTRACT-002).
 * Sans guichet affecté, aucun événement (le contrat exige un counterId UUID).
 *
 * @param bus     - Bus temps réel
 * @param db      - Connexion PG
 * @param agentId - Agent concerné
 * @param status  - Nouveau statut agent (mappé vers counter status)
 */
export async function emitCounterStatus(
  bus: RealtimeBus,
  db: Db,
  agentId: string,
  status: AgentStatus
): Promise<void> {
  const counter = await resolveAgentCounter(db, agentId);
  if (!counter) return;
  // RT-001a : l'agencyId (room cible) est résolu DANS la requête du guichet —
  // aucun aller-retour DB séparé.
  bus.emit("counter:status", counter.agencyId, {
    counterId: counter.counterId,
    status: agentStatusToCounterStatus(status),
    agentId,
  });
}

/** Résout le guichet + l'agence affectés à un agent (ou null). */
async function resolveAgentCounter(
  db: Db,
  agentId: string
): Promise<{ counterId: string; agencyId: string } | null> {
  const res = await db.query(
    `SELECT id, agency_id FROM counters WHERE agent_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [agentId]
  );
  const row = res.rows[0] as { id: string; agency_id: string } | undefined;
  return row ? { counterId: row.id, agencyId: row.agency_id } : null;
}
