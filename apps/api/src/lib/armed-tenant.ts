/**
 * `withArmedTenant` — défense-en-profondeur RLS armée (SEC-002, ferme SEC-F3-02).
 *
 * Exécute le corps d'une requête tenant dans UNE transaction PostgreSQL dont le
 * contexte RLS est ARMÉ : `SET LOCAL app.current_bank_id = '<bankId>'`. Sur une
 * connexion `sigfa_app` NOBYPASSRLS, les policies `tenant_isolation` (DB-002)
 * deviennent alors réellement contraignantes — l'isolation ne repose plus sur le
 * seul `WHERE bank_id` applicatif (dette SEC-F3-02).
 *
 *   BEGIN
 *     SET LOCAL app.current_bank_id = '<bankId>'   ← armement AVANT toute requête
 *     → corps (mutations + lectures + éventuel `withAudit` composé)
 *   COMMIT
 *
 * COMPOSITION AVEC SEC-001 (`withAudit`) : le corps reçoit une connexion DÉJÀ en
 * transaction armée. Quand une route appelle `withAudit` avec `inTransaction:true`
 * (via `auditContextFrom`, qui lit `tenantTxOpen`), l'audit se délimite par
 * SAVEPOINT dans CETTE transaction — l'insert `audit_log` hérite du même contexte
 * `app.current_bank_id`, et la mutation + l'audit committent atomiquement une seule
 * fois. Aucun test SEC-001 n'est cassé : le chemin BEGIN/COMMIT historique reste
 * disponible quand aucune transaction n'est ouverte.
 *
 * `SET LOCAL` est scopé à la transaction : aucune fuite de contexte entre requêtes,
 * et compatible PgBouncer mode transaction (cf. _notes F9 §2).
 *
 * @module
 */

import type { Client, Pool, PoolClient } from "pg";

/** Connexion PG minimale : un `query(sql, values?)` suffit à armer + exécuter. */
export interface ArmableConnection {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * Valide qu'un identifiant de banque est un UUID canonique.
 * Défense anti-injection : `bank_id` est interpolé dans un `SET LOCAL` (les
 * paramètres liés `$1` ne sont pas acceptés par `SET`). On refuse donc tout ce
 * qui n'est pas un UUID strict AVANT interpolation — jamais de `bank_id` attaquant.
 *
 * @param bankId - Identifiant candidat
 * @returns true si `bankId` est un UUID v1–v8 canonique
 */
export function isCanonicalUuid(bankId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    bankId
  );
}

/** Erreur : tentative d'armement avec un `bank_id` non-UUID (jamais interpolé). */
export class InvalidBankIdError extends Error {
  constructor(bankId: string) {
    super(`bank_id invalide pour l'armement RLS : ${JSON.stringify(bankId)}`);
    this.name = "InvalidBankIdError";
  }
}

/**
 * Ouvre une transaction, arme `app.current_bank_id`, exécute `fn`, puis COMMIT.
 * En cas d'erreur : ROLLBACK et propagation. Le `bankId` DOIT être un UUID
 * canonique (validé) — sinon `InvalidBankIdError` avant toute requête.
 *
 * @param conn   - Connexion `sigfa_app` (Client ou PoolClient dédié à la requête)
 * @param bankId - Banque du tenant courant (UUID canonique)
 * @param fn     - Corps recevant la connexion armée (en transaction)
 * @returns Résultat de `fn`
 * @throws {InvalidBankIdError} Si `bankId` n'est pas un UUID canonique
 */
export async function withArmedTenant<C extends ArmableConnection, T>(
  conn: C,
  bankId: string,
  fn: (conn: C) => Promise<T>
): Promise<T> {
  if (!isCanonicalUuid(bankId)) {
    throw new InvalidBankIdError(bankId);
  }
  await conn.query("BEGIN");
  try {
    // SET n'accepte pas de paramètre lié : on interpole un UUID DÉJÀ validé.
    await conn.query(`SET LOCAL app.current_bank_id = '${bankId}'`);
    const result = await fn(conn);
    await conn.query("COMMIT");
    return result;
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {
      // Connexion déjà avortée/fermée : rien de plus à faire.
    });
    throw err;
  }
}

/**
 * Variante « pool » : réserve une connexion dédiée du pool, l'arme via
 * `withArmedTenant`, puis la relâche systématiquement. Chaque requête HTTP tenant
 * obtient ainsi SA connexion (jamais un `SET LOCAL` partagé entre requêtes
 * concurrentes sur un `Client` unique — bug de concurrence évité).
 *
 * @param pool   - Pool `sigfa_app`
 * @param bankId - Banque du tenant courant (UUID canonique)
 * @param fn     - Corps recevant la connexion armée réservée
 * @returns Résultat de `fn`
 */
export async function withArmedTenantFromPool<T>(
  pool: Pool,
  bankId: string,
  fn: (conn: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    return await withArmedTenant(client as unknown as ArmableConnection, bankId, (armed) =>
      fn(armed as unknown as PoolClient)
    );
  } finally {
    client.release();
  }
}

/**
 * Adaptateur de type : un `pg.Client` satisfait `ArmableConnection`. Utilitaire
 * pour composer avec le contexte Hono (`c.get("db")` est un `Client`).
 *
 * @param client - Client PG
 * @returns Le même client, typé comme `ArmableConnection`
 */
export function asArmable(client: Client): ArmableConnection {
  return client as unknown as ArmableConnection;
}
