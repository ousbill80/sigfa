/**
 * F10-FEATURE-STORE — Matérialisation DB-backed du feature-set IA-001 (`ai_features`).
 *
 * ## Rôle
 * Implémentation RÉELLE (persistante) du contrat `FeatureStore` d'IA-001, adossée à
 * la table `ai_features` (migration 0013). Remplace `InMemoryFeatureStore` quand le
 * feature-store réel est activé (gating, cf. `feature-store-config.ts`).
 *
 * Chaque colonne de `ai_features` reflète UN champ du `FeatureRecord` de
 * `feature-engine.ts` (mêmes noms, mêmes sémantiques ; cf. commentaire de la
 * migration 0013). L'upsert idempotent réutilise la clé canonique
 * `(bank_id, agency_id, service_id, date, hour_bucket, feature_set_version)` avec
 * `NULLS NOT DISTINCT` (PG16) — rejouer la même fenêtre produit exactement les mêmes
 * lignes, exactement comme `InMemoryFeatureStore.upsertMany`.
 *
 * ## Isolation tenant (SEC-002 — ARMÉE)
 * Ce store n'ouvre AUCUNE connexion : il reçoit une `FeatureStoreQuery` INJECTÉE,
 * qui — en production — est la connexion `sigfa_app` NOBYPASSRLS ARMÉE via
 * `withArmedTenant` (`app.current_bank_id`). La policy `tenant_isolation` (0013,
 * FORCE RLS) devient alors réellement contraignante : ni lecture ni écriture ne
 * peut franchir la frontière `bank_id`. Le `WHERE bank_id = $1` applicatif reste
 * une défense-en-profondeur, pas l'unique barrière.
 *
 * ## Pureté du mapping
 * `rowToFeatureRecord` / `featureRecordToParams` sont des fonctions PURES, testables
 * hors DB. Aucune horloge, aucune I/O cachée.
 *
 * @module
 */

import {
  sortByCanonicalKey,
  type BucketMinutes,
  type FeatureRecord,
} from "src/ai/feature-engine.js";
import { CONTEXTUAL_FACTORS, type ContextualFactor } from "src/ai/ci-calendar.js";

/**
 * Fonction de requête SQL paramétrée minimale (adaptée d'une connexion pg armée).
 * En production, elle exécute sous `withArmedTenant` (RLS contraignante) ; en test,
 * un stub la satisfait. La couche store reste PURE de driver.
 */
export type FeatureStoreQuery = (
  sql: string,
  values?: unknown[]
) => Promise<{ rows: Array<Record<string, unknown>> }>;

