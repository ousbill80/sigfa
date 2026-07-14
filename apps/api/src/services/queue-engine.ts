/**
 * queue-engine — moteur de file API-004.
 *
 * LA LOI (API-004) :
 * - `selectNextPriority` : VIP > PMR > SENIOR > PRIORITY > STANDARD puis FIFO.
 * - Routage langue : ticket avec `required_language` → sauté si agent ne parle pas
 *   cette langue. Après `LANGUAGE_SOFT_TIMEOUT_MINUTES` (défaut 10, config),
 *   le guichet prend quand même (soft timeout).
 * - Débordement : `shouldAlertOverflow` gère le one-shot par franchissement via Redis.
 * - `findOverflowQueues` : files de services compatibles (agent commun).
 * - `computePositionPriority` : rang réel dans l'ordre VIP>PMR>SENIOR>PRIORITY>STANDARD.
 *
 * @module
 */

import type { Tx, TicketSelector, SelectedTicket } from "src/services/queue-strategy.js";

/** Ordre de priorité : plus bas index = plus haute priorité. */
export const PRIORITY_ORDER: Record<string, number> = {
  VIP: 0,
  PMR: 1,
  SENIOR: 2,
  PRIORITY: 3,
  STANDARD: 4,
};

/** Expression SQL de l'ordre de priorité (colonne `t.priority`, alias de table). */
const PRIORITY_CASE_T = `CASE t.priority
  WHEN 'VIP' THEN 0
  WHEN 'PMR' THEN 1
  WHEN 'SENIOR' THEN 2
  WHEN 'PRIORITY' THEN 3
  ELSE 4
END`;

/** Expression SQL de l'ordre de priorité sans alias de table (CTE, sous-requêtes). */
const PRIORITY_CASE = `CASE priority
  WHEN 'VIP' THEN 0
  WHEN 'PMR' THEN 1
  WHEN 'SENIOR' THEN 2
  WHEN 'PRIORITY' THEN 3
  ELSE 4
END`;

/**
 * `LANGUAGE_SOFT_TIMEOUT_MINUTES` : après ce délai, le guichet prend le ticket
 * même sans correspondance de langue. Configurable via env.
 */
// Stryker disable StringLiteral: mutant statique (lecture env au chargement du module) ET équivalent — la clé env n'est pas définie sous test, `process.env[""]` comme `process.env["LANGUAGE_SOFT_TIMEOUT_MINUTES"]` valent `undefined` → défaut 10 identique (SEC-005/D3)
export const LANGUAGE_SOFT_TIMEOUT_MINUTES =
  Number(process.env["LANGUAGE_SOFT_TIMEOUT_MINUTES"] ?? 10);
// Stryker restore StringLiteral

/**
 * Récupère les langues parlées par l'agent du guichet.
 *
 * @param counterId - Guichet ciblé
 * @param tx        - Transaction courante
 * @returns Tableau de codes langue (ex: ['FR', 'EN']), vide si aucun agent
 */
export async function getAgentLanguages(
  counterId: string,
  tx: Tx
): Promise<string[]> {
  const res = await tx.query(
    `SELECT COALESCE(u.languages, ARRAY[]::agent_language[])::text[] AS languages
       FROM counters c
       LEFT JOIN users u ON u.id = c.agent_id
      WHERE c.id = $1`,
    [counterId]
  );
  const row = res.rows[0] as { languages: string[] | null } | undefined;
  return row?.languages ?? [];
}

/**
 * Sélectionne le prochain ticket par ordre VIP>PMR>SENIOR>PRIORITY>STANDARD puis
 * FIFO, avec filtrage langue (soft timeout contrôlé).
 *
 * @param queueId   - File ciblée
 * @param counterId - Guichet appelant (pour filtrage langue)
 * @param tx        - Transaction courante
 * @returns Ticket sélectionné ou `null` si aucun éligible
 */
