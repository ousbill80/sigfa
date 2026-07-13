/**
 * Fragment de schéma `audit_log` pour les harnais de test (SEC-001a) — support.
 *
 * Les mutations applicatives (tickets, files, sync, feedback, session borne)
 * écrivent DÉSORMAIS une entrée `audit_log` dans la même transaction que la
 * mutation (SEC-001a). Les harnais de test qui exercent ces routes doivent donc
 * disposer de la table `audit_log` (+ enum `role`), sinon l'insertion d'audit
 * échoue et fait — à raison — échouer la mutation (append-only, pas de best-effort).
 *
 * `ensureAuditLogSchema` est IDEMPOTENT : `IF NOT EXISTS` partout → sans effet si
 * le harnais crée déjà ces objets (ex. `admin-test-harness`). Exclu de la
 * couverture (support de test, jamais du code produit).
 *
 * @module
 */

import type { Client } from "pg";

/** Interface minimale d'un client SQL (compatible `pg.Client`). */
interface SqlClient {
  query(sql: string): Promise<unknown>;
}

/**
 * Crée (si absents) l'enum `role`, la table `audit_log` et le trigger
 * d'immuabilité append-only. À appeler dans le `beforeAll` d'un harnais qui
 * exerce une route mutante auditée mais ne définit pas déjà `audit_log`.
 *
 * @param db - Client PG du harnais de test
 */
export async function ensureAuditLogSchema(db: Client | SqlClient): Promise<void> {
  await db.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='role') THEN
        CREATE TYPE role AS ENUM ('SUPER_ADMIN','BANK_ADMIN','AGENCY_DIRECTOR','MANAGER','AGENT','AUDITOR');
      END IF;
    END $$;
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID NOT NULL,
      actor_id UUID,
      actor_role role,
      actor_email TEXT,
      action VARCHAR(500) NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id UUID,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip INET,
      diff JSONB
    );
  `);
}
