/**
 * Applicateur de migrations E2E (RT-003) — sous-processus ESM.
 *
 * Playwright charge `global-setup.ts`/`harness.ts` via son loader TS en CJS ;
 * `require()` d'un package ESM `type: module` qui utilise `import.meta`
 * (`@sigfa/database` → `test-support/migrate.js`) échoue (`Cannot use
 * 'import.meta' outside a module`). Ce script s'exécute donc en VRAI ESM (comme
 * `api-launcher.mjs`) et RÉUTILISE `applyMigrations` — l'applicateur partagé des
 * harnais d'intégration API/DB — sans le réimplémenter.
 *
 * Il applique les VRAIES migrations `packages/database/migrations/00NN_*.sql`
 * (dans l'ordre, séparateur drizzle `--> statement-breakpoint`) sur la base
 * cible désignée par `DATABASE_URL`. Le schéma résultant est STRICTEMENT le
 * schéma de production (tables `ai_anomalies`/`ai_forecasts`/`audit_log`,
 * colonnes, contraintes, enums, rôles RLS `sigfa_app`/`sigfa_migrator`,
 * policies FORCE RLS). Le SEED est ensuite exécuté par le harnais (owner).
 *
 * @module e2e/support/migrate-runner
 */
import pg from "pg";
import { applyMigrations } from "@sigfa/database/test-support";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("[migrate-runner] DATABASE_URL manquant.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

/**
 * Adapte le `pg.Client` à l'interface `PostgresHarness` attendue par
 * `applyMigrations` : seule `query()` est exercée par l'applicateur.
 */
const harness = {
  connectionString: dbUrl,
  query: async (sql, values) => {
    const res = values !== undefined ? await client.query(sql, values) : await client.query(sql);
    return { rows: res.rows };
  },
  stop: async () => {
    /* fermeture gérée ci-dessous */
  },
};

try {
  await applyMigrations(harness);
} finally {
  await client.end();
}
