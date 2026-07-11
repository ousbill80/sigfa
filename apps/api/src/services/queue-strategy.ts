/**
 * queue-strategy — sélection FIFO du prochain ticket + position PULL par rank().
 *
 * LA LOI (API-003) :
 * - `TicketSelector = (queueId, counterId, tx) => Promise<Ticket | null>` :
 *   interface de sélection remplaçable par injection (API-004 branchera les
 *   priorités fines).
 * - `selectNextFifo` : FIFO simple sur les WAITING éligibles au guichet.
 * - `computePosition` : rang PULL via
 *   `rank() OVER (PARTITION BY queue_id ORDER BY priority DESC, issued_at)`.
 *
 * Toutes les requêtes s'exécutent dans la transaction fournie (`tx`).
 *
 * @module
 */

import type { Client, PoolClient } from "pg";

/** Client de transaction PostgreSQL (Client ou PoolClient). */
export type Tx = Client | PoolClient;

/** Ligne minimale d'un ticket sélectionné. */
export interface SelectedTicket {
  id: string;
  queueId: string;
  serviceId: string;
  status: string;
  priority: string;
  issuedAt: Date;
}

/**
 * Interface de sélection du prochain ticket d'un guichet.
 * API-003 fournit `selectNextFifo` ; API-004 injectera une stratégie prioritaire.
 */
export type TicketSelector = (
  queueId: string,
  counterId: string,
  tx: Tx
) => Promise<SelectedTicket | null>;

/**
 * Sélectionne, verrouille et retourne le prochain WAITING de la file (FIFO).
 *
 * `FOR UPDATE SKIP LOCKED` garantit qu'un ticket ne peut être pris par deux
 * guichets concurrents. Ordre : `priority DESC, issued_at ASC` (FIFO à priorité
 * neutre en API-003 ; l'ordre priority prépare API-004).
 *
 * @param queueId   - File ciblée
 * @param _counterId - Guichet appelant (utilisé par la stratégie API-004)
 * @param tx        - Transaction courante
 * @returns Le ticket sélectionné, ou `null` si la file est vide
 */
export const selectNextFifo: TicketSelector = async (queueId, _counterId, tx) => {
  const res = await tx.query(
    `SELECT id, queue_id, service_id, status, priority, issued_at
       FROM tickets
      WHERE queue_id = $1 AND status = 'WAITING'
      ORDER BY priority DESC, issued_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED`,
    [queueId]
  );
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
 * Calcule la position PULL d'un ticket dans sa file via `rank()`.
 *
 * `rank() OVER (PARTITION BY queue_id ORDER BY priority DESC, issued_at)` parmi
 * les WAITING. Un ticket non-WAITING (appelé/servi/clôturé) a une position 0.
 *
 * @param ticketId - Ticket dont on veut la position
 * @param tx       - Transaction / connexion courante
 * @returns Position 1-based parmi les WAITING, ou 0 si hors file d'attente
 */
export async function computePosition(ticketId: string, tx: Tx): Promise<number> {
  const res = await tx.query(
    `WITH ranked AS (
       SELECT id,
              rank() OVER (
                PARTITION BY queue_id
                ORDER BY priority DESC, issued_at
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

/**
 * Compte les WAITING d'une file (longueur pour `queue:updated`).
 *
 * @param queueId - File ciblée
 * @param tx      - Transaction / connexion courante
 * @returns Nombre de tickets WAITING
 */
export async function queueLength(queueId: string, tx: Tx): Promise<number> {
  const res = await tx.query(
    `SELECT COUNT(*)::int AS n FROM tickets WHERE queue_id = $1 AND status = 'WAITING'`,
    [queueId]
  );
  return (res.rows[0] as { n: number }).n;
}
