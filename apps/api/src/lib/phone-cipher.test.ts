/**
 * Tests unitaires — API-003 : phone-cipher (chiffrement + hash déterministe).
 *
 * Nommage : `API-003: <description>`
 *
 * @module
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  encryptPhone,
  decryptPhone,
  hashPhone,
  normalizePhone,
} from "src/lib/phone-cipher.js";
import { SigfaError } from "src/lib/errors.js";

beforeAll(() => {
  process.env["PHONE_ENCRYPTION_KEY"] =
    "1111111111111111111111111111111111111111111111111111111111111111";
  process.env["PHONE_HASH_KEY"] =
    "2222222222222222222222222222222222222222222222222222222222222222";
});

describe("API-003: phone-cipher", () => {
  it("API-003: chiffre puis déchiffre → forme canonique E.164 (jamais de clair)", () => {
    const cipher = encryptPhone("+225 07 00 00 00 01");
    expect(cipher).toMatch(/^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(cipher).not.toContain("0700000001");
    expect(decryptPhone(cipher)).toBe("+2250700000001");
  });

  it("API-003: hash déterministe — deux représentations d'un même numéro → même hash", () => {
    const a = hashPhone("+225 07-00-00-00-01");
    const b = hashPhone("+2250700000001");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("API-003: IV aléatoire — deux chiffrements du même numéro → ciphertexts distincts", () => {
    expect(encryptPhone("+2250700000001")).not.toBe(encryptPhone("+2250700000001"));
  });

  it("API-003: numéro non E.164 → SigfaError 422 INVALID_PHONE", () => {
    expect(() => normalizePhone("0700000001")).toThrowError(SigfaError);
    try {
      normalizePhone("abc");
    } catch (err) {
      expect((err as SigfaError).code).toBe("INVALID_PHONE");
      expect((err as SigfaError).httpStatus).toBe(422);
    }
  });

  it("API-003: format de chiffrement invalide → SigfaError 500", () => {
    expect(() => decryptPhone("not-a-cipher")).toThrowError(SigfaError);
    expect(() => decryptPhone("v2:a:b:c")).toThrowError(SigfaError);
  });

  it("API-003: clé absente/invalide → SigfaError 500", () => {
    const saved = process.env["PHONE_HASH_KEY"];
    process.env["PHONE_HASH_KEY"] = "tooshort";
    expect(() => hashPhone("+2250700000001")).toThrowError(SigfaError);
    process.env["PHONE_HASH_KEY"] = saved;
  });
});
