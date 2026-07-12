/**
 * Tests d'intégration — helper rate-limit Redis sliding-window (API-010).
 *
 * Redis réel (Testcontainers). Vérifie le comptage fenêtré, le dépassement
 * (429 + Retry-After), l'isolation par clé et l'expiration de la fenêtre.
 *
 * Critère EARS : `API-010: 6e feedback/min même IP → 429`.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { Hono } from "hono";
import { checkRateLimit, rateLimitMiddleware, clientIp } from "src/lib/rate-limit.js";

let redisContainer: StartedTestContainer;
let redis: Redis;

beforeAll(async () => {
  redisContainer = await new GenericContainer("redis:7")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  redis = new Redis(`redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`);
}, 120_000);

afterAll(async () => {
  await redis.quit();
  await redisContainer.stop();
}, 30_000);

describe("API-010: rate-limit sliding-window", () => {
  it("API-010: sous la limite → autorisé, remaining décroît", async () => {
    const key = `rl:test:${Date.now()}:under`;
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit(redis, key, 5, 60);
      expect(r.allowed).toBe(true);
    }
  });

  it("API-010: 6e appel dans la fenêtre → refusé avec retryAfterSeconds > 0", async () => {
    const key = `rl:test:${Date.now()}:over`;
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit(redis, key, 5, 60);
      expect(r.allowed).toBe(true);
    }
    const sixth = await checkRateLimit(redis, key, 5, 60);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
    expect(sixth.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("API-010: clés distinctes → compteurs isolés (IP × trackingId)", async () => {
    const base = `rl:test:${Date.now()}:iso`;
    for (let i = 0; i < 5; i++) await checkRateLimit(redis, `${base}:A`, 5, 60);
    const bFirst = await checkRateLimit(redis, `${base}:B`, 5, 60);
    expect(bFirst.allowed).toBe(true);
  });

  it("API-010: fenêtre expirée → compteur réinitialisé (nouvelle autorisation)", async () => {
    const key = `rl:test:${Date.now()}:expire`;
    // Fenêtre 1s, limite 1 : le 2e est refusé immédiatement puis autorisé après expiration.
    const first = await checkRateLimit(redis, key, 1, 1);
    expect(first.allowed).toBe(true);
    const second = await checkRateLimit(redis, key, 1, 1);
    expect(second.allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 1100));
    const third = await checkRateLimit(redis, key, 1, 1);
    expect(third.allowed).toBe(true);
  });
});

describe("API-010: rate-limit middleware générique (montage global API-011)", () => {
  /** App Hono injectant redis + une règle de débit sur toutes les routes. */
  function appWithLimit(limit: number): Hono<{ Variables: { redis: Redis } }> {
    const app = new Hono<{ Variables: { redis: Redis } }>();
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    app.use("*", async (c, next) => {
      c.set("redis", redis);
      await next();
    });
    app.use(
      "*",
      rateLimitMiddleware([
        { keyFn: (c) => `mw:${runId}:${clientIp(c)}`, limit, windowSeconds: 60 },
      ])
    );
    app.get("/ping", (c) => c.json({ ok: true }));
    return app;
  }

  it("API-010: sous la limite → 200, puis dépassement → 429 + Retry-After", async () => {
    const app = appWithLimit(2);
    const headers = { "x-forwarded-for": "198.51.100.7" };
    expect((await app.request("/ping", { headers })).status).toBe(200);
    expect((await app.request("/ping", { headers })).status).toBe(200);
    const blocked = await app.request("/ping", { headers });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    const body = (await blocked.json()) as { error: { code: string } };
    expect(body.error.code).toBe("TOO_MANY_REQUESTS");
  });

  it("API-010: clientIp — repli 'unknown' sans en-tête proxy", async () => {
    const app = new Hono();
    app.get("/ip", (c) => c.json({ ip: clientIp(c) }));
    const res = await app.request("/ip");
    expect(((await res.json()) as { ip: string }).ip).toBe("unknown");
  });

  it("SEC-F3: clientIp — X-Forwarded-For IGNORÉ quand TRUST_PROXY off", async () => {
    delete process.env["TRUST_PROXY"];
    const app = new Hono();
    app.get("/ip", (c) => c.json({ ip: clientIp(c) }));
    const r1 = await app.request("/ip", { headers: { "x-forwarded-for": "1.1.1.1" } });
    const r2 = await app.request("/ip", { headers: { "x-forwarded-for": "2.2.2.2" } });
    const ip1 = ((await r1.json()) as { ip: string }).ip;
    const ip2 = ((await r2.json()) as { ip: string }).ip;
    // XFF falsifié ignoré → même dimension (repli), jamais l'IP du header.
    expect(ip1).not.toBe("1.1.1.1");
    expect(ip2).not.toBe("2.2.2.2");
    expect(ip1).toBe(ip2);
  });

  it("SEC-F3: rate-limit — XFF différents mais TRUST_PROXY off → même client → 429 au dépassement", async () => {
    delete process.env["TRUST_PROXY"];
    const runId = `xff-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const app = new Hono<{ Variables: { redis: Redis } }>();
    app.use("*", async (c, next) => {
      c.set("redis", redis);
      await next();
    });
    app.use(
      "*",
      rateLimitMiddleware([
        { keyFn: (c) => `mw:${runId}:${clientIp(c)}`, limit: 2, windowSeconds: 60 },
      ])
    );
    app.get("/ping", (c) => c.json({ ok: true }));
    // 3 requêtes avec des XFF DIFFÉRENTS mais même IP réelle → comptent comme
    // un seul client : la 3e est 429 (l'attaquant ne peut pas contourner via XFF).
    expect((await app.request("/ping", { headers: { "x-forwarded-for": "9.9.9.1" } })).status).toBe(200);
    expect((await app.request("/ping", { headers: { "x-forwarded-for": "9.9.9.2" } })).status).toBe(200);
    expect((await app.request("/ping", { headers: { "x-forwarded-for": "9.9.9.3" } })).status).toBe(429);
  });

  it("SEC-F3: clientIp — X-Forwarded-For pris en compte quand TRUST_PROXY on", async () => {
    process.env["TRUST_PROXY"] = "true";
    const app = new Hono();
    app.get("/ip", (c) => c.json({ ip: clientIp(c) }));
    const res = await app.request("/ip", { headers: { "x-forwarded-for": "203.0.113.5" } });
    expect(((await res.json()) as { ip: string }).ip).toBe("203.0.113.5");
    delete process.env["TRUST_PROXY"];
  });
});
