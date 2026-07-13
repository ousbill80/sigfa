/**
 * DB-007 — Rétention IA : purge des données IA >24 mois.
 *
 * `purgeAiHistory()` : purge des prédictions, scores et anomalies de plus de 24 mois.
 * Idempotente, horloge injectable (alignée sur la politique DB-008).
 *
 * ## Politique de rétention IA (24 mois)
 * - `ai_forecasts`               : purgées si `computed_at` < now - 24 mois
 * - `ai_quality_scores`          : purgées si `created_at` < now - 24 mois
 * - `ai_anomalies`               : purgées si `detected_at` < now - 24 mois
 *                                  (toutes statuts : open/acked/resolved)
 * - `ai_staffing_recommendations`: hors scope purge (cycle de vie court, nettoyage par cron applicatif)
 *
 * ## Connexion
 * Ces fonctions opèrent hors contexte RLS (système, multi-tenant).
 * Elles attendent la connexion migrateur (`sigfa_migrator`, BYPASSRLS) — même
 * pattern que `purgeExpiredPhones()` (DB-008 réutilisable).
 *
 * ## Décision d'audit
 * Les tables IA (ai_forecasts, ai_anomalies, ai_quality_scores, ai_staffing_recommendations)
 * sont EXCLUES de AUDITED_TABLES car :
 * - Ce sont des agrégats à volume élevé (recalcul quotidien ou à la demande)
 * - Les mutations sont idempotentes (upsert) — un trigger d'audit crée du bruit sans valeur
 * - La source de vérité reste `tickets` (auditée applicativement via insertAuditEntry)
 * Cette exclusion est documentée dans src/audit/index.ts (liste AUDITED_TABLES).
 *
 * @module
 */

/**
 * Type d'une fonction de requête SQL (compatible `DualConnectionHarness.query`).
 * Même interface que dans `src/crypto/purge.ts` (DB-008) — réutilisable par le
 * pattern migrator connection.
 */
export type QueryFn = (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;

/**
 * Options de purge IA.
 */
export interface PurgeAiOptions {
  /**
   * Horloge injectable (par défaut `new Date()`). Permet de tester la purge avec une
   * date contrôlée sans dépendre de l'heure système.
   */
  now?: Date;
}

/**
 * Résultat de `purgeAiHistory`.
 */
export interface PurgeAiHistoryResult {
  /** Nombre de prédictions `ai_forecasts` supprimées. */
  deletedForecasts: number;
  /** Nombre de scores `ai_quality_scores` supprimés. */
  deletedQualityScores: number;
  /** Nombre d'anomalies `ai_anomalies` supprimées (toutes statuts). */
  deletedAnomalies: number;
  /** Nombre de features `ai_features` supprimées. */
  deletedFeatures: number;
}

/**
 * Purge les données IA de plus de 24 mois.
 *
 * Supprime (DELETE) :
 * - `ai_forecasts`      : `computed_at` < now - 24 mois
 * - `ai_quality_scores` : `created_at`  < now - 24 mois
 * - `ai_anomalies`      : `detected_at` < now - 24 mois (toutes statuts)
 * - `ai_features`       : `computed_at` < now - 24 mois (DB-AI-FEATURES)
 *
 * Idempotente : un second appel ne supprime rien de plus.
 *
 * ## Remarque sur la rétention sélective
 * Contrairement à `purgeExpiredPhones()` (DB-008) qui anonymise (met à NULL) les tickets
 * pour conserver les agrégats, `purgeAiHistory()` supprime directement les lignes IA :
 * ces tables sont des caches de calcul, pas des sources de vérité métier.
 *
 * ## Connexion attendue
 * La fonction attend la connexion migrateur (`sigfa_migrator`, BYPASSRLS) — opère
 * hors contexte RLS sur tous les tenants. Même pattern que DB-008.
 *
 * @param query   - Fonction de requête (connexion migrateur, BYPASSRLS)
 * @param options - Options (horloge injectable)
 * @returns Compteurs de suppressions par table
 */
export async function purgeAiHistory(
  query: QueryFn,
  options: PurgeAiOptions = {}
): Promise<PurgeAiHistoryResult> {
  const now = options.now ?? new Date();
  const cutoff = `'${now.toISOString()}'::timestamptz - interval '24 months'`;

  // ── 1. ai_forecasts : computed_at < cutoff ──────────────────────────────────
  const forecastRes = await query(`
    WITH deleted AS (
      DELETE FROM ai_forecasts
      WHERE computed_at < ${cutoff}
      RETURNING id
    )
    SELECT count(*)::int AS n FROM deleted
  `);
  const deletedForecasts = Number(forecastRes.rows[0]?.n ?? 0);

  // ── 2. ai_quality_scores : created_at < cutoff ──────────────────────────────
  const scoresRes = await query(`
    WITH deleted AS (
      DELETE FROM ai_quality_scores
      WHERE created_at < ${cutoff}
      RETURNING id
    )
    SELECT count(*)::int AS n FROM deleted
  `);
  const deletedQualityScores = Number(scoresRes.rows[0]?.n ?? 0);

  // ── 3. ai_anomalies : detected_at < cutoff (toutes statuts) ─────────────────
  const anomaliesRes = await query(`
    WITH deleted AS (
      DELETE FROM ai_anomalies
      WHERE detected_at < ${cutoff}
      RETURNING id
    )
    SELECT count(*)::int AS n FROM deleted
  `);
  const deletedAnomalies = Number(anomaliesRes.rows[0]?.n ?? 0);

  // ── 4. ai_features : computed_at < cutoff (DB-AI-FEATURES) ───────────────────
  const featuresRes = await query(`
    WITH deleted AS (
      DELETE FROM ai_features
      WHERE computed_at < ${cutoff}
      RETURNING id
    )
    SELECT count(*)::int AS n FROM deleted
  `);
  const deletedFeatures = Number(featuresRes.rows[0]?.n ?? 0);

  return { deletedForecasts, deletedQualityScores, deletedAnomalies, deletedFeatures };
}
