/**
 * Tests unitaires — `withArmedTenant` (SEC-002).
 *
 * Vérifie l'armement RLS transactionnel avec une connexion simulée :
 *  - succès : BEGIN → SET LOCAL app.current_bank_id → corps → COMMIT (ordre exact) ;
 *  - échec du corps : ROLLBACK, jamais de COMMIT ;
 *  - bank_id non-UUID : refus AVANT toute requête (InvalidBankIdError, anti-injection).
 *
 * @module
 */

import { describe, it, expect, vi } from "vitest";
import type { Client, Pool, PoolClient } from "pg";
import {
  withArmedTenant,
  withArmedTenantFromPool,
  asArmable,
  isCanonicalUuid,
  InvalidBankIdError,
  type ArmableConnection,
} from "src/lib/armed-tenant.js";

const BANK = "11111111-1111-4111-a111-111111111111";

/** Fabrique une connexion simulée enregistrant l'ordre des SQL exécutés. */
function makeConn(): { conn: ArmableConnection; calls: string[] } {
  const calls: string[] = [];
  const conn: ArmableConnection = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql.trim());
      return { rows: [] as unknown[] };
    }),
  };
  return { conn, calls };
}

describe("SEC-002: withArmedTenant — armement RLS transactionnel", () => {
  it("SEC-002: succès → BEGIN, SET LOCAL app.current_bank_id, corps, COMMIT dans l'ordre", async () => {
    const { conn, calls } = makeConn();
    const out = await withArmedTenant(conn, BANK, async (c) => {
      await c.query("SELECT * FROM agencies");
      return "ok";
    });
    expect(out).toBe("ok");
    expect(calls[0]).toBe("BEGIN");
    expect(calls[1]).toBe(`SET LOCAL app.current_bank_id = '${BANK}'`);
    expect(calls).toContain("SELECT * FROM agencies");
    expect(calls[calls.length - 1]).toBe("COMMIT");
  });

  it("SEC-002: l'armement précède TOUTE requête métier (bank_id posé avant le corps)", async () => {
    const { conn, calls } = makeConn();
    await withArmedTenant(conn, BANK, async (c) => {
      await c.query("INSERT INTO agencies (bank_id, name) VALUES ($1,$2)", [BANK, "x"]);
      return null;
    });
    const setIdx = calls.findIndex((s) => s.startsWith("SET LOCAL app.current_bank_id"));
    const mutIdx = calls.findIndex((s) => s.startsWith("INSERT INTO agencies"));
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(mutIdx).toBeGreaterThan(setIdx);
  });

  it("SEC-002: échec du corps → ROLLBACK, jamais de COMMIT, erreur propagée", async () => {
    const { conn, calls } = makeConn();
    await expect(
      withArmedTenant(conn, BANK, async () => {
        throw new Error("boom métier");
      })
    ).rejects.toThrow("boom métier");
    expect(calls).toContain("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
  });

  it("SEC-002: bank_id non-UUID → InvalidBankIdError AVANT toute requête (anti-injection SET)", async () => {
    const { conn, calls } = makeConn();
    await expect(
      withArmedTenant(conn, "'; DROP TABLE agencies; --", async () => "never")
    ).rejects.toBeInstanceOf(InvalidBankIdError);
    // Aucune requête n'a été émise : ni BEGIN, ni SET LOCAL.
    expect(calls).toHaveLength(0);
  });

  it("SEC-002: isCanonicalUuid — accepte un UUID canonique, refuse le reste", () => {
    expect(isCanonicalUuid(BANK)).toBe(true);
    expect(isCanonicalUuid("not-a-uuid")).toBe(false);
    expect(isCanonicalUuid("")).toBe(false);
    expect(isCanonicalUuid(`${BANK}' OR '1'='1`)).toBe(false);
  });

  it("SEC-002: withArmedTenantFromPool — réserve une connexion, l'arme, la relâche TOUJOURS", async () => {
    const calls: string[] = [];
    const release = vi.fn();
    const poolClient = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql.trim());
        return { rows: [] as unknown[] };
      }),
      release,
    } as unknown as PoolClient;
    const pool = {
      connect: vi.fn(async () => poolClient),
    } as unknown as Pool;

    const out = await withArmedTenantFromPool(pool, BANK, async (c) => {
      await c.query("SELECT 1");
      return 42;
    });
    expect(out).toBe(42);
    expect(calls[0]).toBe("BEGIN");
    expect(calls[1]).toBe(`SET LOCAL app.current_bank_id = '${BANK}'`);
    expect(calls[calls.length - 1]).toBe("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("SEC-002: withArmedTenantFromPool — relâche la connexion MÊME en cas d'erreur", async () => {
    const release = vi.fn();
    const poolClient = {
      query: vi.fn(async () => ({ rows: [] as unknown[] })),
      release,
    } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => poolClient) } as unknown as Pool;
    await expect(
      withArmedTenantFromPool(pool, BANK, async () => {
        throw new Error("échec dans la connexion réservée");
      })
    ).rejects.toThrow("échec dans la connexion réservée");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("SEC-002: asArmable — un pg.Client satisfait ArmableConnection", () => {
    const client = { query: vi.fn() } as unknown as Client;
    const armable = asArmable(client);
    expect(typeof armable.query).toBe("function");
  });
});
