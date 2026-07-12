/**
 * agent-stats — statistiques de performance d'un agent (API-007, agents.yaml §243).
 *
 * LA LOI (AgentStats) :
 *  - `ticketsHandled`  : nombre de tickets traités (DONE) sur la période.
 *  - `avgHandlingTime` : TMT moyen en secondes sur le jour (service_time_seconds).
 *  - `currentTicket`   : ticket en cours (numéro + durée chronométrée), ou null.
 *
 * Fenêtre « jour » ancrée sur Africa/Abidjan (colonne générée `issued_day`).
 * La règle « self » (AGENT ne lit que ses stats ; MANAGER+ dans son scope) est
 * appliquée en amont dans la route.
 *
 * @module
 */

import type { Client, PoolClient } from "pg";

/** Client PG (connexion ou transaction). */
type Db = Client | PoolClient;

/** Périodes d'agrégation supportées (LA LOI). */
export type StatsPeriod = "day" | "week" | "month";

/** Ticket en cours résumé (LA LOI CurrentTicketSummary). */
export interface CurrentTicketSummary {
  ticketId: string;
  number: string;
  durationSeconds: number;
}

/** Statistiques agrégées d'un agent (LA LOI AgentStats). */
export interface AgentStats {
  agentId: string;
  period: StatsPeriod;
  ticketsHandled: number;
  avgHandlingTime: number;
  currentTicket: CurrentTicketSummary | null;
}

/** Nombre de jours couverts par chaque période (fenêtre glissante). */
const PERIOD_DAYS: Record<StatsPeriod, number> = {
  day: 1,
  week: 7,
  month: 30,
};

/**
 * Calcule les statistiques d'un agent pour la période demandée.
 *
 * @param db      - Connexion PG
 * @param agentId - Agent ciblé
 * @param bankId  - Tenant (borne les requêtes)
 * @param period  - Période d'agrégation (day | week | month)
 * @returns Statistiques conformes au contrat AgentStats
 */
export async function computeAgentStats(
  db: Db,
  agentId: string,
  bankId: string,
  period: StatsPeriod
): Promise<AgentStats> {
  const days = PERIOD_DAYS[period];
  const handled = await aggregateHandled(db, agentId, bankId, days);
  const current = await findCurrentTicket(db, agentId, bankId);
  return {
    agentId,
    period,
    ticketsHandled: handled.ticketsHandled,
    avgHandlingTime: handled.avgHandlingTime,
    currentTicket: current,
  };
}

/** Agrège tickets traités + TMT moyen sur la fenêtre (Africa/Abidjan). */
async function aggregateHandled(
  db: Db,
  agentId: string,
  bankId: string,
  days: number
): Promise<{ ticketsHandled: number; avgHandlingTime: number }> {
  const res = await db.query(
    `SELECT COUNT(*)::int AS handled,
            COALESCE(ROUND(AVG(service_time_seconds)), 0)::int AS avg_tmt
       FROM tickets
      WHERE agent_id = $1
        AND bank_id = $2
        AND status = 'DONE'
        AND issued_day > ((NOW() AT TIME ZONE 'Africa/Abidjan')::date - $3::int)`,
    [agentId, bankId, days]
  );
  const row = res.rows[0] as { handled: number; avg_tmt: number };
  return { ticketsHandled: row.handled, avgHandlingTime: row.avg_tmt };
}

/** Trouve le ticket CALLED/SERVING en cours et chronomètre sa durée. */
async function findCurrentTicket(
  db: Db,
  agentId: string,
  bankId: string
): Promise<CurrentTicketSummary | null> {
  const res = await db.query(
    `SELECT id, number, display_number,
            GREATEST(0, EXTRACT(EPOCH FROM (NOW() - COALESCE(served_at, called_at)))::int) AS duration
       FROM tickets
      WHERE agent_id = $1 AND bank_id = $2 AND status IN ('CALLED','SERVING')
      ORDER BY called_at DESC LIMIT 1`,
    [agentId, bankId]
  );
  const row = res.rows[0] as
    | { id: string; number: number; display_number: string | null; duration: number }
    | undefined;
  if (!row) return null;
  return {
    ticketId: row.id,
    number: row.display_number ?? `A${String(row.number).padStart(3, "0")}`,
    durationSeconds: row.duration,
  };
}
