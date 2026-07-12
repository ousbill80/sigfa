/**
 * alert-jobs — scans d'alertes manager par jobs BullMQ repeatable (API-007).
 *
 * LA LOI (API-007 critères 6 & 7) :
 *  - `inactive-agent-scan` : AGENT AVAILABLE sans appel depuis
 *    `banks.agent_inactivity_minutes` → UNE alerte AGENT_INACTIVE par épisode
 *    (reset sur activité). Verrou distribué (`worker concurrency=1`).
 *  - `sla-scan` : ticket SERVING dépassant le SLA du service → SLA_BREACH ;
 *    >2× SLA → alerte renouvelée marquée `escalated`. Même verrou distribué.
 *
 * Toutes les alertes sont émises sous la forme CONTRACTUELLE `{ type, payload }`
 * via le `RealtimeBus` (LA LOI `alertManagerEvent`).
 *
 * Anti-rafale : chaque scan prend un verrou Redis `SET NX` (une seule des N
 * instances exécute la passe → UNE alerte). L'état « déjà alerté » est un flag
 * Redis par sujet, remis à zéro dès que la condition disparaît (nouvel épisode).
 *
 * @module
 */

import type { Client, PoolClient } from "pg";
import type { Redis } from "ioredis";
import type { RealtimeBus } from "src/services/realtime.js";

/** Client PG (connexion ou transaction). */
type Db = Client | PoolClient;

/** Clé du verrou distribué du scan d'agents inactifs. */
export const INACTIVE_SCAN_LOCK = "alert-scan-lock:inactive-agent";

/** Clé du verrou distribué du scan SLA. */
export const SLA_SCAN_LOCK = "alert-scan-lock:sla";

/** TTL du verrou de scan (ms) — libère si un worker meurt en cours de passe. */
export const SCAN_LOCK_TTL_MS = 10_000 as const;

/**
 * Prend un verrou distribué `SET NX PX`. Retourne `true` si acquis.
 * Deux instances concurrentes → une seule obtient `true` (l'autre saute la passe).
 *
 * @param redis - Client Redis
 * @param key   - Clé du verrou
 * @returns `true` si le verrou a été acquis
 */
export async function acquireScanLock(
  redis: Redis,
  key: string
): Promise<boolean> {
  const res = await redis.set(key, "1", "PX", SCAN_LOCK_TTL_MS, "NX");
  return res === "OK";
}

/** Relâche un verrou de scan (best-effort). */
export async function releaseScanLock(redis: Redis, key: string): Promise<void> {
  await redis.del(key);
}

/** Ligne d'agent inactif candidat. */
interface InactiveAgentRow {
  agent_id: string;
  agency_id: string;
  bank_id: string;
  inactive_minutes: number;
}

/**
 * Scanne les agents AVAILABLE inactifs et émet AGENT_INACTIVE (une fois/épisode).
 *
 * Un agent est « inactif » s'il est AVAILABLE (dernière transition) depuis plus
 * de `agent_inactivity_minutes` sans avoir appelé de ticket depuis. Le flag
 * Redis `agent_inactive_alerted:<agentId>` garantit UNE alerte par épisode ;
 * il est effacé dès que l'agent n'est plus inactif (reprise d'activité / statut).
 *
 * @param db    - Connexion PG
 * @param redis - Client Redis
 * @param bus   - Bus temps réel
 * @returns Nombre d'alertes AGENT_INACTIVE émises pendant cette passe
 */
export async function scanInactiveAgents(
  db: Db,
  redis: Redis,
  bus: RealtimeBus
): Promise<number> {
  const res = await db.query(
    `WITH latest AS (
       SELECT DISTINCT ON (agent_id)
              agent_id, agency_id, bank_id, to_status, changed_at
         FROM agent_status_history
        ORDER BY agent_id, changed_at DESC, id DESC
     )
     SELECT l.agent_id, l.agency_id, l.bank_id, b.agent_inactivity_minutes AS inactive_minutes
       FROM latest l
       JOIN banks b ON b.id = l.bank_id
      WHERE l.to_status = 'AVAILABLE'
        AND l.changed_at <= NOW() - (b.agent_inactivity_minutes * INTERVAL '1 minute')
        AND NOT EXISTS (
          SELECT 1 FROM tickets t
           WHERE t.agent_id = l.agent_id AND t.called_at >= l.changed_at
        )`
  );
  const rows = res.rows as InactiveAgentRow[];
  const activeAgentIds = new Set(rows.map((r) => r.agent_id));

  await resetVanishedFlags(redis, "agent_inactive_alerted:", activeAgentIds);

  let emitted = 0;
  for (const row of rows) {
    const flagKey = `agent_inactive_alerted:${row.agent_id}`;
    const already = await redis.set(flagKey, "1", "NX");
    if (already !== "OK") continue;
    bus.emit("alert:manager", row.agency_id, {
      type: "AGENT_INACTIVE",
      payload: {
        agentId: row.agent_id,
        agencyId: row.agency_id,
        inactiveMinutes: row.inactive_minutes,
      },
    });
    emitted += 1;
  }
  return emitted;
}

