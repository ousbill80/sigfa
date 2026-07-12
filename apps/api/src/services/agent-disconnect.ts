/**
 * agent-disconnect — anti-flap socket + AGENT_DISCONNECTED_WITH_TICKET (API-007).
 *
 * LA LOI (API-007 critères 4 & 5) :
 *  - Anti-flap par `agentId` : à la déconnexion socket, Redis `SET NX` avec TTL
 *    `AGENT_DISCONNECT_GRACE_S` (défaut 30 s). Une reconnexion dans la fenêtre
 *    fait `DEL` la clé → la déconnexion n'a AUCUN effet.
 *  - Passé la grâce (clé toujours présente) : traitement de la déconnexion.
 *    - Agent avec ticket CALLED/SERVING → le ticket repasse **WAITING priorité
 *      PRIORITY** (v5), émission `counter:status` (guichet CLOSED, agent OFFLINE)
 *      et alerte immédiate `AGENT_DISCONNECTED_WITH_TICKET`.
 *    - Agent sans ticket → OFFLINE simple (transition + `counter:status`).
 *  - Chaque changement de statut écrit `agent_status_history`.
 *
 * Les fonctions sont PURES vis-à-vis des dépendances injectées (redis/db/bus),
 * testables directement avec Testcontainers Redis + PG.
 *
 * @module
 */

import type { Client, PoolClient } from "pg";
import type { Redis } from "ioredis";
import type { RealtimeBus } from "src/services/realtime.js";
import { getAlertingConfig } from "src/config/alerting.js";
import {
  getCurrentStatus,
  findOpenTicketForAgent,
  emitCounterStatus,
} from "src/services/agent-status.js";

/** Client PG (connexion ou transaction). */
type Db = Client | PoolClient;

/** Préfixe de la clé Redis anti-flap par agentId. */
export const DISCONNECT_GRACE_PREFIX = "agent_disconnect_grace:";

/**
 * Tampon (ms) ajouté au TTL de la clé au-delà de la grâce, afin que le
 * traitement planifié (déclenché À la fin de la grâce) trouve DÉTERMINISTIQUEMENT
 * la clé encore présente si aucune reconnexion ne l'a effacée — la décision
 * repose sur `DEL` explicite (reconnexion), jamais sur une expiration TTL de bord.
 */
export const GRACE_TTL_BUFFER_MS = 5_000 as const;

/** Compose la clé Redis anti-flap d'un agent. */
export function graceKey(agentId: string): string {
  return `${DISCONNECT_GRACE_PREFIX}${agentId}`;
}

/**
 * Marque une déconnexion socket : pose la clé anti-flap `SET NX PX <grace+tampon>`.
 * Idempotent : si la clé existe déjà (déconnexions rapprochées), pas d'écrasement.
 * Le TTL couvre la fenêtre de grâce plus un tampon pour le traitement.
 *
 * @param redis   - Client Redis
 * @param agentId - Agent déconnecté
 * @returns `true` si la marque a été posée (première déconnexion de l'épisode)
 */
export async function markDisconnect(
  redis: Redis,
  agentId: string
): Promise<boolean> {
  const graceMs = getAlertingConfig().agentDisconnectGraceS * 1000;
  const ttlMs = graceMs + GRACE_TTL_BUFFER_MS;
  const res = await redis.set(graceKey(agentId), "1", "PX", ttlMs, "NX");
  return res === "OK";
}

/**
 * Enregistre une reconnexion dans la fenêtre de grâce : `DEL` la clé anti-flap.
 * Si la clé avait déjà expiré, l'appel n'a aucun effet (la déconnexion sera/est
 * traitée). Retourne `true` si une marque active a été annulée.
 *
 * @param redis   - Client Redis
 * @param agentId - Agent reconnecté
 * @returns `true` si une déconnexion en attente a été annulée
 */
export async function cancelDisconnect(
  redis: Redis,
  agentId: string
): Promise<boolean> {
  const removed = await redis.del(graceKey(agentId));
  return removed === 1;
}

