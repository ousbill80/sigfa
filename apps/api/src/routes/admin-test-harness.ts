/**
 * Harnais de test partagé des routeurs admin (API-008) — NON couvert (support de test).
 *
 * Démarre PostgreSQL 16 + Redis 7 (Testcontainers réels), applique les VRAIES
 * migrations SQL (`@sigfa/database/test-support` `applyMigrations`) — schéma
 * FIDÈLE à la production (types enum, contraintes, triggers, RLS ENABLE/FORCE) —
 * et fournit un forgeur de JWT. Utilisé par tous les tests d'intégration API-008.
 *
 * Exclu de la couverture (support de test, jamais du code produit).
 *
 * @module
 */

import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { SignJWT } from "jose";
import { applyMigrations } from "@sigfa/database/test-support";
import type { PostgresHarness } from "@sigfa/testing/tenant-isolation";

/** Ressources démarrées du harnais. */
export interface AdminHarness {
  /** Conteneur PostgreSQL. */
  pgContainer: StartedTestContainer;
  /** Conteneur Redis. */
  redisContainer: StartedTestContainer;
  /** Client PG applicatif. */
  db: pg.Client;
  /** Client Redis. */
  redis: Redis;
  /** Secret JWT (bytes). */
  jwtSecretBytes: Uint8Array;
}

/** Secret JWT partagé des tests admin. */
export const ADMIN_JWT_SECRET = "admin-api008-jwt-secret-at-least-32-chars!!";

/**
 * Démarre les conteneurs et applique le schéma admin.
 *
 * @returns Ressources du harnais
 */
export async function startAdminHarness(): Promise<AdminHarness> {
  const pgContainer = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "sigfa",
      POSTGRES_PASSWORD: "sigfa_test",
      POSTGRES_DB: "sigfa_test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2)
    )
    .start();
  const redisContainer = await new GenericContainer("redis:7")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  const db = new pg.Client({
    connectionString: `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(
      5432
    )}/sigfa_test`,
  });
  await db.connect();
  await applyRealMigrations(db);
  const redis = new Redis(
    `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`
  );
  const jwtSecretBytes = new TextEncoder().encode(ADMIN_JWT_SECRET);
  return { pgContainer, redisContainer, db, redis, jwtSecretBytes };
}

/**
 * Arrête et nettoie les ressources du harnais.
 *
 * @param h - Harnais à arrêter
 */
export async function stopAdminHarness(h: AdminHarness): Promise<void> {
  await h.redis.quit();
  await h.db.end();
  await h.pgContainer.stop();
  await h.redisContainer.stop();
}

/**
 * Forge un JWT signé pour un rôle et un scope tenant donnés.
 *
 * @param secret    - Secret JWT (bytes)
 * @param role      - Rôle RBAC
 * @param sub       - Sujet (userId)
 * @param bankId    - Banque (null pour SUPER_ADMIN)
 * @param agencyIds - Agences accessibles
 * @returns JWT signé
 */
export async function forgeToken(
  secret: Uint8Array,
  role: string,
  sub: string,
  bankId: string | null,
  agencyIds: string[] = []
): Promise<string> {
  return new SignJWT({ role, bankId, agencyIds })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

/**
 * Applique les VRAIES migrations SQL de `packages/database/migrations/` sur la base
 * de test — FIDÉLITÉ AU SCHÉMA DE PRODUCTION (LA LOI T5, aucune DDL inline dérivée).
 *
 * Le harnais démarrait auparavant un sous-schéma admin inline, source de faux-verts
 * (ex. `users.languages TEXT[]` au lieu de `agent_language[]` — bug call-next masqué,
 * corrigé 7f019c6). En basculant sur `applyMigrations`, les tests s'exécutent contre
 * les types enum réels (`role`, `agent_language`, `ticket_status`, …), les
 * contraintes réelles, les colonnes générées et les policies RLS `tenant_isolation`
 * (ENABLE/FORCE) créées par les migrations 0001+. Les migrations exécutées incluent
 * `0016` (colonnes `daily_agency_stats.agent_available_seconds` + `queues.open_at`/
 * `close_at`) : reporting et queues sont donc pleinement couverts, sans skip.
 *
 * Le client `db` du harnais est l'owner `sigfa` (superuser du conteneur) : il
 * contourne la RLS FORCE comme le fait la connexion applicative superuser en test.
 * Les policies restent VÉRIFIABLES (pg_policies) — défense-en-profondeur SEC-002.
 *
 * @param db - Client PG owner du conteneur de test
 */
async function applyRealMigrations(db: pg.Client): Promise<void> {
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

/** Fixtures d'une banque + agence + directeur pour les tests. */
export interface BankFixture {
  /** Banque. */
  bankId: string;
  /** Agence. */
  agencyId: string;
  /** Directeur d'agence. */
  directorId: string;
}

/**
 * Crée une banque, une agence et un directeur (rôle AGENCY_DIRECTOR).
 *
 * @param db   - Client PG
 * @param slug - Slug unique de la banque
 * @returns Fixtures créées
 */
export async function seedBankAgency(
  db: pg.Client,
  slug: string
): Promise<BankFixture> {
  const bank = await db.query(
    `INSERT INTO banks (name, slug) VALUES ($1,$1) RETURNING id`,
    [slug]
  );
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await db.query(
    `INSERT INTO agencies (bank_id, name) VALUES ($1,'Agence') RETURNING id`,
    [bankId]
  );
  const agencyId = (agency.rows[0] as { id: string }).id;
  const dir = await db.query(
    // Schéma FIDÈLE : `users.password_hash`/`first_name`/`last_name` NOT NULL sans défaut.
    `INSERT INTO users (bank_id, email, password_hash, first_name, last_name, role)
       VALUES ($1,$2,'x','Dir','Test','AGENCY_DIRECTOR') RETURNING id`,
    [bankId, `dir-${slug}@t.ci`]
  );
  const directorId = (dir.rows[0] as { id: string }).id;
  await db.query(
    `INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3)`,
    [bankId, agencyId, directorId]
  );
  return { bankId, agencyId, directorId };
}