export const selectNextPriority: TicketSelector = async (
  queueId,
  counterId,
  tx
) => {
  const agentLangs = await getAgentLanguages(counterId, tx);
  const softDeadline = new Date(
    Date.now() - LANGUAGE_SOFT_TIMEOUT_MINUTES * 60 * 1000
  );

  let sql: string;
  let params: unknown[];

  if (agentLangs.length > 0) {
    // Agent avec langue(s) : filtre compatible ou soft-timeout dépassé
    sql = `
      SELECT t.id, t.queue_id, t.service_id, t.status, t.priority, t.issued_at
        FROM tickets t
       WHERE t.queue_id = $1
         AND t.status = 'WAITING'
         AND (t.required_language IS NULL
              OR t.required_language::text = ANY($2::text[])
              OR t.issued_at <= $3)
       ORDER BY ${PRIORITY_CASE_T} ASC, t.issued_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
    `;
    params = [queueId, agentLangs, softDeadline];
  } else {
    // Agent sans langue déclarée : prend tout ticket sans exigence ou en soft-timeout
    sql = `
      SELECT t.id, t.queue_id, t.service_id, t.status, t.priority, t.issued_at
        FROM tickets t
       WHERE t.queue_id = $1
         AND t.status = 'WAITING'
         AND (t.required_language IS NULL OR t.issued_at <= $2)
       ORDER BY ${PRIORITY_CASE_T} ASC, t.issued_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
    `;
    params = [queueId, softDeadline];
  }

  const res = await tx.query(sql, params);
  const row = res.rows[0] as
    | {
        id: string;
        queue_id: string;
        service_id: string;
        status: string;
        priority: string;
        issued_at: Date;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    queueId: row.queue_id,
    serviceId: row.service_id,
    status: row.status,
    priority: row.priority,
    issuedAt: row.issued_at,
  };
};

/**
 * Résout l'agent affecté au guichet (ou `null` si aucun / guichet inconnu).
 *
 * @param counterId - Guichet appelant
 * @param tx        - Transaction courante
 * @returns UUID de l'agent, ou `null`
 */
async function getCounterAgentId(counterId: string, tx: Tx): Promise<string | null> {
  const res = await tx.query(`SELECT agent_id FROM counters WHERE id = $1`, [counterId]);
  const row = res.rows[0] as { agent_id: string | null } | undefined;
  return row?.agent_id ?? null;
}

/**
 * Sélectionne le prochain WAITING de la file PERSONNELLE d'un conseiller
 * (`target_manager_id = managerId`, même file), ordre priorité porteur puis FIFO.
 *
 * `FOR UPDATE SKIP LOCKED` : verrou identique à la file de service. Aucun filtrage
 * langue (la file conseiller est mono-agent — le client a choisi ce conseiller).
 *
 * @param queueId   - File du guichet
 * @param managerId - Conseiller (agent du guichet)
 * @param tx        - Transaction courante
 * @returns Ticket perso sélectionné, ou `null` si file perso vide
 */
async function selectNextPersonal(
  queueId: string,
  managerId: string,
  tx: Tx
): Promise<SelectedTicket | null> {
  const res = await tx.query(
    `SELECT t.id, t.queue_id, t.service_id, t.status, t.priority, t.issued_at
       FROM tickets t
      WHERE t.queue_id = $1
        AND t.status = 'WAITING'
        AND t.target_manager_id = $2
      ORDER BY ${PRIORITY_CASE_T} ASC, t.issued_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED`,
    [queueId, managerId]
  );
  const row = res.rows[0] as
    | { id: string; queue_id: string; service_id: string; status: string; priority: string; issued_at: Date }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    queueId: row.queue_id,
    serviceId: row.service_id,
    status: row.status,
    priority: row.priority,
    issuedAt: row.issued_at,
  };
}

/**
 * Stratégie conseiller (MODEL-API-B, D6) — file personnelle PRIORITÉ ABSOLUE.
 *
 * Fabrique un `TicketSelector` injectable : QUAND un agent conseiller fait
 * `call-next`, il sert D'ABORD sa file personnelle (tickets `target_manager_id =
 * lui`, ordre priorité porteur puis FIFO) ; SEULEMENT si elle est vide → délègue
 * au `fallback` (file de service — comportement existant `selectNextPriority`).
 *
 * Un guichet sans agent, ou dont l'agent n'a aucun ticket personnel en attente,
 * se comporte EXACTEMENT comme la file de service (aucune régression).
 *
 * @param fallback - Sélecteur de la file de service (défaut branché par l'appelant)
 * @returns Un `TicketSelector` priorisant la file conseiller
 */
