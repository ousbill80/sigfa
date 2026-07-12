/**
 * queue-estimation — TMT glissant + estimation du temps d'attente + cache Redis.
 *
 * LA LOI (API-003) :
 * - TMT (temps moyen de traitement) = moyenne simple des `service_time_seconds`
 *   des tickets DONE du service sur les 60 dernières minutes (fenêtre Abidjan),
 *   avec **≥5 observations** — sinon `sla_minutes` du service — sinon défaut
 *   global 15 min.
 * - `estimatedWaitMinutes = position × TMT(minutes)`.
 * - Cache Redis TTL 10 s, invalidé sur toute mutation de file.
 *
 * @module
 */

import type { Redis } from "ioredis";
import type { Tx } from "src/services/queue-strategy.js";

/** Fenêtre glissante du TMT en minutes. */
export const TMT_WINDOW_MINUTES = 60;
/** Nombre minimal d'observations DONE pour utiliser la moyenne glissante. */
export const TMT_MIN_OBSERVATIONS = 5;
/** Défaut global du TMT (minutes) si aucune donnée exploitable. */
export const TMT_GLOBAL_FALLBACK_MINUTES = 15;
/** TTL du cache d'estimation (secondes). */
export const ESTIMATION_CACHE_TTL_SECONDS = 10;

/** Préfixe des clés Redis de cache d'estimation (scopé par file). */
const CACHE_PREFIX = "estimate:";

/** Construit la clé de cache d'une file. */
function cacheKey(queueId: string): string {
  return `${CACHE_PREFIX}${queueId}`;
}

/**
 * Calcule le TMT (minutes) d'un service selon la cascade LA LOI.
 *
 * @param serviceId - Service dont on calcule le TMT
 * @param tx        - Transaction / connexion courante
 * @returns TMT en minutes (arrondi supérieur, ≥1)
 */
export async function computeTmtMinutes(
  serviceId: string,
  tx: Tx,
  operationId?: string | null
): Promise<number> {
  const res = await tx.query(
    `SELECT COUNT(*)::int AS n, COALESCE(AVG(service_time_seconds), 0) AS avg_s
       FROM tickets
      WHERE service_id = $1
        AND status = 'DONE'
        AND service_time_seconds IS NOT NULL
        AND closed_at >= NOW() - INTERVAL '${String(TMT_WINDOW_MINUTES)} minutes'`,
    [serviceId]
  );
  const row = res.rows[0] as { n: number; avg_s: string };
  if (row.n >= TMT_MIN_OBSERVATIONS) {
    return Math.max(1, Math.ceil(Number(row.avg_s) / 60));
  }
  return fallbackTmtMinutes(serviceId, tx, operationId);
}

/**
 * TMT de repli : **SLA résolu** (D4 — `operation.sla_minutes ?? service.sla_minutes`),
 * sinon défaut global 15 min. Quand `operationId` est fourni, le SLA propre de
 * l'opération prime ; s'il est NULL (héritage) ou l'opération absente, on retombe
 * sur le SLA du service.
 *
 * @param serviceId   - Service ciblé
 * @param tx          - Transaction / connexion courante
 * @param operationId - Opération optionnelle du ticket (SLA prioritaire)
 */
async function fallbackTmtMinutes(
  serviceId: string,
  tx: Tx,
  operationId?: string | null
): Promise<number> {
  if (operationId) {
    const opRes = await tx.query(`SELECT sla_minutes FROM operations WHERE id = $1`, [operationId]);
    const opRow = opRes.rows[0] as { sla_minutes: number | null } | undefined;
    if (opRow?.sla_minutes != null) return opRow.sla_minutes;
  }
  const res = await tx.query(`SELECT sla_minutes FROM services WHERE id = $1`, [serviceId]);
  const row = res.rows[0] as { sla_minutes: number } | undefined;
  return row?.sla_minutes ?? TMT_GLOBAL_FALLBACK_MINUTES;
}

/**
 * Estime le temps d'attente (minutes) = position × TMT.
 * @param position    - Position PULL du ticket
 * @param serviceId   - Service du ticket
 * @param tx          - Transaction / connexion courante
 * @param operationId - Opération optionnelle (SLA résolu prioritaire — D4)
 */
export async function estimateWaitMinutes(
  position: number,
  serviceId: string,
  tx: Tx,
  operationId?: string | null
): Promise<number> {
  if (position <= 0) return 0;
  const tmt = await computeTmtMinutes(serviceId, tx, operationId);
  return position * tmt;
}

/**
 * Lit l'estimation `{length, estimate}` d'une file depuis le cache Redis.
 * @param redis   - Client Redis
 * @param queueId - File ciblée
 * @returns L'estimation cachée, ou `null` si absente/expirée
 */
export async function getCachedEstimate(
  redis: Redis,
  queueId: string
): Promise<{ length: number; estimate: number } | null> {
  const raw = await redis.get(cacheKey(queueId));
  return raw === null ? null : (JSON.parse(raw) as { length: number; estimate: number });
}

/**
 * Écrit l'estimation d'une file dans le cache Redis (TTL 10 s).
 * @param redis    - Client Redis
 * @param queueId  - File ciblée
 * @param estimate - Objet `{length, estimate}`
 */
export async function setCachedEstimate(
  redis: Redis,
  queueId: string,
  estimate: { length: number; estimate: number }
): Promise<void> {
  await redis.set(cacheKey(queueId), JSON.stringify(estimate), "EX", ESTIMATION_CACHE_TTL_SECONDS);
}

/**
 * Invalide le cache d'estimation d'une file (à appeler sur TOUTE mutation).
 * @param redis   - Client Redis
 * @param queueId - File ciblée
 */
export async function invalidateEstimate(redis: Redis, queueId: string): Promise<void> {
  await redis.del(cacheKey(queueId));
}
