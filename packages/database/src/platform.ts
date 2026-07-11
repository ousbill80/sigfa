/**
 * Helper `withPlatform` — API-002 (périmètre étendu)
 *
 * Exécute une fonction avec la connexion migrateur dédiée (sigfa_migrator).
 * Réservé aux routes `platform` (SUPER_ADMIN) : liste des banques, network-overview,
 * audit-logs cross-banques. JAMAIS utilisé pour des requêtes tenant-scopées.
 *
 * Contrainte : n'émet JAMAIS de `SET app.current_bank_id` (pas de contexte tenant).
 *
 * Usage :
 * ```ts
 * const banks = await withPlatform(migratorQuery, async (q) => {
 *   return q("SELECT * FROM banks");
 * });
 * ```
 *
 * @module
 */

import type { QueryFn } from "./tenant.js";

/**
 * Exécute `fn` avec la connexion fournie, sans contexte tenant.
 * Destiné exclusivement aux routes `platform` (SUPER_ADMIN, connexion migrateur).
 *
 * @param queryFn - Fonction de requête SQL (connexion migrateur sigfa_migrator)
 * @param fn      - Callback recevant la même fonction de requête
 * @returns Résultat du callback
 * @throws Si le callback lève une erreur
 */
export async function withPlatform<T>(
  queryFn: QueryFn,
  fn: (query: QueryFn) => Promise<T>
): Promise<T> {
  return fn(queryFn);
}
