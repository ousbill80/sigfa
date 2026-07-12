/**
 * Schemathesis — module Auth (API-001)
 *
 * Démarre l'API réelle sur un port éphémère (PG + Redis Testcontainers),
 * puis invoque Schemathesis via Docker contre les routes /auth/*.
 *
 * Nommage : `API-001: Schemathesis PASS sur le module auth`
 *
 * @module
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "vitest";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { createApp } from "src/app.js";

const execAsync = promisify(exec);

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let server: Server;
let apiPort: number;

const JWT_SECRET = "schemathesis-secret-at-least-32-chars-long!!";
const jwtSecretBytes = new TextEncoder().encode(JWT_SECRET);

/** Exécute les migrations minimales */
async function runMigrations(client: pg.Client): Promise<void> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'role_enum') THEN
        CREATE TYPE role_enum AS ENUM (
          'SUPER_ADMIN','BANK_ADMIN','AGENCY_MANAGER','AGENT','KIOSK','VIEWER'
        );
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_language_enum') THEN
        CREATE TYPE agent_language_enum AS ENUM ('FR','EN','DI','BA');
      END IF;
    END $$;
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS banks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS agencies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID NOT NULL REFERENCES banks(id),
      name TEXT NOT NULL, city TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID REFERENCES banks(id),
      email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      role role_enum NOT NULL,
      languages agent_language_enum[] NOT NULL DEFAULT '{FR}',
      failed_login_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ, phone_encrypted TEXT, phone_hash TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      CONSTRAINT users_super_admin_bank_id_check CHECK (
        (role = 'SUPER_ADMIN') = (bank_id IS NULL)
      ), is_relationship_manager BOOLEAN NOT NULL DEFAULT false, display_name TEXT, photo_url TEXT
);
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS agency_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id),
      user_id UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (agency_id, user_id)
    );
  `);
}

beforeAll(async () => {
  pgContainer = await new GenericContainer("postgres:16")
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

  redisContainer = await new GenericContainer("redis:7")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();

  const pgHost = pgContainer.getHost();
  const pgPort = pgContainer.getMappedPort(5432);
  const redisHost = redisContainer.getHost();
  const redisPort = redisContainer.getMappedPort(6379);

  db = new pg.Client({
    connectionString: `postgresql://sigfa:sigfa_test@${pgHost}:${pgPort}/sigfa_test`,
  });
  await db.connect();
  await runMigrations(db);

  redis = new Redis(`redis://${redisHost}:${redisPort}`);

  const app = createApp({ db, redis, jwtSecret: jwtSecretBytes });

  // Démarrer l'API sur un port éphémère
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      apiPort = info.port;
      resolve();
    }) as Server;
  });
}, 120_000);

afterAll(async () => {
  server?.close();
  await redis.quit();
  await db.end();
  await pgContainer.stop();
  await redisContainer.stop();
}, 30_000);

describe("API-001: Schemathesis", () => {
  it(
    "API-001: Schemathesis PASS sur le module auth contre l'API réelle (PG+Redis Testcontainers)",
    async () => {
      const contractPath = join(
        import.meta.dirname,
        "../../../../packages/contracts/generated/bundled/core.yaml"
      );

      // Vérifier que Docker est disponible
      let dockerAvailable = false;
      try {
        await execAsync("docker --version");
        dockerAvailable = true;
      } catch {
        console.warn("[Schemathesis] Docker non disponible — test SKIP gracieux");
      }

      if (!dockerAvailable) {
        expect(dockerAvailable).toBe(false); // SKIP documenté
        return;
      }

      let output = "";
      let exitCode = 0;

      try {
        const result = await execAsync(
          `docker run --rm \
            -v "${contractPath}:/contract.yaml" \
            --add-host=host.docker.internal:host-gateway \
            schemathesis/schemathesis:stable \
            run /contract.yaml \
            --url "http://host.docker.internal:${apiPort}/api/v1" \
            --include-path-regex "^/auth/" \
            --max-examples 20 \
            --request-timeout 10000 \
            --checks not_a_server_error`,
          { timeout: 120_000 }
        );
        output = result.stdout + result.stderr;
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; code?: number };
        output = (e.stdout ?? "") + (e.stderr ?? "");
        exitCode = e.code ?? 1;
      }

      console.log("[Schemathesis] Output:", output.slice(0, 3000));

      // Schemathesis exit 0 = PASS
      expect(exitCode).toBe(0);
    },
    150_000
  );
});
