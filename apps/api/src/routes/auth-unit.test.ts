/**
 * Tests unitaires des routes auth (sans Testcontainers) — couverture des chemins de validation.
 * Utilise des mocks minimalistes pour les dépendances Redis/PG.
 *
 * @module
 */

import { describe, it, expect, vi } from "vitest";
import type { Redis } from "ioredis";
import type { Client } from "pg";
import { createApp } from "src/app.js";

const JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";
const jwtSecretBytes = new TextEncoder().encode(JWT_SECRET);

/** Crée une app Hono avec de faux clients (tests de validation, pas d'I/O) */
function makeFakeApp(): ReturnType<typeof createApp> {
  const fakeDb = {} as Client;
  const fakeRedis = {} as Redis;
  return createApp({ db: fakeDb, redis: fakeRedis, jwtSecret: jwtSecretBytes });
}

async function post(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
  contentType = "application/json"
): Promise<{ status: number; data: unknown }> {
  const res = await app.fetch(
    new Request(`http://localhost/api/v1${path}`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, data: await res.json() };
}

describe("API-001: auth routes validation (unit)", () => {
  it("API-001: POST /auth/login avec corps invalide → 400 VALIDATION_ERROR", async () => {
    const app = makeFakeApp();
    const { status, data } = await post(app, "/auth/login", {
      email: "not-an-email",
      password: "short",
    });
    expect(status).toBe(400);
    expect((data as { error: { code: string } }).error.code).toBe(
      "VALIDATION_ERROR"
    );
  });

  it("API-001: POST /auth/login sans email → 400 VALIDATION_ERROR", async () => {
    const app = makeFakeApp();
    const { status, data } = await post(app, "/auth/login", {
      password: "ValidPassword123!",
    });
    expect(status).toBe(400);
    expect((data as { error: { code: string } }).error.code).toBe(
      "VALIDATION_ERROR"
    );
  });

  it("API-001: POST /auth/refresh sans refreshToken → 400 VALIDATION_ERROR", async () => {
    const app = makeFakeApp();
    const { status, data } = await post(app, "/auth/refresh", {});
    expect(status).toBe(400);
    expect((data as { error: { code: string } }).error.code).toBe(
      "VALIDATION_ERROR"
    );
  });

  it("API-001: POST /auth/logout sans refreshToken → 400 VALIDATION_ERROR", async () => {
    const app = makeFakeApp();
    const { status, data } = await post(app, "/auth/logout", {});
    expect(status).toBe(400);
    expect((data as { error: { code: string } }).error.code).toBe(
      "VALIDATION_ERROR"
    );
  });

  it("API-001: GET /auth/me sans header Authorization → 401 UNAUTHORIZED", async () => {
    const app = makeFakeApp();
    const res = await app.fetch(
      new Request("http://localhost/api/v1/auth/me")
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("API-001: GET /auth/me avec token invalide → 401 UNAUTHORIZED", async () => {
    const app = makeFakeApp();
    const res = await app.fetch(
      new Request("http://localhost/api/v1/auth/me", {
        headers: { Authorization: "Bearer invalid.token.here" },
      })
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("API-001: route inconnue → 404 NOT_FOUND", async () => {
    const app = makeFakeApp();
    const res = await app.fetch(
      new Request("http://localhost/api/v1/unknown")
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("API-001: erreur inattendue propagée → 500 INTERNAL_SERVER_ERROR", async () => {
    // Crée une app dont le handler lance une erreur non-SigfaError via un faux Redis qui explose
    const fakeRedis = {
      getdel: vi.fn().mockRejectedValue(new Error("Redis connexion perdue")),
    } as unknown as Redis;
    const fakeDb = {} as Client;
    const errorApp = createApp({
      db: fakeDb,
      redis: fakeRedis,
      jwtSecret: jwtSecretBytes,
    });

    const res = await errorApp.fetch(
      new Request("http://localhost/api/v1/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: "some-token" }),
      })
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
