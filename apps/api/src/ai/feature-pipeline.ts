/**
 * IA-001 — Orchestrateur du pipeline de features d'affluence.
 *
 * Assemble les briques PURES et l'extraction I/O en un run idempotent :
 *  1. charge le référentiel de jours fériés CI (`public_holidays`, hors-tenant) ;
 *  2. ouvre un contexte tenant (`withTenantParam`, garde D5 — worker hors RLS) et
 *     extrait les observations horaires du tenant (`feature-extraction.ts`) ;
 *  3. calcule le feature-set déterministe (`feature-engine.ts`) ;
 *  4. matérialise dans le `FeatureStore` (upsert idempotent, isolation `bankId`).
 *
 * ## Isolation tenant STRICTE (D5)
 * Un run `bankId=A` n'ouvre le contexte que pour A (`SET LOCAL app.current_bank_id`),
 * ne lit et n'écrit que des features `bankId=A`. Le `bankId` porté par chaque
 * record est la source de vérité. L'extraction filtre `bank_id = $1` en plus.
 *
 * ## Idempotence de bout en bout
 * Rejouer `runFeaturePipeline` sur la même fenêtre produit exactement les mêmes
 * lignes matérialisées (upsert par clé canonique). Une correction rétroactive
 * (ré-agrégation REP-001) reconverge au re-run.
 *
 * ## DB-009
 * L'extraction utilise des requêtes paramétrées (`$1..$n`). Le `SET LOCAL` du
 * contexte tenant est la SEULE écriture d'un identifiant (UUID validé) en littéral,
 * inhérente à PostgreSQL (SET n'accepte pas de placeholder) — comme `withTenant`.
 *
 * @module
 */

import type { QueryFn as ReportQueryFn } from "src/reporting/aggregate-service.js";
import {
  computeFeatureSet,
  type BucketMinutes,
  type FeatureRecord,
} from "src/ai/feature-engine.js";
import { extractBucketObservations } from "src/ai/feature-extraction.js";
import type { FeatureStore } from "src/ai/feature-store.js";
import type { PayDayConfig } from "src/ai/ci-calendar.js";

/** Regex UUID (garde-fou du `SET LOCAL` tenant — refuse toute valeur non-UUID). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Dépendances injectées du pipeline (I/O + horloge). */
export interface FeaturePipelineDeps {
  /**
   * Requête paramétrée de la connexion applicative (`sigfa_app`) — sert à ouvrir
   * le contexte tenant et à extraire. Compatible `DualConnectionHarness.appQuery`.
   */
  readonly appQuery: ReportQueryFn;
  /**
   * Requête pour charger le référentiel `public_holidays` (hors-tenant, lecture
   * seule). Peut être la même connexion que `appQuery` (GRANT SELECT public).
   */
  readonly holidaysQuery: ReportQueryFn;
  /** Store de matérialisation des features. */
  readonly store: FeatureStore;
  /** Horloge injectée — détermine `isPartial` (jour figé J+2 07:00 Abidjan). */
  readonly now: Date;
}

/** Paramètres d'un run de pipeline (fenêtre bornée + tenant). */
export interface FeaturePipelineRun {
  /** Tenant (banque) — isolation stricte. */
  readonly bankId: string;
  /** Jour civil Abidjan de début (YYYY-MM-DD, inclus). */
  readonly dayStart: string;
  /** Jour civil Abidjan de fin (YYYY-MM-DD, inclus). */
  readonly dayEnd: string;
  /** Largeur de bucket (30 ou 60). Défaut 60. */
  readonly bucketMinutes?: BucketMinutes;
  /** Agrège par service si `true` (défaut : tous services confondus). */
  readonly byService?: boolean;
  /** Config paie fonction publique (défaut : jour 25 → fin de mois). */
  readonly payDayConfig?: PayDayConfig;
}

/** Résultat d'un run : features calculées + compteurs de matérialisation. */
export interface FeaturePipelineResult {
  /** Feature-set calculé (trié par clé canonique). */
  readonly features: FeatureRecord[];
  /** Nb de features produites par ce run. */
  readonly produced: number;
  /** Nb total de features matérialisées pour ce tenant après upsert. */
  readonly materialized: number;
}

/**
 * Exécute `fn` sous `BEGIN; SET LOCAL app.current_bank_id = <bankId>; … COMMIT`,
 * avec une `ReportQueryFn` PARAMÉTRÉE (garde D5, variante paramétrée de `withTenant`).
 *
 * @param query  - Requête paramétrée (connexion applicative)
 * @param bankId - UUID du tenant (validé — refuse toute injection)
 * @param fn     - Callback recevant la requête scopée au contexte tenant
 */
export async function withTenantParam<T>(
  query: ReportQueryFn,
  bankId: string,
  fn: (q: ReportQueryFn) => Promise<T>
): Promise<T> {
  if (!UUID_RE.test(bankId)) {
    throw new Error("feature-pipeline: bankId invalide (UUID attendu)");
  }
  await query("BEGIN");
  try {
    await query(`SET LOCAL app.current_bank_id = '${bankId}'`);
    const result = await fn(query);
    await query("COMMIT");
    return result;
  } catch (err) {
    await query("ROLLBACK").catch(() => {
      /* connexion possiblement fermée — ignorer l'échec de ROLLBACK */
    });
    throw err;
  }
}

/**
 * Charge le jeu de jours fériés CI (`public_holidays`, hors-tenant).
 *
 * @param query - Requête référentiel (lecture seule)
 * @returns Jeu de dates `YYYY-MM-DD`
 */
async function loadHolidaySet(query: ReportQueryFn): Promise<Set<string>> {
  const res = await query(`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM public_holidays`);
  const set = new Set<string>();
  for (const row of res.rows) set.add(String(row["d"]));
  return set;
}

/**
 * Exécute le pipeline de features pour un tenant sur une fenêtre bornée.
 *
 * @param deps - I/O + horloge injectés
 * @param run  - Tenant + fenêtre + options
 * @returns Feature-set + compteurs de matérialisation
 */
export async function runFeaturePipeline(
  deps: FeaturePipelineDeps,
  run: FeaturePipelineRun
): Promise<FeaturePipelineResult> {
  const holidays = await loadHolidaySet(deps.holidaysQuery);

  // Garde D5 : extraction STRICTEMENT sous le contexte tenant du run.
  const observations = await withTenantParam(deps.appQuery, run.bankId, async (q) =>
    extractBucketObservations(q, {
      bankId: run.bankId,
      dayStart: run.dayStart,
      dayEnd: run.dayEnd,
      ...(run.bucketMinutes !== undefined ? { bucketMinutes: run.bucketMinutes } : {}),
      ...(run.byService !== undefined ? { byService: run.byService } : {}),
    })
  );

  const features = computeFeatureSet(observations, {
    holidays,
    now: deps.now,
    ...(run.payDayConfig !== undefined ? { payDayConfig: run.payDayConfig } : {}),
  });

  const materialized = deps.store.upsertMany(features);

  return { features, produced: features.length, materialized };
}
