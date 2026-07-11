/**
 * DB-008 — Suite de tests unitaires : chiffrement AES-256-GCM + HMAC des téléphones
 *
 * TDD rouge→vert : ces tests échouent AVANT l'implémentation de `phone-cipher.ts`.
 * Ces tests sont PURS (aucune base de données) — ils valident le round-trip du
 * chiffrement, le déterminisme du HMAC, la normalisation E.164 et l'échec explicite
 * au chargement quand la clé est absente ou invalide.
 *
 * ## Isolation des variables d'environnement
 * Le module `phone-cipher.ts` LIT les clés AU CHARGEMENT (fail-fast). Pour tester les
 * cas d'erreur de chargement, on utilise `vi.resetModules()` + un import dynamique après
 * avoir manipulé `process.env` (aucun mock du crypto lui-même — LA LOI T5 : on teste le
 * vrai `node:crypto`).
 *
 * @module
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Clés de test valides (32 octets = 64 hex chars).
const VALID_ENC_KEY = "0".repeat(64); // 32 octets hex
// DB-009: PHONE_HASH_KEY doit faire exactement 64 hex chars (32 octets)
const VALID_HASH_KEY = "a".repeat(64);

/**
 * Recharge le module `phone-cipher.ts` avec un environnement contrôlé.
 * @param env - Variables d'environnement à définir avant le chargement
 * @returns Le module fraîchement importé
 */
async function loadModule(env: Record<string, string | undefined>): Promise<
  typeof import("src/crypto/phone-cipher.js")
> {
  vi.resetModules();
  const previous = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await import("src/crypto/phone-cipher.js");
  } finally {
    // Restaurer l'environnement pour ne pas polluer les autres imports.
    process.env = previous;
  }
}

