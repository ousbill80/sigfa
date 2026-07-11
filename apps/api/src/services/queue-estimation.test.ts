/**
 * Tests unitaires — API-003 : queue-estimation (constantes + cache + estimation).
 *
 * Le TMT glissant SQL est couvert par tickets.test.ts contre une vraie PG.
 * Ici : constantes LA LOI, cache Redis (faux client), estimation = position×TMT.
 *
 * Nommage : `API-003: <description>`
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  TMT_WINDOW_MINUTES,
  TMT_MIN_OBSERVATIONS,
  TMT_GLOBAL_FALLBACK_MINUTES,
  ESTIMATION_CACHE_TTL_SECONDS,
  estimateWaitMinutes,
  getCachedEstimate,
  setCachedEstimate,
  invalidateEstimate,
} from "src/services/queue-estimation.js";
import type { Tx } from "src/services/queue-strategy.js";

/** Faux Redis en mémoire. */
function fakeRedis(): {
  store: Map<string, string>;
  get: (k: string) => Promise<string | null>;
  set: (k: string, v: string, ...r: unknown[]) => Promise<"OK">;
  del: (k: string) => Promise<number>;
} {
  const store = new Map<string, string>();
  return {
    store,
    get: (k) => Promise.resolve(store.get(k) ?? null),
    set: (k, v) => {
      store.set(k, v);
      return Promise.resolve("OK");
    },
    del: (k) => {
      const had = store.delete(k);
      return Promise.resolve(had ? 1 : 0);
    },
  };
}

/** Faux Tx renvoyant des lignes prédéfinies. */
function fakeTx(rows: unknown[]): Tx {
  return { query: () => Promise.resolve({ rows }) } as unknown as Tx;
}

describe("API-003: queue-estimation", () => {
  it("API-003: constantes LA LOI — fenêtre 60 min, ≥5 obs, fallback 15, cache 10 s", () => {
    expect(TMT_WINDOW_MINUTES).toBe(60);
    expect(TMT_MIN_OBSERVATIONS).toBe(5);
    expect(TMT_GLOBAL_FALLBACK_MINUTES).toBe(15);
    expect(ESTIMATION_CACHE_TTL_SECONDS).toBe(10);
  });

  it("API-003: estimateWaitMinutes = position × TMT ; position 0 → 0", async () => {
    // TMT <5 obs → sla_minutes du service (10) ; position 3 → 30
    const tx = fakeTx([{ n: 0, avg_s: "0" }, { sla_minutes: 10 }]);
    // La 1re requête (COUNT/AVG) renvoie n=0 ; le fallback lit sla_minutes.
    let call = 0;
    const dualTx = {
      query: () => Promise.resolve({ rows: [call++ === 0 ? { n: 0, avg_s: "0" } : { sla_minutes: 10 }] }),
    } as unknown as Tx;
    expect(await estimateWaitMinutes(3, "s1", dualTx)).toBe(30);
    expect(await estimateWaitMinutes(0, "s1", tx)).toBe(0);
  });

  it("API-003: cache set/get/invalidate (faux Redis)", async () => {
    const redis = fakeRedis();
    expect(await getCachedEstimate(redis as never, "q1")).toBeNull();
    await setCachedEstimate(redis as never, "q1", { length: 4, estimate: 40 });
    expect(await getCachedEstimate(redis as never, "q1")).toEqual({ length: 4, estimate: 40 });
    await invalidateEstimate(redis as never, "q1");
    expect(await getCachedEstimate(redis as never, "q1")).toBeNull();
  });
});
