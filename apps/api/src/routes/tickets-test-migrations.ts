/**
 * Harnais de migrations FIDÈLE au schéma de production, PARTAGÉ par le cluster
 * de suites tickets (`tickets.test.ts`, `tickets-sync.test.ts`,
 * `offline-resilience.test.ts`).
 *
 * Applique les VRAIES migrations SQL (`packages/database/migrations/`) sur le PG
 * de test — types enum réels (`ticket_channel`, `ticket_status`,
 * `ticket_priority`, `queue_status`, `agent_language`), colonnes NOT NULL,
 * contraintes CHECK, clés étrangères, triggers d'audit ET **RLS
 * ENABLE/FORCE + policies `tenant_isolation`** sur les tables tenant. Aucune DDL
 * inline dérivée : le schéma exécuté ici est celui déployé (LA LOI T5).
 *
 * `applyMigrations` attend un `PostgresHarness` : on adapte le `pg.Client` de
 * test. La connexion de test est le SUPERUSER du conteneur (`sigfa`), qui
 * contourne RLS — la fidélité porte donc sur les types/contraintes/triggers du
 * schéma réel. L'isolation tenant sous rôle NOBYPASSRLS est prouvée séparément
 * par les suites `config-cutover-*-tenant-isolation.integration.test.ts`.
 *
 * @module
 */

import type pg from "pg";
import { applyMigrations } from "@sigfa/database/test-support";
import type { PostgresHarness } from "@sigfa/testing/tenant-isolation";

/**
 * Applique toutes les migrations de production sur le client PG de test.
 * @param client - Client PostgreSQL Testcontainers (superuser conteneur)
 */
export async function applyRealMigrations(client: pg.Client): Promise<void> {
  const harness: PostgresHarness = {
    connectionString: "",
    query: async (sql: string, values?: unknown[]) => {
      const res =
        values !== undefined
          ? await client.query(sql, values)
          : await client.query(sql);
      return { rows: res.rows as Array<Record<string, unknown>> };
    },
    stop: async () => {},
  };
  await applyMigrations(harness);
}
