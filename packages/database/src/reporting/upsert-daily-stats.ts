/**
 * DB-006 — `upsertDailyStats` : recalcul idempotent des agrégats journaliers.
 *
 * Recalcule depuis `tickets` (source de vérité) et insère ou met à jour
 * la ligne correspondante dans `daily_agency_stats` (upsert idempotent).
 *
 * ## Idempotence
 * Rejouable sans doublon grâce aux index uniques partiels :
 * - `WHERE service_id IS NULL`     → agrégat toutes-services
 * - `WHERE service_id IS NOT NULL` → agrégat par service
 *
 * L'orchestration (cron quotidien) est REP-001 — hors périmètre DB-006.
 *
 * ## Source de `agent_active_seconds`
 * Agrégation depuis `agent_status_history` (DB-001) : somme des intervalles
 * où l'agent est en statut AVAILABLE ou SERVING dans la journée.
 * La logique calcule la durée entre chaque transition chronologique.
 *
 * @module
 */

/** Fonction de requête SQL compatible avec `DualConnectionHarness.query`. */
type QueryFn = (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;

/**
 * Recalcule et upserte les agrégats journaliers pour une agence donnée.
 *
 * Insère ou met à jour DEUX lignes dans `daily_agency_stats` :
 * 1. Une ligne toutes-services (`service_id IS NULL`)
 * 2. Une ligne par service actif ce jour (`service_id IS NOT NULL`)
 *
 * @param query     - Connexion migrateur (BYPASSRLS, pour écrire dans la table agrégat)
 * @param day       - Date de l'agrégat (format 'YYYY-MM-DD', timezone Africa/Abidjan)
 * @param agencyId  - UUID de l'agence
 * @param bankId    - UUID de la banque (tenant)
 * @returns Nombre de lignes insérées ou mises à jour
 */
export async function upsertDailyStats(
  query: QueryFn,
  day: string,
  agencyId: string,
  bankId: string
): Promise<number> {
  // ── 1. Agrégat toutes-services (service_id IS NULL) ─────────────────────────
  await query(`
    WITH ticket_stats AS (
      SELECT
        COUNT(*)                                                          AS tickets_issued,
        COUNT(*) FILTER (WHERE status = 'DONE')                          AS tickets_served,
        COUNT(*) FILTER (WHERE status = 'ABANDONED')                     AS tickets_abandoned,
        COUNT(*) FILTER (WHERE status = 'NO_SHOW')                       AS tickets_no_show,
        COALESCE(SUM(wait_time_seconds) FILTER (WHERE status = 'DONE'), 0)     AS total_wait_seconds,
        COALESCE(SUM(service_time_seconds) FILTER (WHERE status = 'DONE'), 0)  AS total_service_seconds,
        -- SLA : comparaison avec sla_minutes de la table services
        COUNT(*) FILTER (
          WHERE status = 'DONE'
            AND wait_time_seconds IS NOT NULL
            AND service_time_seconds IS NOT NULL
        )                                                                 AS sla_total_count,
        COUNT(*) FILTER (
          WHERE status = 'DONE'
            AND wait_time_seconds IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM services s
              WHERE s.id = tickets.service_id
                AND tickets.wait_time_seconds <= s.sla_minutes * 60
            )
        )                                                                 AS sla_met_count,
        COUNT(*) FILTER (WHERE status = 'DONE' AND feedback_score IS NOT NULL)  AS feedback_count,
        COALESCE(SUM(feedback_score) FILTER (WHERE status = 'DONE' AND feedback_score IS NOT NULL), 0) AS feedback_sum,
        -- NPS : score 5 = promoteur, score 4 = passif, score ≤ 3 = détracteur
        COUNT(*) FILTER (WHERE status = 'DONE' AND feedback_score = 5)   AS nps_promoters,
        COUNT(*) FILTER (WHERE status = 'DONE' AND feedback_score = 4)   AS nps_passives,
        COUNT(*) FILTER (WHERE status = 'DONE' AND feedback_score <= 3 AND feedback_score IS NOT NULL) AS nps_detractors
      FROM tickets
      WHERE bank_id = '${bankId}'
        AND agency_id = '${agencyId}'
        AND (issued_at AT TIME ZONE 'Africa/Abidjan')::date = '${day}'::date
    ),
    agent_stats AS (
      SELECT COALESCE(SUM(active_seconds), 0)::integer AS agent_active_seconds
      FROM (
        SELECT
          CASE
            WHEN to_status IN ('AVAILABLE', 'SERVING') THEN
              EXTRACT(EPOCH FROM (
                LEAD(changed_at) OVER (PARTITION BY agent_id ORDER BY changed_at)
                - changed_at
              ))::integer
            ELSE 0
          END AS active_seconds
        FROM agent_status_history
        WHERE bank_id = '${bankId}'
          AND agency_id = '${agencyId}'
          AND (changed_at AT TIME ZONE 'Africa/Abidjan')::date = '${day}'::date
      ) intervals
      WHERE active_seconds IS NOT NULL AND active_seconds > 0
    )
    INSERT INTO daily_agency_stats (
      bank_id, agency_id, service_id, day,
      tickets_issued, tickets_served, tickets_abandoned, tickets_no_show,
      total_wait_seconds, total_service_seconds,
      sla_met_count, sla_total_count,
      feedback_count, feedback_sum,
      nps_promoters, nps_passives, nps_detractors,
      agent_active_seconds,
      updated_at
    )
    SELECT
      '${bankId}',
      '${agencyId}',
      NULL,
      '${day}'::date,
      ts.tickets_issued,
      ts.tickets_served,
      ts.tickets_abandoned,
      ts.tickets_no_show,
      ts.total_wait_seconds,
      ts.total_service_seconds,
      ts.sla_met_count,
      ts.sla_total_count,
      ts.feedback_count,
      ts.feedback_sum,
      ts.nps_promoters,
      ts.nps_passives,
      ts.nps_detractors,
      ag.agent_active_seconds,
      now()
    FROM ticket_stats ts
    CROSS JOIN agent_stats ag
    ON CONFLICT (bank_id, agency_id, day)
      WHERE service_id IS NULL
    DO UPDATE SET
      tickets_issued       = EXCLUDED.tickets_issued,
      tickets_served       = EXCLUDED.tickets_served,
      tickets_abandoned    = EXCLUDED.tickets_abandoned,
      tickets_no_show      = EXCLUDED.tickets_no_show,
      total_wait_seconds   = EXCLUDED.total_wait_seconds,
      total_service_seconds = EXCLUDED.total_service_seconds,
      sla_met_count        = EXCLUDED.sla_met_count,
      sla_total_count      = EXCLUDED.sla_total_count,
      feedback_count       = EXCLUDED.feedback_count,
      feedback_sum         = EXCLUDED.feedback_sum,
      nps_promoters        = EXCLUDED.nps_promoters,
      nps_passives         = EXCLUDED.nps_passives,
      nps_detractors       = EXCLUDED.nps_detractors,
      agent_active_seconds = EXCLUDED.agent_active_seconds,
      updated_at           = EXCLUDED.updated_at
  `);

  // ── 2. Agrégats par service (service_id IS NOT NULL) ──────────────────────
  // Pour chaque service actif ce jour, insérer/mettre à jour une ligne
  await query(`
    INSERT INTO daily_agency_stats (
      bank_id, agency_id, service_id, day,
      tickets_issued, tickets_served, tickets_abandoned, tickets_no_show,
      total_wait_seconds, total_service_seconds,
      sla_met_count, sla_total_count,
      feedback_count, feedback_sum,
      nps_promoters, nps_passives, nps_detractors,
      agent_active_seconds,
      updated_at
    )
    SELECT
      '${bankId}',
      '${agencyId}',
      t.service_id,
      '${day}'::date,
      COUNT(*)                                                                 AS tickets_issued,
      COUNT(*) FILTER (WHERE t.status = 'DONE')                               AS tickets_served,
      COUNT(*) FILTER (WHERE t.status = 'ABANDONED')                          AS tickets_abandoned,
      COUNT(*) FILTER (WHERE t.status = 'NO_SHOW')                            AS tickets_no_show,
      COALESCE(SUM(t.wait_time_seconds) FILTER (WHERE t.status = 'DONE'), 0)      AS total_wait_seconds,
      COALESCE(SUM(t.service_time_seconds) FILTER (WHERE t.status = 'DONE'), 0)   AS total_service_seconds,
      COUNT(*) FILTER (
        WHERE t.status = 'DONE'
          AND t.wait_time_seconds IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM services s
            WHERE s.id = t.service_id
              AND t.wait_time_seconds <= s.sla_minutes * 60
          )
      )                                                                        AS sla_met_count,
      COUNT(*) FILTER (
        WHERE t.status = 'DONE'
          AND t.wait_time_seconds IS NOT NULL
          AND t.service_time_seconds IS NOT NULL
      )                                                                        AS sla_total_count,
      COUNT(*) FILTER (WHERE t.status = 'DONE' AND t.feedback_score IS NOT NULL) AS feedback_count,
      COALESCE(SUM(t.feedback_score) FILTER (WHERE t.status = 'DONE' AND t.feedback_score IS NOT NULL), 0) AS feedback_sum,
      COUNT(*) FILTER (WHERE t.status = 'DONE' AND t.feedback_score = 5)      AS nps_promoters,
      COUNT(*) FILTER (WHERE t.status = 'DONE' AND t.feedback_score = 4)      AS nps_passives,
      COUNT(*) FILTER (WHERE t.status = 'DONE' AND t.feedback_score <= 3 AND t.feedback_score IS NOT NULL) AS nps_detractors,
      NULL::integer,
      now()
    FROM tickets t
    WHERE t.bank_id = '${bankId}'
      AND t.agency_id = '${agencyId}'
      AND (t.issued_at AT TIME ZONE 'Africa/Abidjan')::date = '${day}'::date
    GROUP BY t.service_id
    ON CONFLICT (bank_id, agency_id, service_id, day)
      WHERE service_id IS NOT NULL
    DO UPDATE SET
      tickets_issued       = EXCLUDED.tickets_issued,
      tickets_served       = EXCLUDED.tickets_served,
      tickets_abandoned    = EXCLUDED.tickets_abandoned,
      tickets_no_show      = EXCLUDED.tickets_no_show,
      total_wait_seconds   = EXCLUDED.total_wait_seconds,
      total_service_seconds = EXCLUDED.total_service_seconds,
      sla_met_count        = EXCLUDED.sla_met_count,
      sla_total_count      = EXCLUDED.sla_total_count,
      feedback_count       = EXCLUDED.feedback_count,
      feedback_sum         = EXCLUDED.feedback_sum,
      nps_promoters        = EXCLUDED.nps_promoters,
      nps_passives         = EXCLUDED.nps_passives,
      nps_detractors       = EXCLUDED.nps_detractors,
      updated_at           = EXCLUDED.updated_at
  `);

  // Retourner le nombre de lignes dans daily_agency_stats pour cette agence/jour
  const result = await query(`
    SELECT COUNT(*)::integer AS count
    FROM daily_agency_stats
    WHERE bank_id = '${bankId}'
      AND agency_id = '${agencyId}'
      AND day = '${day}'::date
  `);
  return parseInt(String(result.rows[0]?.["count"] ?? "0"), 10);
}
