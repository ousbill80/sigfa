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
  acquireIdempotency,
  releaseIdempotencyLock,
  IDEMPOTENCY_TTL_SECONDS,
} from "src/services/idempotency.js";
import { SigfaError } from "src/lib/errors.js";

/**
 * Faux Redis en mémoire supportant `SET NX` (verrou in-flight), `del`, `exists`.
 * Suffisant pour tester la logique atomique d'`acquireIdempotency` sans conteneur.
 */
function fakeRedisNx(): {
  store: Map<string, string>;
  get: (k: string) => Promise<string | null>;
  set: (k: string, v: string, ...rest: unknown[]) => Promise<"OK" | null>;
  del: (k: string) => Promise<number>;
  exists: (k: string) => Promise<number>;
} {
  const store = new Map<string, string>();
  return {
    store,
    get: (k) => Promise.resolve(store.get(k) ?? null),
    set: (k, v, ...rest) => {
      const nx = rest.includes("NX");
      if (nx && store.has(k)) return Promise.resolve(null);
      store.set(k, v);
      return Promise.resolve("OK");
    },
    del: (k) => Promise.resolve(store.delete(k) ? 1 : 0),
    exists: (k) => Promise.resolve(store.has(k) ? 1 : 0),
  };
}

/** Faux Redis en mémoire pour tester la logique sans conteneur. */
function fakeRedis(): {
  get: (k: string) => Promise<string | null>;
  set: (k: string, v: string, ...rest: unknown[]) => Promise<"OK">;
  del: (k: string) => Promise<number>;
} {
  const store = new Map<string, string>();
  return {
    get: (k) => Promise.resolve(store.get(k) ?? null),
    set: (k, v) => {
      store.set(k, v);
      return Promise.resolve("OK");
    },
    del: (k) => Promise.resolve(store.delete(k) ? 1 : 0),
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

describe("SEC-F3: acquireIdempotency atomique (verrou in-flight)", () => {
  it("SEC-F3: 1er appel → proceed ; store → 2e appel rejoue la réponse mémorisée", async () => {
    const redis = fakeRedisNx();
    const payload = { serviceId: "s1", channel: "KIOSK" };
    const first = await acquireIdempotency(redis as never, "tickets:b1", "k1", payload);
    expect(first.kind).toBe("proceed");
    // Le verrou in-flight est posé pendant le traitement.
    expect(redis.store.has("idem-lock:tickets:b1:k1")).toBe(true);

    await storeReplay(redis as never, "tickets:b1", "k1", payload, 201, "{\"id\":\"t1\"}");
    // storeReplay libère le verrou.
    expect(redis.store.has("idem-lock:tickets:b1:k1")).toBe(false);

    const second = await acquireIdempotency(redis as never, "tickets:b1", "k1", payload);
    expect(second.kind).toBe("replay");
    if (second.kind === "replay") {
      expect(second.result.status).toBe(201);
      expect(second.result.body).toBe("{\"id\":\"t1\"}");
    }
  });

  it("SEC-F3: verrou déjà pris + réponse publiée entre-temps → rejeu (pas de doublon)", async () => {
    const redis = fakeRedisNx();
    const payload = { serviceId: "s1", channel: "KIOSK" };
    // Un traitement concurrent détient le verrou.
    await redis.set("idem-lock:tickets:b1:k9", "hash", "PX", 10000, "NX");
    // Il publie sa réponse (comme le ferait storeReplay) puis libère le verrou.
    await storeReplay(redis as never, "tickets:b1", "k9", payload, 201, "{\"id\":\"tX\"}");
    const outcome = await acquireIdempotency(redis as never, "tickets:b1", "k9", payload);
    expect(outcome.kind).toBe("replay");
    if (outcome.kind === "replay") expect(outcome.result.body).toBe("{\"id\":\"tX\"}");
  });

  it("SEC-F3: verrou pris SANS réponse et disparu → 409 IDEMPOTENCY_IN_PROGRESS", async () => {
    const payload = { serviceId: "s1", channel: "KIOSK" };
    // Redis simulé : aucune réponse mémorisée (get null), `SET NX` échoue (verrou
    // concurrent détenu), et `exists` = 0 (verrou disparu pendant l'attente) →
    // l'appelant abandonne rapidement avec 409 IN_PROGRESS (worker mort, jamais de
    // réponse publiée).
    const stubRedis = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(null), // NX échoue → verrou déjà pris
      del: () => Promise.resolve(1),
      exists: () => Promise.resolve(0), // verrou disparu, sans réponse
    };
    await expect(
      acquireIdempotency(stubRedis as never, "tickets:b1", "kdead", payload)
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS", httpStatus: 409 });
  });

  it("SEC-F3: releaseIdempotencyLock supprime le verrou (nouvel essai possible)", async () => {
    const redis = fakeRedisNx();
    await redis.set("idem-lock:tickets:b1:kr", "hash", "PX", 10000, "NX");
    await releaseIdempotencyLock(redis as never, "tickets:b1", "kr");
    expect(redis.store.has("idem-lock:tickets:b1:kr")).toBe(false);
  });
});