/** Connexion pg minimale (`query(sql, values?)`) — Client ou connexion armée. */
interface QueryableConnection {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Adapte une connexion pg (Client ou armée) en `FeatureStoreQuery`. */
export function asFeatureStoreQuery(conn: QueryableConnection): FeatureStoreQuery {
  return (sql, values) =>
    conn
      .query(sql, values)
      .then((r) => ({ rows: r.rows as Array<Record<string, unknown>> }));
}

/** Colonnes projetées par les lectures `ai_features` (ordre stable). */
const SELECT_COLUMNS =
  `bank_id, agency_id, service_id, date, hour_bucket, bucket_minutes, ` +
  `arrivals, served, no_show, abandoned, avg_wait_seconds, p90_wait_seconds, ` +
  `avg_service_seconds, counters_open, agents_active, day_of_week, is_month_end, ` +
  `is_public_pay_day, is_public_holiday, is_eve_of_holiday, factors, ` +
  `arrivals_lag_1d, arrivals_lag_7d, arrivals_roll_mean_4w, is_partial, ` +
  `available_days, feature_set_version`;

/** Convertit une valeur DB (Date | string) en jour civil `YYYY-MM-DD`. */
function toDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** Lit un entier depuis une valeur DB (pg renvoie parfois du texte pour bigint). */
function toInt(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

/** Lit un entier nullable depuis une valeur DB. */
function toIntOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : toInt(value);
}

/** Lit un flottant nullable depuis une valeur DB (double precision). */
function toFloatOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** Garde de type : la valeur est un `ContextualFactor` de l'énum fermée. */
function isContextualFactor(value: unknown): value is ContextualFactor {
  return (
    typeof value === "string" &&
    (CONTEXTUAL_FACTORS as readonly string[]).includes(value)
  );
}

/**
 * Normalise le JSONB `factors` en `ContextualFactor[]` (défense : ignore toute
 * valeur hors énum ; `factors` non-tableau → `["NONE"]` par défaut du schéma).
 */
function parseFactors(value: unknown): readonly ContextualFactor[] {
  if (!Array.isArray(value)) return ["NONE"];
  const out = value.filter(isContextualFactor);
  return out.length > 0 ? out : ["NONE"];
}

/** Largeur de bucket validée (30 ou 60) — défense contre une valeur DB corrompue. */
function toBucketMinutes(value: unknown): BucketMinutes {
  return toInt(value) === 30 ? 30 : 60;
}

/**
 * Projette une ligne `ai_features` (snake_case pg) vers un `FeatureRecord`
 * (camelCase). Fonction PURE, testable hors DB.
 *
 * @param row - Ligne brute `ai_features`
 * @returns `FeatureRecord` reconstruit
 */
export function rowToFeatureRecord(row: Record<string, unknown>): FeatureRecord {
  return {
    bankId: String(row["bank_id"]),
    agencyId: String(row["agency_id"]),
    serviceId: row["service_id"] === null || row["service_id"] === undefined
      ? null
      : String(row["service_id"]),
    date: toDateString(row["date"]),
    hourBucket: toInt(row["hour_bucket"]),
    bucketMinutes: toBucketMinutes(row["bucket_minutes"]),
    arrivals: toInt(row["arrivals"]),
    served: toInt(row["served"]),
    noShow: toInt(row["no_show"]),
    abandoned: toInt(row["abandoned"]),
    avgWaitSeconds: toFloatOrNull(row["avg_wait_seconds"]),
    p90WaitSeconds: Number(row["p90_wait_seconds"]),
    avgServiceSeconds: toFloatOrNull(row["avg_service_seconds"]),
    countersOpen: toInt(row["counters_open"]),
    agentsActive: toInt(row["agents_active"]),
    dayOfWeek: toInt(row["day_of_week"]),
    isMonthEnd: Boolean(row["is_month_end"]),
    isPublicPayDay: Boolean(row["is_public_pay_day"]),
    isPublicHoliday: Boolean(row["is_public_holiday"]),
    isEveOfHoliday: Boolean(row["is_eve_of_holiday"]),
    factors: parseFactors(row["factors"]),
    arrivalsLag1d: toIntOrNull(row["arrivals_lag_1d"]),
    arrivalsLag7d: toIntOrNull(row["arrivals_lag_7d"]),
    arrivalsRollMean4w: toFloatOrNull(row["arrivals_roll_mean_4w"]),
    isPartial: Boolean(row["is_partial"]),
    availableDays: toInt(row["available_days"]),
    featureSetVersion: String(row["feature_set_version"]),
  };
}

/**
 * Ordonne les paramètres d'un `FeatureRecord` pour l'INSERT/UPDATE `ai_features`
 * (26 valeurs, alignées sur `INSERT_COLUMNS`). `factors` est sérialisé JSONB.
 * Fonction PURE.
 */
export function featureRecordToParams(r: FeatureRecord): unknown[] {
  return [
    r.bankId,
    r.agencyId,
    r.serviceId,
    r.date,
    r.hourBucket,
    r.bucketMinutes,
    r.arrivals,
    r.served,
    r.noShow,
    r.abandoned,
    r.avgWaitSeconds,
    r.p90WaitSeconds,
    r.avgServiceSeconds,
    r.countersOpen,
    r.agentsActive,
    r.dayOfWeek,
    r.isMonthEnd,
    r.isPublicPayDay,
    r.isPublicHoliday,
    r.isEveOfHoliday,
    JSON.stringify(r.factors),
    r.arrivalsLag1d,
    r.arrivalsLag7d,
    r.arrivalsRollMean4w,
    r.isPartial,
    r.availableDays,
    r.featureSetVersion,
  ];
}

/** Colonnes de l'INSERT `ai_features` (ordre = `featureRecordToParams`). */
const INSERT_COLUMNS =
  `bank_id, agency_id, service_id, date, hour_bucket, bucket_minutes, ` +
  `arrivals, served, no_show, abandoned, avg_wait_seconds, p90_wait_seconds, ` +
  `avg_service_seconds, counters_open, agents_active, day_of_week, is_month_end, ` +
  `is_public_pay_day, is_public_holiday, is_eve_of_holiday, factors, ` +
  `arrivals_lag_1d, arrivals_lag_7d, arrivals_roll_mean_4w, is_partial, ` +
  `available_days, feature_set_version`;

/** Nombre de colonnes insérées (garde la génération des `$n` alignée). */
const INSERT_COLUMN_COUNT = 27;

/** Colonnes mises à jour ON CONFLICT (tout sauf la clé canonique). */
const UPSERT_UPDATE_SET = [
  "bucket_minutes",
  "arrivals",
  "served",
  "no_show",
  "abandoned",
  "avg_wait_seconds",
  "p90_wait_seconds",
  "avg_service_seconds",
  "counters_open",
  "agents_active",
  "day_of_week",
  "is_month_end",
  "is_public_pay_day",
  "is_public_holiday",
  "is_eve_of_holiday",
  "factors",
  "arrivals_lag_1d",
  "arrivals_lag_7d",
  "arrivals_roll_mean_4w",
  "is_partial",
  "available_days",
  "updated_at",
]
  .map((col) => (col === "updated_at" ? `${col} = now()` : `${col} = EXCLUDED.${col}`))
  .join(", ");

/**
 * Store de features DB-backed (`ai_features`). Asynchrone (I/O DB) — étend le
 * contrat `FeatureStore` d'IA-001 en version persistante et tenant-scopée.
 *
 * Toutes les requêtes passent par la `FeatureStoreQuery` injectée (en production :
 * connexion `sigfa_app` ARMÉE via `withArmedTenant`). L'isolation est portée par la
 * RLS FORCE de la table, pas seulement par le `WHERE bank_id` applicatif.
 */
export class DbFeatureStore {
  constructor(private readonly query: FeatureStoreQuery) {}

