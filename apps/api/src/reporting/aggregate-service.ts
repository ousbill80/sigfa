/**
 * REP-001 — Service d'agrégats reporting (couture DB ↔ moteur pur `sla-engine`).
 *
 * Responsabilités :
 * 1. **Recalc idempotent** (`recalcAgencyDay`) : recalcule un jour Abidjan depuis
 *    `tickets` (+ `agent_status_history`) vers la table matérialisée
 *    `daily_agency_stats` (DB-006), rejouable sans doublon (upsert sur index uniques).
 * 2. **Lecture + agrégation** (`loadAgencyAggregate`) : lit les lignes toutes-services
 *    d'une période et les SOMME en un `DailyStatsAggregate` (base de l'agrégation
 *    multi-jours — somme puis division, jamais moyenne de moyennes).
 * 3. **Réponse KPI** (`computeAgencyKpiResponse`) : applique le moteur pur et
 *    calcule le champ `partial` (jour figé à J+2 07:00 Abidjan — horloge injectée).
 *
 * Toute l'I/O passe par une `QueryFn` paramétrée (injection, testabilité, DB-009 :
 * aucune interpolation de valeur dans le SQL).
 *
 * ## Dérivation D2 depuis les colonnes DB-006
 * - `servedCount` (base attente = tickets appelés) = `tickets_served` (DONE) + `tickets_no_show`
 *   (NO_SHOW = appelé mais absent). L'ABANDONED n'est jamais appelé.
 * - `slaTotalCount` provient de la colonne matérialisée (recalc ci-dessous : appelés + abandonnés).
 * - `agent_available_seconds` : matérialisé par ce service (D2), non stocké par DB-006 d'origine.
 *
 * @module
 */

import {
  computeKpiSet,
  sumAggregates,
  emptyAggregate,
  isDayPartial,
  ABIDJAN_TZ,
  type DailyStatsAggregate,
  type KpiSet,
} from "src/reporting/sla-engine.js";

/**
 * Fonction de requête SQL paramétrée (compatible `pg.Client.query(text, values)`
 * et le harness Testcontainers). DB-009 : valeurs en paramètres positionnels.
 */
export type QueryFn = (
  sql: string,
  values?: unknown[]
) => Promise<{ rows: Array<Record<string, unknown>> }>;

/** Ligne brute (colonnes utiles) d'un agrégat toutes-services `daily_agency_stats`. */
export interface DailyStatsRow {
  /** Tickets émis. */
  tickets_issued: number;
  /** Tickets DONE. */
  tickets_served: number;
  /** Tickets ABANDONED. */
  tickets_abandoned: number;
  /** Tickets NO_SHOW. */
  tickets_no_show: number;
  /** Somme attente (secondes). */
  total_wait_seconds: number;
  /** Somme service (secondes). */
  total_service_seconds: number;
  /** Tickets respectant le SLA d'attente. */
  sla_met_count: number;
  /** Tickets éligibles SLA. */
  sla_total_count: number;
  /** Nombre de feedbacks. */
  feedback_count: number;
  /** Promoteurs NPS. */
  nps_promoters: number;
  /** Passifs NPS. */
  nps_passives: number;
  /** Détracteurs NPS. */
  nps_detractors: number;
  /** Secondes d'activité agent (null si aucune donnée). */
  agent_active_seconds: number | null;
  /** Secondes de disponibilité agent (null si aucune donnée). */
  agent_available_seconds: number | null;
}

/**
 * Convertit une valeur SQL (potentiellement `string` renvoyée par `pg` pour les
 * entiers) en `number`. Retourne `0` pour null/undefined.
 */
function toInt(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : parseInt(String(value), 10);
}

/** Convertit une valeur SQL nullable en `number | null` (pour l'occupation). */
function toNullableInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : parseInt(String(value), 10);
}

/**
 * Mappe une ligne `daily_agency_stats` vers l'agrégat moteur `DailyStatsAggregate`,
 * en appliquant les dérivations D2 (voir en-tête de module).
 *
 * @param row - Ligne toutes-services de `daily_agency_stats`
 * @returns Agrégat consommable par `sla-engine`
 */
