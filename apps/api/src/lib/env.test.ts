/**
 * Tests unitaires pour lib/env.ts — API-001
 *
 * @module
 */

import { describe, it, expect, afterEach } from "vitest";
import { getJwtSecret, getRedisUrl, getDatabaseUrl } from "src/lib/env.js";

describe("env", () => {
  afterEach(() => {
    // Nettoyage des variables d'env modifiées
    delete process.env["JWT_SECRET"];
    delete process.env["REDIS_URL"];
    delete process.env["DATABASE_URL"];
  });

  it("getJwtSecret lève une erreur si JWT_SECRET est absent", () => {
    delete process.env["JWT_SECRET"];
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
  });

  it("getJwtSecret lève une erreur si JWT_SECRET est trop court (<32 chars)", () => {
    process.env["JWT_SECRET"] = "short-secret";
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
  });

  it("getJwtSecret retourne le secret si ≥32 caractères", () => {
    process.env["JWT_SECRET"] = "a".repeat(32);
    expect(getJwtSecret()).toBe("a".repeat(32));
  });

  it("getRedisUrl retourne REDIS_URL si définie", () => {
    process.env["REDIS_URL"] = "redis://custom:6380";
    expect(getRedisUrl()).toBe("redis://custom:6380");
  });

  it("getRedisUrl retourne la valeur par défaut si REDIS_URL est absente", () => {
    delete process.env["REDIS_URL"];
    expect(getRedisUrl()).toBe("redis://localhost:6379");
  });

  it("getDatabaseUrl retourne DATABASE_URL si définie", () => {
    process.env["DATABASE_URL"] = "postgresql://user:pass@host/db";
    expect(getDatabaseUrl()).toBe("postgresql://user:pass@host/db");
  });

  it("getDatabaseUrl retourne la valeur par défaut si DATABASE_URL est absente", () => {
    delete process.env["DATABASE_URL"];
    expect(getDatabaseUrl()).toBe(
      "postgresql://sigfa:sigfa_test@localhost:5432/sigfa_test"
    );
  });
});
