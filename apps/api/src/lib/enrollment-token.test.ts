/**
 * Tests unitaires — jeton d'enrôlement borne (ADM-002a).
 *
 * Prouve : opacité + entropie, bornes TTL [5,120], hachage stable, usage unique
 * (consommation atomique déléguée au store), refus OPAQUE indistinct
 * (inconnu/consommé/mauvais tenant), garde de préfixe.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  generateEnrollmentToken,
  consumeEnrollmentToken,
  assertTtlBounds,
  hashEnrollmentToken,
  EnrollmentInvalidError,
  ENROLLMENT_TOKEN_PREFIX,
  ENROLLMENT_TTL_MIN_MINUTES,
  ENROLLMENT_TTL_MAX_MINUTES,
  ENROLLMENT_TTL_DEFAULT_MINUTES,
  type EnrollmentBinding,
  type EnrollmentTokenStore,
} from "src/lib/enrollment-token.js";

/** Store en mémoire single-use (GETDEL simulé) pour les tests. */
class MemoryStore implements EnrollmentTokenStore {
  private map = new Map<string, { binding: EnrollmentBinding; expiresAt: number }>();
  async put(
    k: string,
    b: EnrollmentBinding,
    ttlSeconds: number
  ): Promise<void> {
    this.map.set(k, { binding: b, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
  async consume(k: string): Promise<EnrollmentBinding | null> {
    const v = this.map.get(k);
    if (v === undefined) return null;
    this.map.delete(k); // atomicité simulée : lecture + suppression.
    if (v.expiresAt <= Date.now()) return null; // expiration native simulée.
    return v.binding;
  }
}

const BINDING: EnrollmentBinding = {
  kioskId: "14141414-1414-4141-a141-141414141414",
  bankId: "22222222-2222-4222-a222-222222222222",
  agencyId: "66666666-6666-4666-a666-666666666666",
};

describe("ADM-002a: enrollmentToken opaque + TTL borné", () => {
  it("ADM-002a: token opaque préfixé enr_ à haute entropie", () => {
    const a = generateEnrollmentToken();
    const b = generateEnrollmentToken();
    expect(a.token.startsWith(ENROLLMENT_TOKEN_PREFIX)).toBe(true);
    expect(a.token).not.toBe(b.token);
    // Aucune donnée métier n'est dérivable : pas de kioskId/bankId dans le token.
    expect(a.token).not.toContain(BINDING.kioskId);
    // Entropie : partie aléatoire base64url ≥ 40 chars.
    expect(a.token.length).toBeGreaterThan(ENROLLMENT_TOKEN_PREFIX.length + 40);
  });

  it("ADM-002a: la clé de stockage est le SHA-256 du token (jamais le clair)", () => {
    const g = generateEnrollmentToken();
    expect(g.storageKey).toBe(hashEnrollmentToken(g.token));
    expect(g.storageKey).not.toContain(g.token);
    expect(g.storageKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ADM-002a: TTL par défaut = 60 min → 3600 s + expiration cohérente", () => {
    const now = new Date("2026-07-12T10:00:00Z");
    const g = generateEnrollmentToken(ENROLLMENT_TTL_DEFAULT_MINUTES, now);
    expect(g.ttlSeconds).toBe(60 * 60);
    expect(g.expiresAt.toISOString()).toBe("2026-07-12T11:00:00.000Z");
  });

  it("ADM-002a: TTL accepté sur les bornes [5,120]", () => {
    expect(assertTtlBounds(ENROLLMENT_TTL_MIN_MINUTES)).toBe(5);
    expect(assertTtlBounds(ENROLLMENT_TTL_MAX_MINUTES)).toBe(120);
    expect(generateEnrollmentToken(5).ttlSeconds).toBe(300);
    expect(generateEnrollmentToken(120).ttlSeconds).toBe(7200);
  });

  it("ADM-002a: TTL hors bornes ou non entier → RangeError (jamais immortel)", () => {
    expect(() => assertTtlBounds(4)).toThrow(RangeError);
    expect(() => assertTtlBounds(121)).toThrow(RangeError);
    expect(() => assertTtlBounds(0)).toThrow(RangeError);
    expect(() => assertTtlBounds(-1)).toThrow(RangeError);
    expect(() => assertTtlBounds(30.5)).toThrow(RangeError);
    expect(() => generateEnrollmentToken(1000)).toThrow(RangeError);
  });
});

describe("ADM-002a: consommation single-use + refus opaque", () => {
  it("ADM-002a: échange consomme et INVALIDE le token (rejeu → opaque)", async () => {
    const store = new MemoryStore();
    const g = generateEnrollmentToken();
    await store.put(g.storageKey, BINDING, g.ttlSeconds);

    const first = await consumeEnrollmentToken(store, g.token);
    expect(first).toEqual(BINDING);

    // Rejeu du MÊME token → refus opaque (usage unique).
    await expect(consumeEnrollmentToken(store, g.token)).rejects.toBeInstanceOf(
      EnrollmentInvalidError
    );
  });

  it("ADM-002a: token inconnu → 401 opaque KIOSK_ENROLLMENT_INVALID", async () => {
    const store = new MemoryStore();
    try {
      await consumeEnrollmentToken(store, "enr_inconnu-xyz");
      expect.unreachable("aurait dû lever");
    } catch (err) {
      expect(err).toBeInstanceOf(EnrollmentInvalidError);
      const e = err as EnrollmentInvalidError;
      expect(e.code).toBe("KIOSK_ENROLLMENT_INVALID");
      expect(e.httpStatus).toBe(401);
    }
  });

  it("ADM-002a: token d'un AUTRE tenant → refus opaque, indistinct d'un inconnu", async () => {
    const store = new MemoryStore();
    const g = generateEnrollmentToken();
    await store.put(g.storageKey, BINDING, g.ttlSeconds);
    await expect(
      consumeEnrollmentToken(store, g.token, { bankId: "99999999-9999-4999-a999-999999999999" })
    ).rejects.toBeInstanceOf(EnrollmentInvalidError);
    // Bonus : même tenant → OK.
    const g2 = generateEnrollmentToken();
    await store.put(g2.storageKey, BINDING, g2.ttlSeconds);
    const ok = await consumeEnrollmentToken(store, g2.token, { bankId: BINDING.bankId });
    expect(ok.agencyId).toBe(BINDING.agencyId);
  });

  it("ADM-002a: token sans préfixe enr_ → refus opaque (garde de format)", async () => {
    const store = new MemoryStore();
    await expect(consumeEnrollmentToken(store, "no-prefix")).rejects.toBeInstanceOf(
      EnrollmentInvalidError
    );
  });

  it("ADM-002a: le message d'erreur ne divulgue JAMAIS la cause (anti-oracle)", () => {
    expect(new EnrollmentInvalidError().message).toBe("Enrôlement invalide.");
  });
});