export function mapRowToAggregate(row: DailyStatsRow): DailyStatsAggregate {
  const doneCount = toInt(row.tickets_served);
  const noShowCount = toInt(row.tickets_no_show);
  return {
    ticketsIssued: toInt(row.tickets_issued),
    // Base attente D2 : tickets ayant reçu un 1er appel = DONE + NO_SHOW.
    servedCount: doneCount + noShowCount,
    doneCount,
    abandonedCount: toInt(row.tickets_abandoned),
    noShowCount,
    totalWaitSeconds: toInt(row.total_wait_seconds),
    totalServiceSeconds: toInt(row.total_service_seconds),
    slaMetCount: toInt(row.sla_met_count),
    slaTotalCount: toInt(row.sla_total_count),
    feedbackCount: toInt(row.feedback_count),
    npsPromoters: toInt(row.nps_promoters),
    npsPassives: toInt(row.nps_passives),
    npsDetractors: toInt(row.nps_detractors),
    agentActiveSeconds: toNullableInt(row.agent_active_seconds),
    agentAvailableSeconds: toNullableInt(row.agent_available_seconds),
  };
}

/**
 * Lit les agrégats toutes-services (`service_id IS NULL`) d'une agence sur une
 * plage de jours civils Abidjan `[dayStart, dayEnd]` (bornes incluses) et les
 * SOMME en un unique `DailyStatsAggregate`.
 *
 * L'agrégation multi-jours se fait par somme des mesures brutes — les moyennes
 * sont recalculées ensuite par le moteur (jamais moyenne de moyennes).
 *
 * @param query    - Requête paramétrée
 * @param bankId   - Tenant (banque)
 * @param agencyId - Agence
 * @param dayStart - Jour civil Abidjan de début (YYYY-MM-DD, inclus)
 * @param dayEnd   - Jour civil Abidjan de fin (YYYY-MM-DD, inclus)
 * @returns Agrégat somme (vide si aucune ligne)
 */
export async function loadAgencyAggregate(
  query: QueryFn,
  bankId: string,
  agencyId: string,
  dayStart: string,
  dayEnd: string
): Promise<DailyStatsAggregate> {
  const res = await query(
    `SELECT tickets_issued, tickets_served, tickets_abandoned, tickets_no_show,
            total_wait_seconds, total_service_seconds, sla_met_count, sla_total_count,
            feedback_count, nps_promoters, nps_passives, nps_detractors,
            agent_active_seconds, agent_available_seconds
       FROM daily_agency_stats
      WHERE bank_id = $1 AND agency_id = $2 AND service_id IS NULL
        AND day >= $3::date AND day <= $4::date
      ORDER BY day ASC`,
    [bankId, agencyId, dayStart, dayEnd]
  );
  const aggregates = res.rows.map((r) => mapRowToAggregate(r as unknown as DailyStatsRow));
  return sumAggregates(aggregates);
}

/** Options de calcul d'une réponse KPI d'agence. */
export interface AgencyKpiOptions {
  /** Tenant (banque). */
  bankId: string;
  /** Agence. */
  agencyId: string;
  /** Jour civil Abidjan de début (inclus). */
  dayStart: string;
  /** Jour civil Abidjan de fin (inclus). */
  dayEnd: string;
  /** Horloge injectée (détermine `partial`). */
  now: Date;
}

/** Forme interne de la réponse KPI d'agence (conforme CONTRACT-006 `KpiResponse`). */
export interface AgencyKpiResponse {
  /** Les 7 KPIs typés. */
  kpis: KpiSet;
  /**
   * `true` si la fenêtre inclut un jour non encore figé (jour figé à J+2 07:00
   * Abidjan). Champ additif CONTRACT-013 — exposé sur la réponse KPI.
   */
  partial: boolean;
}