  /**
   * Upsert idempotent d'un lot de features (ON CONFLICT sur la clé canonique).
   * Renvoie le nombre de lignes appliquées (insérées ou mises à jour).
   *
   * @param records - Features à matérialiser (tous du même tenant en pratique)
   * @returns Nombre de lignes upsertées
   */
  async upsertMany(records: readonly FeatureRecord[]): Promise<number> {
    let applied = 0;
    for (const record of records) {
      const params = featureRecordToParams(record);
      const placeholders = Array.from(
        { length: INSERT_COLUMN_COUNT },
        (_unused, i) => `$${i + 1}`
      ).join(", ");
      const res = await this.query(
        `INSERT INTO ai_features (${INSERT_COLUMNS})
           VALUES (${placeholders})
         ON CONFLICT (bank_id, agency_id, service_id, date, hour_bucket, feature_set_version)
           DO UPDATE SET ${UPSERT_UPDATE_SET}
         RETURNING id`,
        params
      );
      applied += res.rows.length;
    }
    return applied;
  }

  /**
   * Lit toutes les features d'un tenant (triées par clé canonique). `bank_id`
   * provient du tenant armé (jamais du client) — la RLS borne à la banque courante.
   *
   * @param bankId - Tenant (issu du JWT, jamais du client)
   * @returns Features du tenant, triées
   */
  async getByBank(bankId: string): Promise<FeatureRecord[]> {
    const res = await this.query(
      `SELECT ${SELECT_COLUMNS} FROM ai_features WHERE bank_id = $1`,
      [bankId]
    );
    return sortByCanonicalKey(res.rows.map(rowToFeatureRecord));
  }

  /**
   * Lit les features d'une AGENCE d'un tenant (triées par clé canonique). Chemin de
   * lecture du forecast (`GET /ai/forecast`) : borne à `bank_id` (RLS) + `agency_id`.
   *
   * @param bankId   - Tenant (issu du JWT, jamais du client)
   * @param agencyId - Agence ciblée (scope vérifié en amont)
   * @returns Features de l'agence, triées
   */
  async getByAgency(bankId: string, agencyId: string): Promise<FeatureRecord[]> {
    const res = await this.query(
      `SELECT ${SELECT_COLUMNS} FROM ai_features WHERE bank_id = $1 AND agency_id = $2`,
      [bankId, agencyId]
    );
    return sortByCanonicalKey(res.rows.map(rowToFeatureRecord));
  }

  /**
   * Nombre de features matérialisées pour un tenant.
   *
   * @param bankId - Tenant (issu du JWT, jamais du client)
   * @returns Compte
   */
  async count(bankId: string): Promise<number> {
    const res = await this.query(
      `SELECT COUNT(*)::int AS total FROM ai_features WHERE bank_id = $1`,
      [bankId]
    );
    return toInt((res.rows[0] as { total: number } | undefined)?.total ?? 0);
  }
}
