/**
 * Tests unitaires — API-003 : idempotence (clé requise, rejeu, conflit).
 *
 * Le rejeu réel contre Redis Testcontainers est couvert par tickets.test.ts ;
 * ici on vérifie la logique de clé + hachage stable + conflit.
 *
 * Nommage : `API-003: <description>`
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  requireIdempotencyKey,
  findReplay,
  storeReplay,
  IDEMPOTENCY_TTL_SECONDS,
} from "src/services/idempotency.js";
import { SigfaError } from "src/lib/errors.js";

/** Faux Redis en mémoire pour tester la logique sans conteneur. */
function fakeRedis(): {
  get: (k: string) => Promise<string | null>;
  set: (k: string, v: string, ...rest: unknown[]) => Promise<"OK">;
} {
  const store = new Map<string, string>();
  return {
    get: (k) => Promise.resolve(store.get(k) ?? null),
    set: (k, v) => {
      store.set(k, v);
      return Promise.resolve("OK");
    },
  };
}

describe("API-003: idempotency", () => {
  it("API-003: clé absente sur mutation critique → 400 IDEMPOTENCY_KEY_REQUIRED", () => {
    expect(() => requireIdempotencyKey(undefined)).toThrowError(SigfaError);
    expect(() => requireIdempotencyKey("")).toThrowError(SigfaError);
    try {
      requireIdempotencyKey("   ");
    } catch (err) {
      expect((err as SigfaError).code).toBe("IDEMPOTENCY_KEY_REQUIRED");
      expect((err as SigfaError).httpStatus).toBe(400);
    }
    expect(requireIdempotencyKey("abc")).toBe("abc");
  });

  it("API-003: TTL d'idempotence = 24 h", () => {
    expect(IDEMPOTENCY_TTL_SECONDS).toBe(86_400);
  });

  it("API-003: rejeu même clé + même payload → réponse identique octet", async () => {
    const redis = fakeRedis();
    const payload = { serviceId: "s1", channel: "KIOSK" };
    const body = JSON.stringify({ id: "t1", displayNumber: "OC-001" });

    expect(await findReplay(redis as never, "tickets:b1", "k1", payload)).toBeNull();
    await storeReplay(redis as never, "tickets:b1", "k1", payload, 201, body);

    // Payload logiquement identique mais clés ré-ordonnées → même hash stable
    const reordered = { channel: "KIOSK", serviceId: "s1" };
    const replay = await findReplay(redis as never, "tickets:b1", "k1", reordered);
    expect(replay).not.toBeNull();
    expect(replay?.status).toBe(201);
    expect(replay?.body).toBe(body);
  });

  it("API-003: même clé + payload différent → 409 IDEMPOTENCY_CONFLICT", async () => {
    const redis = fakeRedis();
    await storeReplay(redis as never, "tickets:b1", "k2", { a: 1 }, 201, "{}");
    await expect(findReplay(redis as never, "tickets:b1", "k2", { a: 2 })).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      httpStatus: 409,
    });
  });
});