describe("DB-008 — phone-cipher (AES-256-GCM + HMAC-SHA256, unitaire)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.PHONE_ENCRYPTION_KEY = VALID_ENC_KEY;
    process.env.PHONE_HASH_KEY = VALID_HASH_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Critère 1 : round-trip exact + IV aléatoire + hash déterministe + normalisation
  // ───────────────────────────────────────────────────────────────────────────

  it(
    "DB-008: round-trip exact ; même numéro → ciphertexts différents (IV) mais même phone_hash",
    async () => {
      const mod = await loadModule({
        PHONE_ENCRYPTION_KEY: VALID_ENC_KEY,
        PHONE_HASH_KEY: VALID_HASH_KEY,
      });
      const phone = "+2250700000001";

      // Round-trip exact
      const c1 = mod.encryptPhone(phone);
      const c2 = mod.encryptPhone(phone);
      expect(mod.decryptPhone(c1)).toBe(phone);
      expect(mod.decryptPhone(c2)).toBe(phone);

      // Format versionné v1:iv:tag:ct (4 segments)
      expect(c1.startsWith("v1:")).toBe(true);
      expect(c1.split(":")).toHaveLength(4);

      // Même numéro → ciphertexts différents (IV aléatoire par valeur)
      expect(c1).not.toBe(c2);

      // Mais même phone_hash (déterminisme HMAC)
      expect(mod.hashPhone(phone)).toBe(mod.hashPhone(phone));
      // Hash = 64 hex chars (SHA256)
      expect(mod.hashPhone(phone)).toMatch(/^[0-9a-f]{64}$/);
    }
  );

  it(
    "DB-008: '+225 07 00 00 00 01' et '+2250700000001' → MÊME hash (normalisation centralisée)",
    async () => {
      const mod = await loadModule({
        PHONE_ENCRYPTION_KEY: VALID_ENC_KEY,
        PHONE_HASH_KEY: VALID_HASH_KEY,
      });

      const spaced = "+225 07 00 00 00 01";
      const dashed = "+225-07-00-00-00-01";
      const canonical = "+2250700000001";

      // La normalisation (strip espaces/tirets) précède le HMAC → même hash.
      expect(mod.hashPhone(spaced)).toBe(mod.hashPhone(canonical));
      expect(mod.hashPhone(dashed)).toBe(mod.hashPhone(canonical));

      // Deux numéros distincts → hashes distincts
      expect(mod.hashPhone("+2250700000001")).not.toBe(mod.hashPhone("+2250700000002"));

      // `normalizePhone` est exporté et renvoie la forme canonique E.164.
      expect(mod.normalizePhone(spaced)).toBe(canonical);
      expect(mod.normalizePhone(dashed)).toBe(canonical);
    }
  );

  it(
    "DB-008: format invalide → InvalidPhoneError (test)",
    async () => {
      const mod = await loadModule({
        PHONE_ENCRYPTION_KEY: VALID_ENC_KEY,
        PHONE_HASH_KEY: VALID_HASH_KEY,
      });

      const invalids = [
        "0700000001", // pas de +
        "+0700000001", // commence par +0
        "+225", // trop court
        "+225070000000123456789", // trop long (> 15 chiffres)
        "+225ABCDEF1", // caractères non numériques
        "", // vide
        "not-a-phone",
      ];

      for (const bad of invalids) {
        expect(() => mod.hashPhone(bad), `hashPhone("${bad}")`).toThrow(mod.InvalidPhoneError);
        expect(() => mod.normalizePhone(bad), `normalizePhone("${bad}")`).toThrow(
          mod.InvalidPhoneError
        );
      }

      // InvalidPhoneError est bien une classe d'Error avec un name propre.
      try {
        mod.normalizePhone("bad");
        expect.unreachable("normalizePhone doit lever InvalidPhoneError");
      } catch (err) {
        expect(err).toBeInstanceOf(mod.InvalidPhoneError);
        expect((err as Error).name).toBe("InvalidPhoneError");
      }
    }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Critère 2 : clé absente/invalide → échec explicite au chargement
  // ───────────────────────────────────────────────────────────────────────────

  it(
    "DB-008: PHONE_ENCRYPTION_KEY absente → échec explicite au chargement (test)",
    async () => {
      await expect(
        loadModule({ PHONE_ENCRYPTION_KEY: undefined, PHONE_HASH_KEY: VALID_HASH_KEY })
      ).rejects.toThrow(/PHONE_ENCRYPTION_KEY/);
    }
  );

  it(
    "DB-008: PHONE_ENCRYPTION_KEY de mauvaise taille → échec explicite au chargement (test)",
    async () => {
      // 16 octets au lieu de 32 → rejet.
      await expect(
        loadModule({ PHONE_ENCRYPTION_KEY: "0".repeat(32), PHONE_HASH_KEY: VALID_HASH_KEY })
      ).rejects.toThrow(/32/);
    }
  );

  it(
    "DB-008: PHONE_ENCRYPTION_KEY non-hex → échec explicite au chargement (test)",
    async () => {
      await expect(
        loadModule({ PHONE_ENCRYPTION_KEY: "z".repeat(64), PHONE_HASH_KEY: VALID_HASH_KEY })
      ).rejects.toThrow(/PHONE_ENCRYPTION_KEY/);
    }
  );

  it(
    "DB-008: PHONE_HASH_KEY absente → échec explicite au chargement (test)",
    async () => {
      await expect(
        loadModule({ PHONE_ENCRYPTION_KEY: VALID_ENC_KEY, PHONE_HASH_KEY: undefined })
      ).rejects.toThrow(/PHONE_HASH_KEY/);
    }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Critère complémentaire : altération du ciphertext/tag → déchiffrement rejeté
  // ───────────────────────────────────────────────────────────────────────────

  it(
    "DB-008: ciphertext altéré ou format inconnu → decryptPhone rejette (intégrité GCM)",
    async () => {
      const mod = await loadModule({
        PHONE_ENCRYPTION_KEY: VALID_ENC_KEY,
        PHONE_HASH_KEY: VALID_HASH_KEY,
      });

      const cipher = mod.encryptPhone("+2250700000001");
      const parts = cipher.split(":");
      // Corrompre le dernier octet du ciphertext (segment 4).
      const corruptedCt = parts[3]!.slice(0, -2) + (parts[3]!.slice(-2) === "ff" ? "00" : "ff");
      const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${corruptedCt}`;
      expect(() => mod.decryptPhone(tampered)).toThrow();

      // Version inconnue → rejet explicite.
      expect(() => mod.decryptPhone("v9:aa:bb:cc")).toThrow(/version/i);
      // Format malformé (mauvais nombre de segments) → rejet.
      expect(() => mod.decryptPhone("garbage")).toThrow();
    }
  );
});