/**
 * Calcule les 7 KPIs d'une agence sur une période et le champ `partial`.
 *
 * `partial = true` dès qu'AU MOINS un jour de la fenêtre `[dayStart, dayEnd]`
 * n'est pas encore figé (agrégat susceptible d'évoluer). L'horloge est injectée.
 *
 * @param query   - Requête paramétrée
 * @param options - Bornes, tenant, agence et horloge
 * @returns KPIs + `partial`
 */
export async function computeAgencyKpiResponse(
  query: QueryFn,
  options: AgencyKpiOptions
): Promise<AgencyKpiResponse> {
  const { bankId, agencyId, dayStart, dayEnd, now } = options;
  const aggregate = await loadAgencyAggregate(query, bankId, agencyId, dayStart, dayEnd);
  return {
    kpis: computeKpiSet(aggregate),
    partial: isWindowPartial(dayStart, dayEnd, now),
  };
}

/**
 * Une fenêtre est partielle si son dernier jour n'est pas encore figé
 * (le dernier jour est toujours le plus récent, donc le plus tardif à figer).
 */
function isWindowPartial(dayStart: string, dayEnd: string, now: Date): boolean {
  // dayEnd ≥ dayStart : le jour le plus récent conditionne le figeage global.
  const latest = dayEnd >= dayStart ? dayEnd : dayStart;
  return isDayPartial(latest, now);
}

