import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startPostgresContainer,
  startRedisContainer,
  type PostgresHarness,
  type RedisHarness,
} from "./harness.js";

describe("INFRA-005: harness tenant-isolation", () => {
  let pgHarness: PostgresHarness;
  let redisHarness: RedisHarness;

  beforeAll(async () => {
    pgHarness = await startPostgresContainer();
    redisHarness = await startRedisContainer();
  }, 120_000);

  afterAll(async () => {
    await pgHarness?.stop();
    await redisHarness?.stop();
  }, 30_000);

  it(
    "INFRA-005: harness Testcontainers — PostgreSQL 16 répond à SELECT 1",
    async () => {
      const result = await pgHarness.query("SELECT 1 AS value");
      expect(result.rows[0]).toEqual({ value: 1 });
    },
    30_000
  );

  it(
    "INFRA-005: harness Testcontainers — Redis 7 répond PONG",
    async () => {
      const pong = await redisHarness.ping();
      expect(pong).toBe("PONG");
    },
    30_000
  );
});
