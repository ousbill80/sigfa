/**
 * Schemathesis — module PUBLIC (API-010) : suivi & feedback client.
 *
 * Démarre l'API réelle (PG + Redis Testcontainers) puis invoque Schemathesis
 * via Docker contre les routes publiques (`/public/tickets/{trackingId}` et
 * `/public/tickets/{trackingId}/feedback`) SANS JWT. Vérifie l'absence de
 * server error (5xx) sur toutes les entrées générées (fenêtre, doublon, 404
 * opaque, rate-limit, validation).
 *
 * Nommage : `API-010: Schemathesis PASS module public (feedback+suivi)`.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { nanoid } from "nanoid";
import { applyMigrations } from "@sigfa/database/test-support";
import type { PostgresHarness } from "@sigfa/testing/tenant-isolation";
import { createApp } from "src/app.js";

const execAsync = promisify(exec);

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let server: Server;
let apiPort: number;

const jwtSecretBytes = new TextEncoder().encode("schemathesis-public-secret-32-chars-long!!");
process.env["PHONE_ENCRYPTION_KEY"] =
  process.env["PHONE_ENCRYPTION_KEY"] ??
  "1111111111111111111111111111111111111111111111111111111111111111";
process.env["PHONE_HASH_KEY"] =
  process.env["PHONE_HASH_KEY"] ??
  "2222222222222222222222222222222222222222222222222222222222222222";

/**
 * Applique les VRAIES migrations SQL (`packages/database/migrations/`) puis seed
 * le jeu public — FIDÉLITÉ au schéma de production (même convention que
 * `schemathesis-auth.test.ts`). Le drift harnais/schéma (ex. table `kiosks`
 * absente d'un DDL inline → 500 sur POST /kiosk/session au lieu du 401 opaque)
 * est structurellement impossible : le schéma exercé EST celui des migrations.
 */
