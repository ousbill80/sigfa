/**
 * Harnais de schéma partagé — MODEL-API-B (support de test, hors couverture).
 *
 * Applique les VRAIES migrations SQL (`@sigfa/database/test-support`
 * `applyMigrations`) — schéma FIDÈLE à la production : types enum réels
 * (`role`, `agent_language`, `ticket_status`, …), contraintes, colonnes générées,
 * triggers et policies RLS `tenant_isolation` (ENABLE/FORCE). Les colonnes
 * conseiller de MODEL-DB-B (`users.is_relationship_manager/display_name/photo_url`,
 * `tickets.target_manager_id`, migration 0010) et les colonnes reporting/queues
 * (0016) sont donc réelles — aucune DDL inline dérivée du schéma (LA LOI T5).
 *
 * Historique : le harnais inlinait un sous-schéma dérivé (`users.languages`
 * hors enum, `queues.open_at/close_at` fictives) — source de faux-verts. En
 * basculant sur `applyMigrations`, le call-next et l'émission de ticket
 * s'exécutent contre les vrais types.
 *
 * Le client `db` du harnais est l'owner `sigfa` (superuser du conteneur) : il
 * contourne la RLS FORCE comme la connexion applicative superuser en test. Les
 * policies restent VÉRIFIABLES (pg_policies) — défense-en-profondeur SEC-002.
 *
 * Exclu de la couverture (jamais du code produit).
 *
 * @module
 */

import type pg from "pg";
import { applyMigrations } from "@sigfa/database/test-support";
import type { PostgresHarness } from "@sigfa/testing/tenant-isolation";

/** Secret JWT partagé des tests MODEL-API-B. */
export const ADMIN_JWT_SECRET = "model-api-b-jwt-secret-at-least-32-chars!!";

/**
 * Applique les VRAIES migrations SQL de `packages/database/migrations/` sur la
 * base de test — FIDÉLITÉ AU SCHÉMA DE PRODUCTION (aucune DDL inline dérivée).
 *
 * @param db - Client PG owner du conteneur de test
 */
export async function applyAdminSchemaForTest(db: pg.Client): Promise<void> {
  const harness: PostgresHarness = {
    connectionString: "",
    query: async (sql: string, values?: unknown[]) => {
      const res =
        values !== undefined
          ? await db.query(sql, values)
          : await db.query(sql);
      return { rows: res.rows as Array<Record<string, unknown>> };
    },
    stop: async () => {},
  };
  await applyMigrations(harness);
}
