/**
 * IA-001 — Extraction des observations horaires (couture DB → moteur pur).
 *
 * Dérive les observations brutes `RawBucketObservation` depuis les FAITS SIGFA du
 * tenant :
 *  - **granularité bucket** (heure/30 min) : agrégation des `tickets` par bucket
 *    d'`issued_at` en fuseau Africa/Abidjan (arrivals, served, no_show, abandoned,
 *    sommes d'attente/service, p90 d'attente). Le rattachement au jour suit REP-001
 *    (émission `issued_at`, `AT TIME ZONE 'Africa/Abidjan'`).
 *  - **occupation** : `counters_open` / `agents_active` observés par bucket depuis
 *    `agent_status_history` (nb d'agents/guichets distincts actifs sur le bucket).
 *
 * ## Isolation tenant STRICTE (worker hors RLS — pattern D5)
 * Toute requête filtre `bank_id = $1`. Le service NE lit jamais hors du `bankId`
 * fourni. L'appelant (`feature-pipeline.ts`) ouvre `withTenant(bankId)` : la
 * `QueryFn` reçue est donc scopée à la transaction tenant.
 *
 * ## DB-009 — zéro interpolation de valeur
 * Toutes les valeurs passent en paramètres positionnels (`$1..$n`). Seul le nom de
 * fuseau IANA (`ABIDJAN_TZ`, constante) et la largeur de bucket (entier validé)
 * apparaissent en littéral SQL, jamais une donnée utilisateur.
 *
 * ## Zéro PII
 * Aucune colonne personnelle n'est sélectionnée (pas de phone, nom, agent_id en
 * clair dans la sortie — seuls des COUNT/SUM/agrégats).
 *
 * @module
 */

import { ABIDJAN_TZ } from "src/reporting/sla-engine.js";
import type { QueryFn } from "src/reporting/aggregate-service.js";
import type { BucketMinutes, RawBucketObservation } from "src/ai/feature-engine.js";

/** Paramètres d'extraction d'une fenêtre historique (backtest / matérialisation). */
export interface ExtractionWindow {
  /** Tenant (banque) — isolation stricte. */
  readonly bankId: string;
  /** Jour civil Abidjan de début (YYYY-MM-DD, inclus). */
  readonly dayStart: string;
  /** Jour civil Abidjan de fin (YYYY-MM-DD, inclus). */
  readonly dayEnd: string;
  /** Largeur de bucket en minutes (30 ou 60). Défaut 60. */
  readonly bucketMinutes?: BucketMinutes;
  /**
   * Si `true`, agrège par service (`serviceId` renseigné). Si `false` (défaut),
   * agrège tous services confondus (`serviceId = null`).
   */
  readonly byService?: boolean;
}

/** Convertit une valeur SQL (entier possiblement string via pg) en number. */
function toInt(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : parseInt(String(value), 10);
}

/** Convertit une valeur SQL (float possiblement string via pg) en number. */
function toFloat(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : parseFloat(String(value));
}

/** Valide la largeur de bucket et renvoie le nombre de secondes par bucket. */
function bucketSeconds(bucketMinutes: BucketMinutes): number {
  if (bucketMinutes !== 30 && bucketMinutes !== 60) {
    throw new Error(`feature-extraction: bucketMinutes invalide (${String(bucketMinutes)})`);
  }
  return bucketMinutes * 60;
}

/**
 * Extrait les observations horaires brutes de la fenêtre `[dayStart, dayEnd]` pour
 * un tenant, sous la `QueryFn` (supposée scopée `withTenant(bankId)` par l'appelant).
 *
 * @param query  - Requête paramétrée (connexion tenant)
 * @param window - Bornes + tenant + largeur de bucket + granularité service
 * @returns Observations brutes (une par bucket non-vide), consommables par le moteur
 */
