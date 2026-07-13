/**
 * `withAudit` — wrapper transactionnel CENTRALISÉ d'audit des mutations (SEC-001a).
 *
 * Garantit l'ATOMICITÉ audit↔métier : la mutation et l'écriture `audit_log`
 * partagent UNE seule transaction PostgreSQL.
 *
 *   BEGIN
 *     → exécute le corps métier (callback) qui produit result + descripteur d'audit
 *     → recordAudit(...) dans la MÊME transaction
 *   COMMIT
 *
 * Toute erreur — y compris un échec d'écriture d'audit — déclenche un ROLLBACK :
 * l'audit est une PRÉ-CONDITION de commit, jamais un best-effort (EARS « anormal »
 * de SEC-001a). Si la mutation réussit mais l'audit échoue, RIEN n'est persisté.
 *
 * Ce wrapper est la SOURCE UNIQUE de branchement d'audit pour les mutations
 * applicatives non-DDL : les routes l'appellent au lieu de dupliquer un
 * `db.query("BEGIN")` + `recordAudit` + `COMMIT` route par route.
 *
 * @module
 */

import type { Client } from "pg";
import type { Context, Env } from "hono";
import type { TenantContext } from "src/middleware/tenant.js";
import { recordAudit, extractIp } from "src/lib/audit-context.js";

/**
 * Descripteur d'audit produit par le corps métier d'une mutation.
 * `action`/`entityType` doivent correspondre à l'entrée du `mutation-registry`.
 */
export interface AuditDescriptor {
  /** Action journalisée stable et lisible (ex. « POST /tickets/:id/close »). */
  action: string;
  /** Type d'entité affectée (ex. « ticket »). */
  entityType: string;
  /** Identifiant de l'entité affectée (nullable si non résolu). */
  entityId?: string | null;
  /** Diff `{ before, after }` — assaini automatiquement (téléphone/hash exclus). */
  diff?: Record<string, unknown> | null;
  /** Email de l'acteur (dénormalisé), si connu. */
  actorEmail?: string | null;
}

/** Résultat du corps métier : la valeur applicative + le descripteur d'audit. */
export interface AuditedOutcome<T> {
  /** Valeur métier renvoyée au handler (sérialisée en réponse). */
  result: T;
  /** Ce qui doit être journalisé pour cette mutation. */
  audit: AuditDescriptor;
}

/**
 * Contexte minimal requis par `withAudit` (sous-ensemble de `Context`).
 * Permet d'injecter un contexte de test sans monter tout Hono.
 */
export interface AuditRequestContext {
  /** Connexion PG applicative (scope tenant courant). */
  db: Client;
  /** Contexte tenant résolu (acteur, rôle, banque). */
  tenant: TenantContext;
  /** IP client réelle résolue (XFF durci F3), ou null. */
  ip: string | null;
  /**
   * SEC-002 — composition avec `withTenant` armé. Vrai quand la connexion `db`
   * est DÉJÀ dans une transaction ouverte par `withArmedTenant` (contexte RLS
   * `app.current_bank_id` positionné). Dans ce cas, `withAudit` ne rouvre PAS de
   * transaction : il pose un SAVEPOINT et rend la main à la transaction englobante
   * qui commit une seule fois (audit + mutation atomiques, RLS armée AVANT).
   * Absent/false → comportement historique SEC-001 (BEGIN/COMMIT propres).
   */
  inTransaction?: boolean;
}

/**
 * Extrait le contexte d'audit d'un `Context` Hono (db, tenant, IP réelle).
 * L'IP provient TOUJOURS du trust-proxy XFF durci (F3), jamais du payload.
 *
 * @param c - Contexte Hono de la requête
 * @returns Contexte d'audit (db + tenant + ip)
 */
export function auditContextFrom<E extends Env>(
  c: Context<E> & {
    get(key: "db"): Client;
    get(key: "tenant"): TenantContext;
    get(key: "tenantTxOpen"): boolean | undefined;
  }
): AuditRequestContext {
  return {
    db: c.get("db"),
    tenant: c.get("tenant"),
    ip: extractIp(c),
    // SEC-002 : `withArmedTenant` positionne `tenantTxOpen=true` quand il a déjà
    // ouvert la transaction + armé `app.current_bank_id`. `withAudit` compose
    // alors dans CETTE transaction (savepoint), sans BEGIN/COMMIT concurrent.
    inTransaction: c.get("tenantTxOpen") === true,
  };
}

/**
 * Exécute une mutation applicative ET son audit dans UNE seule transaction.
 *
 * Le `body` reçoit la connexion PG (déjà en transaction ouverte) et doit
 * renvoyer `{ result, audit }`. `withAudit` écrit l'entrée d'audit puis commit.
 * En cas d'erreur (métier OU audit), rollback et propagation de l'erreur.
 *
 * @param ctx  - Contexte d'audit (db, tenant, ip)
 * @param body - Corps métier ; renvoie la valeur + le descripteur d'audit
 * @returns La valeur métier (`result`) une fois committée avec son audit
 * @throws Toute erreur du corps métier ou de l'écriture d'audit (après ROLLBACK)
 */
export async function withAudit<T>(
  ctx: AuditRequestContext,
  body: (db: Client) => Promise<AuditedOutcome<T>>
): Promise<T> {
  const { db, tenant, ip, inTransaction } = ctx;

  // SEC-002 — chemin COMPOSÉ : une transaction est déjà ouverte et armée
  // (`withArmedTenant`). On délimite par SAVEPOINT au lieu de BEGIN/COMMIT :
  // le contexte RLS `app.current_bank_id` est déjà posé AVANT la mutation et
  // l'insert d'audit ; la transaction englobante commit une seule fois. Un échec
  // (métier OU audit) relâche le savepoint (rollback partiel) et propage —
  // l'englobant décide du ROLLBACK global. Atomicité audit↔métier préservée.
  if (inTransaction === true) {
    await db.query("SAVEPOINT sec001_audit");
    try {
      const { result, audit } = await body(db);
      await recordAudit({
        db,
        tenant,
        action: audit.action,
        entityType: audit.entityType,
        entityId: audit.entityId ?? null,
        ip,
        actorEmail: audit.actorEmail ?? null,
        diff: audit.diff ?? null,
      });
      await db.query("RELEASE SAVEPOINT sec001_audit");
      return result;
    } catch (err) {
      await db.query("ROLLBACK TO SAVEPOINT sec001_audit").catch(() => {
        // Connexion déjà avortée : l'englobant fera le ROLLBACK global.
      });
      throw err;
    }
  }

  // Chemin HISTORIQUE SEC-001 (aucune transaction englobante) : BEGIN/COMMIT.
  await db.query("BEGIN");
  try {
    const { result, audit } = await body(db);
    // Écriture d'audit DANS la même transaction : un échec ici fait échouer la
    // mutation (rollback ci-dessous), jamais de best-effort silencieux.
    await recordAudit({
      db,
      tenant,
      action: audit.action,
      entityType: audit.entityType,
      entityId: audit.entityId ?? null,
      ip,
      actorEmail: audit.actorEmail ?? null,
      diff: audit.diff ?? null,
    });
    await db.query("COMMIT");
    return result;
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}
