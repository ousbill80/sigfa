/**
 * Utilitaire générique `assertTenantIsolated` — DB-002 T6
 *
 * Vérifie qu'une table RLS isole correctement les données entre deux tenants :
 *  - Contexte A → zéro ligne de B en SELECT (USING rejette les lignes B)
 *  - INSERT avec bank_id=B sous contexte A → rejeté (WITH CHECK)
 *  - La policy tenant_isolation existe bien sur la table
 *
 * Réutilisable par toute story future ajoutant une table métier.
 *
 * @module
 */
import { expect } from "vitest";
import type { DualConnectionHarness, QueryResult } from "./harness.js";

/**
 * Exécute une fonction dans un contexte tenant (transaction avec SET LOCAL).
 *
 * @param harness - Harness avec connexion applicative
 * @param bankId - UUID du tenant à activer
 * @param fn - Fonction à exécuter dans le contexte
 * @returns Résultat de la fonction
 */
async function inTenantCtx<T>(
  harness: DualConnectionHarness,
  bankId: string,
  fn: () => Promise<T>
): Promise<T> {
  await harness.appQuery("BEGIN");
  try {
    await harness.appQuery(`SET LOCAL app.current_bank_id = '${bankId}'`);
    const result = await fn();
    await harness.appQuery("COMMIT");
    return result;
  } catch (err) {
    await harness.appQuery("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

/**
 * Vérifie l'isolation tenant sur une table protégée par RLS.
 *
 * - Contexte A → SELECT ne retourne PAS les lignes de B
 * - INSERT avec bank_id=B sous contexte A → doit être rejeté (WITH CHECK)
 * - La policy `tenant_isolation` doit exister sur la table
 *
 * @param harness - Harness avec double connexion (migrateur + applicative)
 * @param tableName - Nom de la table SQL à tester
 * @param fixtureA - Objet fixture ligne appartenant au tenant A (doit avoir `bank_id`)
 * @param fixtureB - Objet fixture ligne appartenant au tenant B (doit avoir `bank_id`)
 * @param bankIdA - UUID du tenant A
 * @param bankIdB - UUID du tenant B
 */
export async function assertTenantIsolated(
  harness: DualConnectionHarness,
  tableName: string,
  fixtureA: Record<string, unknown> & { bank_id: string },
  fixtureB: Record<string, unknown> & { bank_id: string },
  bankIdA: string,
  bankIdB: string
): Promise<void> {
  // 1. Vérifier que la policy tenant_isolation existe sur la table
  const policyCheck = await harness.query(
    `SELECT policyname FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = '${tableName}'
       AND policyname = 'tenant_isolation'`
  );
  expect(
    policyCheck.rows,
    `[assertTenantIsolated] ${tableName}: policy tenant_isolation doit exister`
  ).toHaveLength(1);

  // 2. Contexte A → SELECT ne doit PAS retourner les lignes de B
  const selectResult: QueryResult = await inTenantCtx(harness, bankIdA, async () => {
    return harness.appQuery(`SELECT id, bank_id FROM ${tableName}`);
  });

  const visibleBRows = (selectResult.rows as Array<{ bank_id: string }>).filter(
    (r) => r.bank_id === bankIdB
  );
  expect(
    visibleBRows,
    `[assertTenantIsolated] ${tableName}: contexte A ne doit pas voir les lignes de B`
  ).toHaveLength(0);

  // Les lignes de A doivent être visibles
  const visibleARows = (selectResult.rows as Array<{ bank_id: string }>).filter(
    (r) => r.bank_id === bankIdA
  );
  expect(
    visibleARows.length,
    `[assertTenantIsolated] ${tableName}: contexte A doit voir ses propres lignes`
  ).toBeGreaterThan(0);

  // 3. INSERT avec bank_id=B sous contexte A → rejet WITH CHECK
  // On teste seulement si la table a une colonne bank_id injectable et name
  // (on utilise agencies comme archétype)
  const insertRejected = inTenantCtx(harness, bankIdA, async () => {
    return harness.appQuery(
      `INSERT INTO ${tableName} (bank_id, name) VALUES ('${bankIdB}', 'injection-rls-test') RETURNING id`
    );
  });
  await expect(insertRejected).rejects.toThrow();
}
