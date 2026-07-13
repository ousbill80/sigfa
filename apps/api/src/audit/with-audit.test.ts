/**
 * Tests unitaires — wrapper transactionnel `withAudit` (SEC-001a).
 *
 * Vérifie l'ATOMICITÉ audit↔métier avec un `pg.Client` simulé :
 *  - succès : BEGIN → corps → INSERT audit → COMMIT (ordre exact) ;
 *  - échec métier : ROLLBACK, aucune écriture d'audit ;
 *  - échec d'audit : ROLLBACK propagé (pas de best-effort — EARS « anormal »).
 *
 * @module
 */

import { describe, it, expect, vi } from "vitest";
import type { Client } from "pg";
import { withAudit, type AuditRequestContext } from "src/audit/with-audit.js";
import type { TenantContext } from "src/middleware/tenant.js";

const tenant: TenantContext = {
  requestId: "req-1",
  userId: "55555555-5555-4555-a555-555555555555",
  bankId: "11111111-1111-4111-a111-111111111111",
  role: "MANAGER",
  agencyIds: [],
};

/** Fabrique un contexte d'audit sur un `pg.Client` simulé enregistrant les SQL. */
function makeCtx(query: ReturnType<typeof vi.fn>): AuditRequestContext {
  return { db: { query } as unknown as Client, tenant, ip: "41.67.128.1" };
}

describe("SEC-001a: withAudit — atomicité audit↔métier", () => {
  it("SEC-001a: succès → BEGIN, corps, INSERT audit, COMMIT dans l'ordre", async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql.trim().split(/\s+/)[0] ?? sql);
      return { rows: [{ id: "audit-1" }] };
    });
    const result = await withAudit(makeCtx(query), async (db) => {
      await db.query("UPDATE queues SET status = 'PAUSED' WHERE id = '1'");
      return {
        result: { ok: true },
        audit: { action: "PATCH /queues/:id", entityType: "queue", entityId: "1" },
      };
    });
    expect(result).toEqual({ ok: true });
    expect(calls[0]).toBe("BEGIN");
    expect(calls[calls.length - 1]).toBe("COMMIT");
    // Une écriture d'audit a bien eu lieu (INSERT INTO audit_log).
    const inserted = query.mock.calls.some((c) =>
      String(c[0]).includes("INSERT INTO audit_log")
    );
    expect(inserted).toBe(true);
  });

  it("SEC-001a: échec du corps métier → ROLLBACK, aucun INSERT audit", async () => {
    const query = vi.fn(async (sql: string): Promise<{ rows: Record<string, unknown>[] }> => {
      void sql;
      return { rows: [] };
    });
    await expect(
      withAudit(makeCtx(query), async () => {
        throw new Error("mutation métier échouée");
      })
    ).rejects.toThrow("mutation métier échouée");
    const sqls = query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toContain("ROLLBACK");
    expect(sqls.some((s) => s.includes("INSERT INTO audit_log"))).toBe(false);
    expect(sqls).not.toContain("COMMIT");
  });

  it("SEC-002: composé (inTransaction) → SAVEPOINT/RELEASE, jamais de BEGIN/COMMIT concurrent", async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
      return { rows: [{ id: "audit-1" }] };
    });
    const ctx: AuditRequestContext = {
      db: { query } as unknown as Client,
      tenant,
      ip: "41.67.128.1",
      inTransaction: true,
    };
    const result = await withAudit(ctx, async (db) => {
      await db.query("UPDATE queues SET status = 'PAUSED' WHERE id = '1'");
      return {
        result: { ok: true },
        audit: { action: "PATCH /queues/:id", entityType: "queue", entityId: "1" },
      };
    });
    expect(result).toEqual({ ok: true });
    const sqls = query.mock.calls.map((c) => String(c[0]));
    // Compose dans la transaction englobante : savepoint, pas de BEGIN/COMMIT.
    expect(sqls.some((s) => s.startsWith("SAVEPOINT"))).toBe(true);
    expect(sqls.some((s) => s.startsWith("RELEASE SAVEPOINT"))).toBe(true);
    expect(sqls).not.toContain("BEGIN");
    expect(sqls).not.toContain("COMMIT");
    expect(sqls.some((s) => s.includes("INSERT INTO audit_log"))).toBe(true);
  });

  it("SEC-002: composé + échec → ROLLBACK TO SAVEPOINT propagé (l'englobant décide du ROLLBACK global)", async () => {
    const query = vi.fn(async (sql: string): Promise<{ rows: Record<string, unknown>[] }> => {
      if (sql.includes("INSERT INTO audit_log")) throw new Error("audit write failed");
      return { rows: [] };
    });
    const ctx: AuditRequestContext = {
      db: { query } as unknown as Client,
      tenant,
      ip: null,
      inTransaction: true,
    };
    await expect(
      withAudit(ctx, async (db) => {
        await db.query("UPDATE queues SET status = 'PAUSED' WHERE id = '1'");
        return {
          result: { ok: true },
          audit: { action: "PATCH /queues/:id", entityType: "queue", entityId: "1" },
        };
      })
    ).rejects.toThrow("audit write failed");
    const sqls = query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.startsWith("ROLLBACK TO SAVEPOINT"))).toBe(true);
    expect(sqls).not.toContain("COMMIT");
  });

  it("SEC-001a: échec d'écriture d'audit → ROLLBACK propagé (pas de best-effort)", async () => {
    // BEGIN ok, UPDATE ok, INSERT audit_log échoue → ROLLBACK, erreur propagée.
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO audit_log")) {
        throw new Error("audit write failed");
      }
      return { rows: [] as Record<string, unknown>[] };
    });
    await expect(
      withAudit(makeCtx(query), async (db) => {
        await db.query("UPDATE queues SET status = 'PAUSED' WHERE id = '1'");
        return {
          result: { ok: true },
          audit: { action: "PATCH /queues/:id", entityType: "queue", entityId: "1" },
        };
      })
    ).rejects.toThrow("audit write failed");
    const sqls = query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toContain("ROLLBACK");
    expect(sqls).not.toContain("COMMIT");
  });
});
