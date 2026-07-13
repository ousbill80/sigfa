/**
 * Matrice tenant-isolation EXHAUSTIVE (SEC-002) — artefact central versionné.
 *
 * Modèle : `table × vecteur d'attaque`, l'axe TABLE étant énuméré DYNAMIQUEMENT
 * par introspection `information_schema` (toute table `public` portant une colonne
 * `bank_id`). Aucune liste manuelle qui se périme : une table `bank_id` ajoutée par
 * une vague future rejoint AUTOMATIQUEMENT la campagne (et la casse si RLS manque).
 *
 * Les 7 vecteurs d'attaque (chacun exécuté sur la connexion `sigfa_app` NOBYPASSRLS,
 * PG16 réelle) matérialisent la défense-en-profondeur RLS (DB-002) :
 *   1. CROSS_TENANT_READ      — ctx A ne lit AUCUNE ligne de B.
 *   2. CROSS_TENANT_WRITE     — ctx A n'UPDATE/DELETE AUCUNE ligne de B (0 effet).
 *   3. INJECTED_BANK_ID_BODY  — INSERT bank_id=B sous ctx A → rejet WITH CHECK.
 *   4. INJECTED_BANK_ID_PARAM — ressource de B ciblée par id sous ctx A → invisible (0 ligne).
 *   5. MISSING_CONTEXT        — aucun app.current_bank_id → 0 ligne / écriture rejetée.
 *   6. SQL_INJECTION          — payload d'injection sur champ filtrable → paramétrage, 0 fuite.
 *   7. PLATFORM_LEAK          — SUPER_ADMIN (bank_id NULL) : lignes plateforme invisibles au tenant.
 *
 * @module
 */

import type { PostgresHarness } from "@sigfa/testing/tenant-isolation";

/** Vecteurs d'attaque de la matrice (source de vérité de l'axe ATTAQUE). */
export const ATTACK_VECTORS = [
  "CROSS_TENANT_READ",
  "CROSS_TENANT_WRITE",
  "INJECTED_BANK_ID_BODY",
  "INJECTED_BANK_ID_PARAM",
  "MISSING_CONTEXT",
  "SQL_INJECTION",
  "PLATFORM_LEAK",
] as const;

/** Un vecteur d'attaque. */
export type AttackVector = (typeof ATTACK_VECTORS)[number];

/**
 * Tables portant `bank_id` mais VOLONTAIREMENT hors policy `tenant_isolation`
 * standard, avec justification. `users` a une policy dérivée (les lignes
 * SUPER_ADMIN `bank_id IS NULL` sont invisibles à tout tenant) — elle N'est PAS
 * exclue, elle est traitée par le vecteur PLATFORM_LEAK. Aucune table n'est exclue
 * ici : toute exclusion future DOIT être justifiée et testée.
 */
export const ISOLATION_EXCLUDED_TABLES: readonly string[] = [];

/**
 * Introspecte `information_schema` : toutes les tables `public` (BASE TABLE)
 * portant une colonne `bank_id`. C'est l'axe TABLE, dérivé du schéma DÉPLOYÉ —
 * jamais figé en dur (cf. QO-4 des notes F9).
 *
 * @param harness - Harness PG (connexion migrateur suffit : lecture catalogue)
 * @returns Noms de tables triés, portant `bank_id`
 */
export async function introspectBankIdTables(
  harness: PostgresHarness
): Promise<string[]> {
  const res = await harness.query(`
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'bank_id'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  `);
  return (res.rows as Array<{ table_name: string }>).map((r) => r.table_name);
}

/**
 * Introspecte les tables `public` ayant la policy `tenant_isolation` (catalogue
 * `pg_policies`). Sert à croiser avec l'axe TABLE : une table `bank_id` SANS policy
 * `tenant_isolation` (et hors exclusions justifiées) → trou d'isolation → échec.
 *
 * @param harness - Harness PG
 * @returns Noms de tables portant la policy `tenant_isolation`
 */
export async function introspectIsolatedTables(
  harness: PostgresHarness
): Promise<string[]> {
  const res = await harness.query(`
    SELECT tablename
    FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
    ORDER BY tablename
  `);
  return (res.rows as Array<{ tablename: string }>).map((r) => r.tablename);
}

/**
 * Introspecte les colonnes NOT NULL sans défaut d'une table (hors `bank_id`),
 * pour fabriquer un INSERT minimal valide lors des vecteurs d'écriture. Les
 * colonnes à défaut (`gen_random_uuid()`, `now()`, …) sont omises.
 *
 * @param harness   - Harness PG
 * @param tableName - Table cible
 * @returns Colonnes requises (nom + type) hors `bank_id`
 */
export async function introspectRequiredColumns(
  harness: PostgresHarness,
  tableName: string
): Promise<Array<{ column: string; dataType: string; udtName: string }>> {
  const res = await harness.query(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = '${tableName}'
      AND is_nullable = 'NO'
      AND column_default IS NULL
      AND column_name <> 'bank_id'
    ORDER BY ordinal_position
  `);
  return (res.rows as Array<{ column_name: string; data_type: string; udt_name: string }>).map(
    (r) => ({ column: r.column_name, dataType: r.data_type, udtName: r.udt_name })
  );
}

/** Une cellule de la matrice : une table soumise à un vecteur d'attaque. */
export interface MatrixCell {
  /** Table cible (axe TABLE). */
  table: string;
  /** Vecteur d'attaque (axe ATTAQUE). */
  vector: AttackVector;
}

/**
 * Développe la matrice `table × vecteur` pour un ensemble de tables donné.
 * Chaque cellule est un cas à exécuter par la campagne.
 *
 * @param tables - Tables (issues de `introspectBankIdTables`)
 * @returns Toutes les cellules `(table, vector)`
 */
export function buildMatrix(tables: readonly string[]): MatrixCell[] {
  const cells: MatrixCell[] = [];
  for (const table of tables) {
    for (const vector of ATTACK_VECTORS) {
      cells.push({ table, vector });
    }
  }
  return cells;
}
