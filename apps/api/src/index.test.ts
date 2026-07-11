/**
 * Tests smoke pour l'app SIGFA API.
 * Adapté API-001 : remplace le placeholder http F0 par l'app Hono réelle.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import { Redis } from "ioredis";
import pg from "pg";

/**
 * Crée une app Hono de test avec des clients fictifs (pas de vraie DB/Redis).
 * Suffit pour vérifier que l'app bootstrap sans panic.
 */
function createTestApp(): ReturnType<typeof createApp> {
  // Utiliser des proxies null-safe pour les tests smoke
  const fakeDb = {} as pg.Client;
  const fakeRedis = {} as Redis;
  const jwtSecret = new TextEncoder().encode(
    "test-jwt-secret-at-least-32-chars-long!!"
  );
  return createApp({ db: fakeDb, redis: fakeRedis, jwtSecret });
}

describe("@sigfa/api smoke", () => {
  it("INFRA-001: app Hono créée sans erreur et répond 404 sur route inconnue", async () => {
    const app = createTestApp();
    const res = await app.fetch(
      new Request("http://localhost/unknown-route")
    );
    // 404 conforme LA LOI
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("INFRA-007: getJwtSecret lève une erreur si JWT_SECRET manquant", async () => {
    const { getJwtSecret } = await import("./lib/env.js");
    const orig = process.env["JWT_SECRET"];
    delete process.env["JWT_SECRET"];
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
    if (orig) process.env["JWT_SECRET"] = orig;
  });
});
