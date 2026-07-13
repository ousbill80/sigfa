/**
 * Tests unitaires — NOTIF-001 : câblage `getQueueHealth()` sur `GET /health`
 * (extension non-breaking `checks.queues`, prête pour CONTRACT-013).
 *
 * Le comportement postgres/redis + budget <100ms est couvert par `api-011.test.ts`
 * (Testcontainers). Ici on isole l'ajout `checks.queues` avec des stubs légers
 * (pas de conteneur) : présence du bloc, et 503 si un job est bloqué en DLQ.
 *
 * Nommage strict : `NOTIF-001: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import {
  createHealthRouter,
  type QueueHealthProvider,
} from "src/routes/health.js";
import type { QueueHealth } from "src/services/notification-jobs.js";

/** Client PG stub : `SELECT 1` réussit. */
const okDb = { query: async () => ({ rows: [] }) } as unknown as Client;

/** Client Redis stub : `PING` répond PONG. */
const okRedis = { ping: async () => "PONG" } as unknown as Redis;

/**
 * Monte le routeur de santé sous une app qui injecte db/redis en `Variables`
 * (comme `app.ts` en production). Retourne la réponse de `GET /health`.
 */
async function callHealth(queueHealth?: QueueHealthProvider): Promise<Response> {
  const app = new Hono<{ Variables: { db: Client; redis: Redis } }>();
  app.use("*", async (c, next) => {
    c.set("db", okDb);
    c.set("redis", okRedis);
    await next();
  });
  app.route("/", createHealthRouter("1.0.0", queueHealth));
  return app.request("/health");
}

const healthyQueues: QueueHealth = {
  channels: [
    {
      name: "notifications-sms",
      counts: { waiting: 1, active: 0, failed: 0, completed: 4, delayed: 0 },
    },
  ],
  dlq: {
    name: "notifications-dlq",
    counts: { waiting: 0, active: 0, failed: 0, completed: 0, delayed: 0 },
  },
  healthy: true,
};

describe("NOTIF-001 /health checks.queues", () => {
  it("NOTIF-001: sans fournisseur → pas de checks.queues (non-breaking)", async () => {
    const res = await callHealth();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      checks: { postgres: string; redis: string; queues?: unknown };
    };
    expect(body.checks.postgres).toBe("up");
    expect(body.checks.queues).toBeUndefined();
  });

  it("NOTIF-001: avec fournisseur sain → 200 + checks.queues (canaux + DLQ)", async () => {
    const res = await callHealth(async () => healthyQueues);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      checks: { queues: QueueHealth };
    };
    expect(body.checks.queues.channels[0]?.name).toBe("notifications-sms");
    expect(body.checks.queues.dlq.name).toBe("notifications-dlq");
    expect(body.checks.queues.healthy).toBe(true);
  });

  it("NOTIF-001: job bloqué en DLQ (healthy:false) → 503 SERVICE_UNAVAILABLE", async () => {
    const degraded: QueueHealth = {
      ...healthyQueues,
      dlq: {
        name: "notifications-dlq",
        counts: { waiting: 2, active: 0, failed: 0, completed: 0, delayed: 0 },
      },
      healthy: false,
    };
    const res = await callHealth(async () => degraded);
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      error: { code: string; details?: { checks?: { queues?: QueueHealth } } };
    };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.error.details?.checks?.queues?.healthy).toBe(false);
  });

  it("NOTIF-001: sonde files en échec → dégradée (503), pas de crash", async () => {
    const res = await callHealth(async () => {
      throw new Error("redis down");
    });
    expect(res.status).toBe(503);
  });
});