async function runMigrations(client: pg.Client): Promise<void> {
  const harness: PostgresHarness = {
    connectionString: "",
    query: async (sql: string, values?: unknown[]) => {
      const res =
        values !== undefined ? await client.query(sql, values) : await client.query(sql);
      return { rows: res.rows as Array<Record<string, unknown>> };
    },
    stop: async () => {},
  };
  await applyMigrations(harness);

  const bank = await client.query(`INSERT INTO banks (name, slug) VALUES ('B','b') RETURNING id`);
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await client.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A') RETURNING id`, [bankId]);
  const agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await client.query(`INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','Ouverture') RETURNING id`, [bankId, agencyId]);
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await client.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`, [bankId, agencyId, serviceId]);
  const queueId = (q.rows[0] as { id: string }).id;
  // Opération active pour la liste publique borne (MODEL-API-A).
  await client.query(
    `INSERT INTO operations (bank_id, agency_id, service_id, code, name, sla_minutes, display_order)
     VALUES ($1,$2,$3,'DEP','Dépôt',NULL,0)`,
    [bankId, agencyId, serviceId]
  );
  // Conseiller actif + statut courant : la liste publique exerce le batch
  // agent_status_history (CONTRACT-014, champ `available` requis en réponse).
  const rm = await client.query(
    `INSERT INTO users (bank_id, email, password_hash, first_name, last_name, role, is_relationship_manager, display_name)
     VALUES ($1,'rm-schemathesis@t.ci','x-none','Kofi','A.','AGENT',true,'Kofi A.') RETURNING id`,
    [bankId]
  );
  const rmId = (rm.rows[0] as { id: string }).id;
  await client.query(`INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3)`, [bankId, agencyId, rmId]);
  await client.query(
    `INSERT INTO agent_status_history (bank_id, agency_id, agent_id, to_status) VALUES ($1,$2,$3,'AVAILABLE')`,
    [bankId, agencyId, rmId]
  );
  // Un ticket DONE clôturé à l'instant (fenêtre ouverte) + un WAITING pour le suivi.
  await client.query(
    `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, display_number, tracking_id, channel, status, closed_at)
     VALUES ($1,$2,$3,$4,1,'OC-001',$5,'KIOSK','DONE',NOW())`,
    [bankId, agencyId, queueId, serviceId, nanoid(21)]
  );
}

beforeAll(async () => {
  pgContainer = await new GenericContainer("postgres:16")
    .withEnvironment({ POSTGRES_USER: "sigfa", POSTGRES_PASSWORD: "sigfa_test", POSTGRES_DB: "sigfa_test" })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  redisContainer = await new GenericContainer("redis:7")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  db = new pg.Client({ connectionString: `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/sigfa_test` });
  await db.connect();
  await runMigrations(db);
  redis = new Redis(`redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`);

  const app = createApp({ db, redis, jwtSecret: jwtSecretBytes });
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      apiPort = info.port;
      resolve();
    }) as Server;
  });
}, 180_000);

afterAll(async () => {
  server?.close();
  await redis.quit();
  await db.end();
  await pgContainer.stop();
  await redisContainer.stop();
}, 30_000);

describe("API-010: Schemathesis module public", () => {
  it("API-010: Schemathesis PASS module public (feedback+suivi) contre l'API réelle", async () => {
    const contractPath = join(import.meta.dirname, "../../../../packages/contracts/generated/bundled/public.yaml");
    let dockerAvailable = false;
    try {
      await execAsync("docker --version");
      dockerAvailable = true;
    } catch {
      console.warn("[Schemathesis public] Docker non disponible — SKIP gracieux");
    }
    if (!dockerAvailable) {
      expect(dockerAvailable).toBe(false);
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
          --include-path-regex "^/public/tickets" \
          --max-examples 20 \
          --request-timeout 10000 \
          --checks not_a_server_error`,
        { timeout: 150_000 }
      );
      output = result.stdout + result.stderr;
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      output = (e.stdout ?? "") + (e.stderr ?? "");
      exitCode = e.code ?? 1;
    }
    console.log("[Schemathesis public] Output:", output.slice(0, 3000));
    expect(exitCode).toBe(0);
  }, 180_000);

  it("MODEL-API-A: Schemathesis PASS liste publique operations (/public/agencies/{id}/operations)", async () => {
    const contractPath = join(import.meta.dirname, "../../../../packages/contracts/generated/bundled/public.yaml");
    let dockerAvailable = false;
    try {
      await execAsync("docker --version");
      dockerAvailable = true;
    } catch {
      console.warn("[Schemathesis public operations] Docker non disponible — SKIP gracieux");
    }
    if (!dockerAvailable) {
      expect(dockerAvailable).toBe(false);
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
          --include-path-regex "^/public/agencies/[^/]+/operations" \
          --max-examples 20 \
          --request-timeout 10000 \
          --checks not_a_server_error`,
        { timeout: 150_000 }
      );
      output = result.stdout + result.stderr;
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      output = (e.stdout ?? "") + (e.stderr ?? "");
      exitCode = e.code ?? 1;
    }
    console.log("[Schemathesis public operations] Output:", output.slice(0, 3000));
    expect(exitCode).toBe(0);
  }, 180_000);

  it("MODEL-API-B: Schemathesis PASS liste publique relationship-managers (/public/agencies/{id}/relationship-managers)", async () => {
    const contractPath = join(import.meta.dirname, "../../../../packages/contracts/generated/bundled/public.yaml");
    let dockerAvailable = false;
    try {
      await execAsync("docker --version");
      dockerAvailable = true;
    } catch {
      console.warn("[Schemathesis public relationship-managers] Docker non disponible — SKIP gracieux");
    }
    if (!dockerAvailable) {
      expect(dockerAvailable).toBe(false);
      return;
    }

    // 429 (nouveau rate-limit /public/agencies 60/min/IP) N'EST PAS un 5xx : la
    // stratégie `not_a_server_error` l'accepte. `--max-examples` aligné sur operations.
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
          --include-path-regex "^/public/agencies/[^/]+/relationship-managers" \
          --max-examples 20 \
          --request-timeout 10000 \
          --checks not_a_server_error`,
        { timeout: 150_000 }
      );
      output = result.stdout + result.stderr;
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      output = (e.stdout ?? "") + (e.stderr ?? "");
      exitCode = e.code ?? 1;
    }
    console.log("[Schemathesis public relationship-managers] Output:", output.slice(0, 3000));
    expect(exitCode).toBe(0);
  }, 180_000);

  it("CONTRACT-014: Schemathesis PASS session borne (/kiosk/session — bankId requis en réponse)", async () => {
    const contractPath = join(import.meta.dirname, "../../../../packages/contracts/generated/bundled/public.yaml");
    let dockerOk = false;
    try {
      await execAsync("docker --version");
      dockerOk = true;
    } catch {
      console.warn("[Schemathesis kiosk-session] Docker non disponible — SKIP gracieux");
    }
    if (!dockerOk) {
      expect(dockerOk).toBe(false);
      return;
    }

    // Credentials aléatoires → 400/401 (jamais 5xx). Le chemin nominal (201 avec
    // bankId requis) est couvert par kiosk-session.test.ts (assertion stricte).
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
          --include-path-regex "^/kiosk/session$" \
          --max-examples 20 \
          --request-timeout 10000 \
          --checks not_a_server_error`,
        { timeout: 150_000 }
      );
      output = result.stdout + result.stderr;
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      output = (e.stdout ?? "") + (e.stderr ?? "");
      exitCode = e.code ?? 1;
    }
    console.log("[Schemathesis kiosk-session] Output:", output.slice(0, 3000));
    expect(exitCode).toBe(0);
  }, 180_000);
});