// ─────────────────────────────────────────────────────────────────────────────
// Recalc idempotent depuis `tickets` + `agent_status_history` (upsert DB-006)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recalcule l'agrégat toutes-services d'une agence pour un jour civil Abidjan et
 * l'insère/met à jour dans `daily_agency_stats` (upsert idempotent, rejouable).
 *
 * Matérialise, en plus des colonnes DB-006, `agent_active_seconds` (temps agent en
 * AVAILABLE/SERVING) ET `agent_available_seconds` (temps agent « disponible » =
 * en service hors pause/déconnexion) — base par-agent de l'occupation (D2).
 *
 * SLA d'attente : `wait_time_seconds ≤ sla_minutes × 60` (borne ≤ inclusive).
 * `sla_total_count` = tickets appelés (DONE + NO_SHOW) + abandonnés (abandon = non-met).
 *
 * @param query    - Requête paramétrée (connexion migrateur/BYPASSRLS pour écrire l'agrégat)
 * @param day      - Jour civil Abidjan (YYYY-MM-DD)
 * @param agencyId - Agence
 * @param bankId   - Tenant (banque)
 * @returns Nombre de lignes toutes-services présentes après upsert (0 ou 1)
 */
export async function recalcAgencyDay(
  query: QueryFn,
  day: string,
  agencyId: string,
  bankId: string
): Promise<number> {
  await query(
    `
    WITH ticket_stats AS (
      SELECT
        COUNT(*)                                                          AS tickets_issued,
        COUNT(*) FILTER (WHERE status = 'DONE')                          AS tickets_served,
        COUNT(*) FILTER (WHERE status = 'ABANDONED')                     AS tickets_abandoned,
        COUNT(*) FILTER (WHERE status = 'NO_SHOW')                       AS tickets_no_show,
        COALESCE(SUM(wait_time_seconds) FILTER (WHERE status = 'DONE'), 0)     AS total_wait_seconds,
        COALESCE(SUM(service_time_seconds) FILTER (WHERE status = 'DONE'), 0)  AS total_service_seconds,
        -- SLA total (D2) : appelés (DONE + NO_SHOW) + abandonnés
        COUNT(*) FILTER (WHERE status IN ('DONE','NO_SHOW','ABANDONED'))       AS sla_total_count,
        -- SLA met : attente ≤ SLA_service (borne ≤ inclusive)
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
        COUNT(*) FILTER (WHERE status = 'DONE' AND feedback_score = 5)   AS nps_promoters,
        COUNT(*) FILTER (WHERE status = 'DONE' AND feedback_score = 4)   AS nps_passives,
        COUNT(*) FILTER (WHERE status = 'DONE' AND feedback_score <= 3 AND feedback_score IS NOT NULL) AS nps_detractors
      FROM tickets
      WHERE bank_id = $1
        AND agency_id = $2
        AND (issued_at AT TIME ZONE '${ABIDJAN_TZ}')::date = $3::date
    ),
    -- Intervalles agent : durée entre transitions chronologiques par agent
    agent_intervals AS (
      SELECT
        to_status,
        EXTRACT(EPOCH FROM (
          LEAD(changed_at) OVER (PARTITION BY agent_id ORDER BY changed_at) - changed_at
        ))::integer AS seconds
      FROM agent_status_history
      WHERE bank_id = $1
        AND agency_id = $2
        AND (changed_at AT TIME ZONE '${ABIDJAN_TZ}')::date = $3::date
    ),
    agent_stats AS (
      SELECT
        -- active : ticket ouvert (AVAILABLE ou SERVING)
        COALESCE(SUM(seconds) FILTER (WHERE to_status IN ('AVAILABLE','SERVING') AND seconds > 0), 0)::integer AS agent_active_seconds,
        -- available : en service (AVAILABLE/SERVING), hors pause/déconnexion
        COALESCE(SUM(seconds) FILTER (WHERE to_status IN ('AVAILABLE','SERVING') AND seconds > 0), 0)::integer AS agent_available_seconds,
        COUNT(*) AS entry_count
      FROM agent_intervals
    )
    INSERT INTO daily_agency_stats (
      bank_id, agency_id, service_id, day,
      tickets_issued, tickets_served, tickets_abandoned, tickets_no_show,
      total_wait_seconds, total_service_seconds,
      sla_met_count, sla_total_count,
      feedback_count, feedback_sum,
      nps_promoters, nps_passives, nps_detractors,
      agent_active_seconds, agent_available_seconds,
      updated_at
    )
    SELECT
      $1, $2, NULL, $3::date,
      ts.tickets_issued, ts.tickets_served, ts.tickets_abandoned, ts.tickets_no_show,
      ts.total_wait_seconds, ts.total_service_seconds,
      ts.sla_met_count, ts.sla_total_count,
      ts.feedback_count, ts.feedback_sum,
      ts.nps_promoters, ts.nps_passives, ts.nps_detractors,
      CASE WHEN ag.entry_count > 0 THEN ag.agent_active_seconds ELSE NULL END,
      CASE WHEN ag.entry_count > 0 THEN ag.agent_available_seconds ELSE NULL END,
      now()
    FROM ticket_stats ts
    CROSS JOIN agent_stats ag
    ON CONFLICT (bank_id, agency_id, day) WHERE service_id IS NULL
    DO UPDATE SET
      tickets_issued        = EXCLUDED.tickets_issued,
      tickets_served        = EXCLUDED.tickets_served,
      tickets_abandoned     = EXCLUDED.tickets_abandoned,
      tickets_no_show       = EXCLUDED.tickets_no_show,
      total_wait_seconds    = EXCLUDED.total_wait_seconds,
      total_service_seconds = EXCLUDED.total_service_seconds,
      sla_met_count         = EXCLUDED.sla_met_count,
      sla_total_count       = EXCLUDED.sla_total_count,
      feedback_count        = EXCLUDED.feedback_count,
      feedback_sum          = EXCLUDED.feedback_sum,
      nps_promoters         = EXCLUDED.nps_promoters,
      nps_passives          = EXCLUDED.nps_passives,
      nps_detractors        = EXCLUDED.nps_detractors,
      agent_active_seconds  = EXCLUDED.agent_active_seconds,
      agent_available_seconds = EXCLUDED.agent_available_seconds,
      updated_at            = EXCLUDED.updated_at
    `,
    [bankId, agencyId, day]
  );
  const count = await query(
    `SELECT COUNT(*)::int AS c FROM daily_agency_stats
      WHERE bank_id = $1 AND agency_id = $2 AND day = $3::date AND service_id IS NULL`,
    [bankId, agencyId, day]
  );
  return toInt(count.rows[0]?.["c"]);
}

/** Agrégat vide réexporté pour les appelants (routes) qui construisent une réponse par défaut. */
export { emptyAggregate };