export function selectNextForManager(fallback: TicketSelector): TicketSelector {
  return async (queueId, counterId, tx) => {
    const agentId = await getCounterAgentId(counterId, tx);
    if (agentId) {
      const personal = await selectNextPersonal(queueId, agentId, tx);
      if (personal) return personal;
    }
    return fallback(queueId, counterId, tx);
  };
}

/**
 * Calcule la position réelle d'un ticket dans l'ordre de sélection prioritaire.
 * `rank() OVER (PARTITION BY queue_id ORDER BY priority_order ASC, issued_at ASC)`.
 *
 * @param ticketId - Ticket ciblé
 * @param tx       - Transaction / connexion courante
 * @returns Position 1-based parmi les WAITING, ou 0 si hors file d'attente
 */
export async function computePositionPriority(
  ticketId: string,
  tx: Tx
): Promise<number> {
  const res = await tx.query(
    `WITH ranked AS (
       SELECT id,
              rank() OVER (
                PARTITION BY queue_id
                ORDER BY
                  ${PRIORITY_CASE} ASC,
                  issued_at ASC
              ) AS position
         FROM tickets
        WHERE status = 'WAITING'
          AND queue_id = (SELECT queue_id FROM tickets WHERE id = $1)
     )
     SELECT position FROM ranked WHERE id = $1`,
    [ticketId]
  );
  const row = res.rows[0] as { position: string | number } | undefined;
  return row ? Number(row.position) : 0;
}

/** Interface Redis minimale requise par `shouldAlertOverflow`. */
export interface OverflowRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/**
 * Vérifie si la file dépasse son seuil critique et gère le flag one-shot Redis.
 *
 * - Franchissement (length > threshold, pas encore alerté) → retourne `true`
 *   et pose le flag `overflow_alerted:<queueId>`.
 * - Redescente sous le seuil → reset le flag (prochaine montée ré-alertera).
 * - Alerte déjà posée → retourne `false` (pas de rafale).
 *
 * @param queueId - File ciblée
 * @param length  - Longueur actuelle de la file
 * @param bankId  - Banque (pour lire `queue_critical_threshold`)
 * @param tx      - Connexion PG
 * @param redis   - Client Redis (interface minimale)
 * @returns `true` si nouvelle alerte QUEUE_CRITICAL à émettre
 */
export async function shouldAlertOverflow(
  queueId: string,
  length: number,
  bankId: string,
  tx: Tx,
  redis: OverflowRedis
): Promise<boolean> {
  const threshRes = await tx.query(
    `SELECT queue_critical_threshold FROM banks WHERE id = $1`,
    [bankId]
  );
  const threshRow = threshRes.rows[0] as
    | { queue_critical_threshold: number | null }
    | undefined;
  const threshold = threshRow?.queue_critical_threshold;

  if (!threshold) return false;

  const alertKey = `overflow_alerted:${queueId}`;

  if (length > threshold) {
    const alerted = await redis.get(alertKey);
    if (alerted === "1") return false;
    await redis.set(alertKey, "1");
    return true;
  }
  // Redescente sous le seuil → reset le flag
  await redis.del(alertKey);
  return false;
}

/**
 * Cherche les files de services compatibles pour le débordement.
 * Services compatibles = partageant au moins un guichet avec le service source.
 *
 * @param serviceId - Service source (en débordement)
 * @param bankId    - Banque
 * @param tx        - Transaction courante
 * @returns Tableau de `{queueId, serviceId}` des files cibles éligibles
 */
export async function findOverflowQueues(
  serviceId: string,
  bankId: string,
  tx: Tx
): Promise<Array<{ queueId: string; serviceId: string }>> {
  const res = await tx.query(
    `SELECT DISTINCT q.id AS queue_id, q.service_id
       FROM counter_services cs1
       JOIN counter_services cs2
         ON cs2.counter_id = cs1.counter_id
        AND cs2.service_id != $1
       JOIN queues q
         ON q.service_id = cs2.service_id
        AND q.bank_id = $2
        AND q.status = 'OPEN'
      WHERE cs1.service_id = $1`,
    [serviceId, bankId]
  );
  return (res.rows as Array<{ queue_id: string; service_id: string }>).map(
    (r) => ({ queueId: r.queue_id, serviceId: r.service_id })
  );
}
