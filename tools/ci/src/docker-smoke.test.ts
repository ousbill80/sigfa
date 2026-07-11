/**
 * Test de fumée Docker — Testcontainers PostgreSQL 16 — INFRA-003
 *
 * Démarre un conteneur PostgreSQL 16 réel via Testcontainers,
 * exécute `SELECT 1` et vérifie le résultat.
 * Ce test n'utilise aucun fichier de packages/testing (périmètre INFRA-005).
 */

import { describe, it, expect, afterAll } from "vitest";
import tcPg from "@testcontainers/postgresql";
import pg from "pg";

const { PostgreSqlContainer } = tcPg;
type StartedPostgreSqlContainer = Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;

// Timeout généreux pour le pull/démarrage du conteneur Docker
const CONTAINER_TIMEOUT_MS = 120_000;

describe("docker-smoke", () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  it(
    "INFRA-003: Testcontainers PostgreSQL 16 répond à SELECT 1",
    async () => {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();

      client = new pg.Client({
        host: container.getHost(),
        port: container.getPort(),
        database: container.getDatabase(),
        user: container.getUsername(),
        password: container.getPassword(),
      });

      await client.connect();

      const result = await client.query<{ result: number }>("SELECT 1 AS result");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.result).toBe(1);
    },
    CONTAINER_TIMEOUT_MS
  );
});