/** Ligne de ticket en dépassement SLA. */
interface SlaBreachRow {
  ticket_id: string;
  service_id: string;
  agency_id: string;
  agent_id: string | null;
  sla_seconds: number;
  serving_seconds: number;
}

/**
 * Scanne les tickets SERVING dépassant le SLA du service et émet SLA_BREACH.
 * >2× SLA → alerte renouvelée marquée `escalated: true`.
 *
 * Deux paliers de flag Redis par ticket : `sla_alerted:<id>` (1er dépassement)
 * et `sla_escalated:<id>` (dépassement >2× SLA). Les flags sont effacés quand le
 * ticket n'est plus en dépassement (clôturé / transféré).
 *
 * @param db    - Connexion PG
 * @param redis - Client Redis
 * @param bus   - Bus temps réel
 * @returns Nombre d'alertes SLA_BREACH émises pendant cette passe
 */
export async function scanSlaBreaches(
  db: Db,
  redis: Redis,
  bus: RealtimeBus
): Promise<number> {
  const res = await db.query(
    `SELECT t.id AS ticket_id, t.service_id, t.agency_id, t.agent_id,
            (s.sla_minutes * 60) AS sla_seconds,
            EXTRACT(EPOCH FROM (NOW() - COALESCE(t.served_at, t.called_at)))::int AS serving_seconds
       FROM tickets t
       JOIN services s ON s.id = t.service_id
      WHERE t.status = 'SERVING'
        AND EXTRACT(EPOCH FROM (NOW() - COALESCE(t.served_at, t.called_at))) > (s.sla_minutes * 60)`
  );
  const rows = res.rows as SlaBreachRow[];
  const breachingIds = new Set(rows.map((r) => r.ticket_id));

  await resetVanishedFlags(redis, "sla_alerted:", breachingIds);
  await resetVanishedFlags(redis, "sla_escalated:", breachingIds);

  let emitted = 0;
  for (const row of rows) {
    const escalated = row.serving_seconds > row.sla_seconds * 2;
    const flagKey = escalated
      ? `sla_escalated:${row.ticket_id}`
      : `sla_alerted:${row.ticket_id}`;
    const fresh = await redis.set(flagKey, "1", "NX");
    if (fresh !== "OK") continue;
    bus.emit("alert:manager", row.agency_id, {
      type: "SLA_BREACH",
      payload: {
        ticketId: row.ticket_id,
        serviceId: row.service_id,
        agencyId: row.agency_id,
        ...(row.agent_id ? { agentId: row.agent_id } : {}),
        slaSeconds: row.sla_seconds,
        servingSeconds: row.serving_seconds,
        escalated,
      },
    });
    emitted += 1;
  }
  return emitted;
}

/**
 * Efface les flags Redis dont le sujet ne remplit plus la condition (reset
 * d'épisode). Parcourt les clés `<prefix>*` et supprime celles hors ensemble.
 *
 * @param redis  - Client Redis
 * @param prefix - Préfixe de clé (ex: `agent_inactive_alerted:`)
 * @param active - Ensemble des ids encore concernés (à conserver)
 */
async function resetVanishedFlags(
  redis: Redis,
  prefix: string,
  active: Set<string>
): Promise<void> {
  const keys = await redis.keys(`${prefix}*`);
  for (const key of keys) {
    const id = key.slice(prefix.length);
    if (!active.has(id)) await redis.del(key);
  }
}

/**
 * Exécute une passe de scan protégée par verrou distribué : si le verrou n'est
 * pas obtenu (autre instance en cours), la passe est sautée (0 alerte ici).
 *
 * @param redis   - Client Redis
 * @param lockKey - Clé du verrou distribué
 * @param scan    - Fonction de scan à exécuter sous verrou
 * @returns Nombre d'alertes émises (0 si verrou non acquis)
 */
export async function runLockedScan(
  redis: Redis,
  lockKey: string,
  scan: () => Promise<number>
): Promise<number> {
  const acquired = await acquireScanLock(redis, lockKey);
  if (!acquired) return 0;
  try {
    return await scan();
  } finally {
    await releaseScanLock(redis, lockKey);
  }
}
