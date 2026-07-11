/**
 * Helper typé `withTenant` — DB-002
 *
 * Exécute une fonction dans une transaction PostgreSQL avec `SET LOCAL app.current_bank_id`.
 * La valeur est scopée à la transaction (SET LOCAL) — aucune fuite entre transactions.
 *
 * Usage :
 * ```ts
 * const rows = await withTenant(query, bankId, async (q) => {
 *   return q("SELECT * FROM agencies");
 * });
 * ```
 *
 * @module
 */

import type { QueryResult } from "@sigfa/testing/tenant-isolation";

/** Type d'une fonction de requête SQL (compatible DualConnectionHarness.appQuery) */
export type QueryFn = (sql: string) => Promise<QueryResult>;

/**
 * Exécute `fn` dans une transaction avec `SET LOCAL app.current_bank_id = bankId`.
 * Garantit que le contexte tenant ne fuit pas hors de la transaction.
 *
 * @param queryFn - Fonction de requête SQL (connexion applicative sigfa_app)
 * @param bankId  - UUID de la banque (tenant courant)
 * @param fn      - Callback recevant une fonction de requête scopée au contexte
 * @returns Résultat du callback
 * @throws Si la transaction échoue (ROLLBACK automatique)
 */
export async function withTenant<T>(
  queryFn: QueryFn,
  bankId: string,
  fn: (query: QueryFn) => Promise<T>
): Promise<T> {
  await queryFn("BEGIN");
  try {
    await queryFn(`SET LOCAL app.current_bank_id = '${bankId}'`);
    const result = await fn(queryFn);
    await queryFn("COMMIT");
    return result;
  } catch (err) {
    await queryFn("ROLLBACK").catch(() => {
      // Ignorer l'erreur de ROLLBACK si la connexion est déjà fermée
    });
    throw err;
  }
}