export async function extractBucketObservations(
  query: QueryFn,
  window: ExtractionWindow
): Promise<RawBucketObservation[]> {
  const bucketMinutes: BucketMinutes = window.bucketMinutes ?? 60;
  const secs = bucketSeconds(bucketMinutes);
  const byService = window.byService ?? false;

  // Bucket index = floor(seconds_since_midnight_local / bucketSeconds).
  // service_id de sortie : colonne réelle si byService, sinon NULL (agrégat global).
  const serviceSelect = byService ? "t.service_id::text" : "NULL::text";

  const ticketRes = await query(
    `
    WITH bucketed AS (
      SELECT
        t.agency_id,
        ${serviceSelect} AS service_id,
        t.counter_id,
        (t.issued_at AT TIME ZONE '${ABIDJAN_TZ}')::date AS day,
        FLOOR(
          EXTRACT(EPOCH FROM ((t.issued_at AT TIME ZONE '${ABIDJAN_TZ}')
            - date_trunc('day', (t.issued_at AT TIME ZONE '${ABIDJAN_TZ}')))) / $4
        )::int AS hour_bucket,
        t.status,
        t.wait_time_seconds,
        t.service_time_seconds
      FROM tickets t
      WHERE t.bank_id = $1
        AND (t.issued_at AT TIME ZONE '${ABIDJAN_TZ}')::date >= $2::date
        AND (t.issued_at AT TIME ZONE '${ABIDJAN_TZ}')::date <= $3::date
    )
    SELECT
      agency_id::text                                                        AS agency_id,
      service_id,
      to_char(day, 'YYYY-MM-DD')                                             AS day,
      hour_bucket,
      COUNT(*)                                                               AS arrivals,
      COUNT(*) FILTER (WHERE status = 'DONE')                               AS served,
      COUNT(*) FILTER (WHERE status = 'NO_SHOW')                            AS no_show,
      COUNT(*) FILTER (WHERE status = 'ABANDONED')                         AS abandoned,
      COALESCE(SUM(wait_time_seconds) FILTER (WHERE status = 'DONE'), 0)    AS total_wait_seconds,
      COALESCE(SUM(service_time_seconds) FILTER (WHERE status = 'DONE'), 0) AS total_service_seconds,
      COUNT(DISTINCT counter_id) FILTER (WHERE counter_id IS NOT NULL)      AS counters_open,
      COALESCE(
        percentile_cont(0.9) WITHIN GROUP (ORDER BY wait_time_seconds)
          FILTER (WHERE status = 'DONE' AND wait_time_seconds IS NOT NULL),
        0
      )                                                                      AS p90_wait_seconds
    FROM bucketed
    GROUP BY agency_id, service_id, day, hour_bucket
    ORDER BY agency_id, service_id NULLS FIRST, day, hour_bucket
    `,
    [window.bankId, window.dayStart, window.dayEnd, secs]
  );

  // Occupation par bucket : agents distincts actifs (AVAILABLE/SERVING) sur le
  // bucket, depuis l'historique de statut agent (agency-level, tous services).
  const occRes = await query(
    `
    SELECT
      agency_id::text                                     AS agency_id,
      to_char(day, 'YYYY-MM-DD')                          AS day,
      hour_bucket,
      COUNT(DISTINCT agent_id)                            AS agents_active
    FROM (
      SELECT
        h.agency_id,
        h.agent_id,
        (h.changed_at AT TIME ZONE '${ABIDJAN_TZ}')::date AS day,
        FLOOR(
          EXTRACT(EPOCH FROM ((h.changed_at AT TIME ZONE '${ABIDJAN_TZ}')
            - date_trunc('day', (h.changed_at AT TIME ZONE '${ABIDJAN_TZ}')))) / $4
        )::int AS hour_bucket
      FROM agent_status_history h
      WHERE h.bank_id = $1
        AND h.to_status IN ('AVAILABLE','SERVING')
        AND (h.changed_at AT TIME ZONE '${ABIDJAN_TZ}')::date >= $2::date
        AND (h.changed_at AT TIME ZONE '${ABIDJAN_TZ}')::date <= $3::date
    ) occ
    GROUP BY agency_id, day, hour_bucket
    `,
    [window.bankId, window.dayStart, window.dayEnd, secs]
  );

  // Index occupation par (agency, day, bucket) — jointure côté application.
  const agentsByKey = new Map<string, number>();
  for (const row of occRes.rows) {
    const key = `${String(row["agency_id"])}|${String(row["day"])}|${toInt(row["hour_bucket"])}`;
    agentsByKey.set(key, toInt(row["agents_active"]));
  }

  return ticketRes.rows.map((row): RawBucketObservation => {
    const agencyId = String(row["agency_id"]);
    const serviceId = row["service_id"] === null || row["service_id"] === undefined
      ? null
      : String(row["service_id"]);
    const day = String(row["day"]);
    const hourBucket = toInt(row["hour_bucket"]);
    const agentsActive = agentsByKey.get(`${agencyId}|${day}|${hourBucket}`) ?? 0;
    return {
      bankId: window.bankId,
      agencyId,
      serviceId,
      date: day,
      hourBucket,
      bucketMinutes,
      arrivals: toInt(row["arrivals"]),
      served: toInt(row["served"]),
      noShow: toInt(row["no_show"]),
      abandoned: toInt(row["abandoned"]),
      totalWaitSeconds: toInt(row["total_wait_seconds"]),
      p90WaitSeconds: Math.round(toFloat(row["p90_wait_seconds"])),
      totalServiceSeconds: toInt(row["total_service_seconds"]),
      countersOpen: toInt(row["counters_open"]),
      agentsActive,
      // Marquage partiel réel : décidé par le pipeline via l'horloge (jour non figé)
      // et par les données manquantes. À ce stade d'extraction, on ne fabrique rien.
      isPartialSource: false,
    };
  });
}