/** Résultat du traitement d'une déconnexion arrivée à échéance. */
export interface DisconnectOutcome {
  /** `true` si un traitement a eu lieu (grâce écoulée, non annulée). */
  processed: boolean;
  /** Ticket réinséré en WAITING PRIORITY (si l'agent en tenait un). */
  requeuedTicketId: string | null;
}

/** Dépendances du traitement de déconnexion. */
export interface ProcessDisconnectDeps {
  db: Db;
  redis: Redis;
  bus: RealtimeBus;
  bankId: string;
  agentId: string;
}

/**
 * Traite une déconnexion arrivée à échéance de grâce.
 *
 * NE traite QUE si la clé anti-flap existe encore (aucune reconnexion l'a
 * effacée). Si un ticket CALLED/SERVING est tenu par l'agent : le ticket
 * repasse WAITING priorité PRIORITY, `counter:status` OFFLINE émis, alerte
 * `AGENT_DISCONNECTED_WITH_TICKET`. Sinon : OFFLINE simple.
 *
 * @param deps - Dépendances (db, redis, bus, bankId, agentId)
 * @returns Issue du traitement (processed + ticket réinséré éventuel)
 */
export async function processDisconnect(
  deps: ProcessDisconnectDeps
): Promise<DisconnectOutcome> {
  const { db, redis, bus, bankId, agentId } = deps;

  // Reconnexion pendant la grâce → clé absente → aucun effet.
  const stillPending = await redis.exists(graceKey(agentId));
  if (stillPending !== 1) {
    return { processed: false, requeuedTicketId: null };
  }
  await redis.del(graceKey(agentId));

  const openTicketId = await findOpenTicketForAgent(db, agentId);

  if (openTicketId) {
    await requeueTicketAsPriority(db, openTicketId);
    await forceOffline(db, bus, bankId, agentId);
    bus.emit("alert:manager", {
      type: "AGENT_DISCONNECTED_WITH_TICKET",
      payload: { agentId, ticketId: openTicketId, requeuedPriority: "PRIORITY" },
    });
    return { processed: true, requeuedTicketId: openTicketId };
  }

  await forceOffline(db, bus, bankId, agentId);
  return { processed: true, requeuedTicketId: null };
}

/**
 * Réinsère un ticket en WAITING priorité PRIORITY (v5) et le détache du guichet.
 *
 * @param db       - Connexion PG
 * @param ticketId - Ticket à réinsérer
 */
async function requeueTicketAsPriority(
  db: Db,
  ticketId: string
): Promise<void> {
  await db.query(
    `UPDATE tickets
        SET status = 'WAITING', priority = 'PRIORITY',
            counter_id = NULL, agent_id = NULL,
            called_at = NULL, served_at = NULL, updated_at = NOW()
      WHERE id = $1`,
    [ticketId]
  );
}

/**
 * Force le passage OFFLINE de l'agent (bypass des transitions manuelles) :
 * journalise dans `agent_status_history` et émet `counter:status`.
 *
 * @param db      - Connexion PG
 * @param bus     - Bus temps réel
 * @param bankId  - Tenant
 * @param agentId - Agent à passer OFFLINE
 */
async function forceOffline(
  db: Db,
  bus: RealtimeBus,
  bankId: string,
  agentId: string
): Promise<void> {
  const from = await getCurrentStatus(db, agentId);
  if (from === "OFFLINE") {
    await emitCounterStatus(bus, db, agentId, "OFFLINE");
    return;
  }
  // Si l'agent est AVAILABLE/PAUSED/ABSENT/SERVING, on force OFFLINE via une
  // transition « cycle » n'est pas légale ; on écrit l'historique directement.
  const agencyRes = await db.query(
    `SELECT agency_id FROM agency_users WHERE user_id = $1 AND bank_id = $2
      ORDER BY created_at ASC LIMIT 1`,
    [agentId, bankId]
  );
  const agencyRow = agencyRes.rows[0] as { agency_id: string } | undefined;
  if (!agencyRow) return;
  await db.query(
    `INSERT INTO agent_status_history (bank_id, agency_id, agent_id, from_status, to_status)
     VALUES ($1, $2, $3, $4, 'OFFLINE')`,
    [bankId, agencyRow.agency_id, agentId, from]
  );
  await emitCounterStatus(bus, db, agentId, "OFFLINE");
}
