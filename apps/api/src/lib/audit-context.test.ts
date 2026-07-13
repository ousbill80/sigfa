/**
 * Tests unitaires — helpers de contexte d'audit (API-008).
 *
 * @module
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { Hono } from "hono";
import {
  toActorRole,
  extractIp,
  buildDiff,
  recordAudit,
  isSensitiveKey,
  stripSensitive,
} from "src/lib/audit-context.js";
import type { TenantContext } from "src/middleware/tenant.js";

/** Résout l'IP d'audit pour un jeu d'en-têtes via une app Hono minimale. */
async function auditIp(headers: Record<string, string>): Promise<string | null> {
  const app = new Hono();
  app.get("/x", (c) => c.json({ ip: extractIp(c) }));
  const res = await app.request("/x", { headers });
  return ((await res.json()) as { ip: string | null }).ip;
}

afterEach(() => {
  delete process.env["TRUST_PROXY"];
});

const tenant: TenantContext = {
  requestId: "req-1",
  userId: "55555555-5555-4555-a555-555555555555",
  bankId: "11111111-1111-4111-a111-111111111111",
  role: "BANK_ADMIN",
  agencyIds: [],
};

describe("API-008: audit-context helpers", () => {
  it("API-008: toActorRole conserve les rôles persistés, null pour sentinelles", () => {
    expect(toActorRole("BANK_ADMIN")).toBe("BANK_ADMIN");
    expect(toActorRole("AUDITOR")).toBe("AUDITOR");
    expect(toActorRole("NONE")).toBeNull();
    expect(toActorRole("AUTHENTICATED")).toBeNull();
  });

  it("API-008: extractIp prend le premier hop de x-forwarded-for quand TRUST_PROXY on", async () => {
    process.env["TRUST_PROXY"] = "true";
    expect(await auditIp({ "x-forwarded-for": "41.67.128.1, 10.0.0.1" })).toBe("41.67.128.1");
  });

  it("API-008: extractIp retombe sur x-real-ip (TRUST_PROXY on) puis null", async () => {
    process.env["TRUST_PROXY"] = "1";
    expect(await auditIp({ "x-real-ip": "8.8.8.8" })).toBe("8.8.8.8");
    expect(await auditIp({})).toBeNull();
  });

  it("SEC-F3: extractIp IGNORE x-forwarded-for falsifié quand TRUST_PROXY off", async () => {
    delete process.env["TRUST_PROXY"];
    // XFF forgé ignoré → jamais l'IP du header (audit non falsifiable).
    expect(await auditIp({ "x-forwarded-for": "6.6.6.6" })).not.toBe("6.6.6.6");
    expect(await auditIp({ "x-real-ip": "6.6.6.6" })).not.toBe("6.6.6.6");
  });

  it("API-008: buildDiff ne retient que les clés modifiées", () => {
    const diff = buildDiff(
      { name: "A", active: true },
      { name: "B", active: true }
    );
    expect(diff).toEqual({ before: { name: "A" }, after: { name: "B" } });
  });

  it("API-008: buildDiff gère les valeurs undefined/null", () => {
    const diff = buildDiff({ x: undefined }, { x: 5 });
    expect(diff).toEqual({ before: { x: null }, after: { x: 5 } });
  });

  it("SEC-001a: isSensitiveKey exclut suffixes DB-004 et noms téléphone/secret", () => {
    expect(isSensitiveKey("phone_encrypted")).toBe(true);
    expect(isSensitiveKey("phone_hash")).toBe(true);
    expect(isSensitiveKey("credentials_cipher")).toBe(true);
    expect(isSensitiveKey("phoneNumber")).toBe(true);
    expect(isSensitiveKey("kioskSecret")).toBe(true);
    expect(isSensitiveKey("password_hash")).toBe(true);
    // Champs non sensibles conservés.
    expect(isSensitiveKey("status")).toBe(false);
    expect(isSensitiveKey("serviceId")).toBe(false);
    expect(isSensitiveKey("name")).toBe(false);
  });

  it("SEC-001a: stripSensitive retire en profondeur téléphone/hash/secret", () => {
    const cleaned = stripSensitive({
      before: { status: "WAITING", phoneNumber: "+2250700000000", phone_hash: "abc" },
      after: { status: "DONE", note: 5, credentials_encrypted: "xxx" },
    });
    expect(cleaned).toEqual({
      before: { status: "WAITING" },
      after: { status: "DONE", note: 5 },
    });
  });

  it("SEC-001a: buildDiff n'expose JAMAIS le téléphone en clair même modifié", () => {
    const diff = buildDiff(
      { status: "WAITING", phoneNumber: null },
      { status: "DONE", phoneNumber: "+2250700000000" }
    );
    expect(diff).toEqual({ before: { status: "WAITING" }, after: { status: "DONE" } });
    expect(JSON.stringify(diff)).not.toContain("+2250700000000");
  });

  it("SEC-001a: recordAudit assainit le diff avant persistance (téléphone exclu du SQL)", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "a" }] });
    const db = { query } as unknown as import("pg").Client;
    await recordAudit({
      db,
      tenant,
      action: "POST /public/tickets",
      entityType: "ticket",
      entityId: "22222222-2222-4222-a222-222222222222",
      ip: "41.67.128.1",
      diff: { after: { status: "WAITING", phoneNumber: "+2250700000000" } },
    });
    const sql = (query.mock.calls[0]?.[0] ?? "") as string;
    expect(sql).not.toContain("+2250700000000");
    expect(sql).not.toContain("phoneNumber");
    expect(sql).toContain("WAITING");
  });

  it("API-008: recordAudit adapte pg.Client à insertAuditEntry et écrit qui/quoi/IP", async () => {
    const rows = [{ id: "audit-1" }];
    const query = vi.fn().mockResolvedValue({ rows });
    const db = { query } as unknown as import("pg").Client;
    const result = await recordAudit({
      db,
      tenant,
      action: "PATCH /banks/x",
      entityType: "bank",
      entityId: "11111111-1111-4111-a111-111111111111",
      ip: "41.67.128.1",
      actorEmail: "admin@bnci.ci",
      diff: { before: { name: "A" }, after: { name: "B" } },
    });
    expect(result).toEqual({ id: "audit-1" });
    const sql = (query.mock.calls[0]?.[0] ?? "") as string;
    expect(sql).toContain("INSERT INTO audit_log");
    expect(sql).toContain("'BANK_ADMIN'::role");
    expect(sql).toContain("41.67.128.1");
    expect(sql).toContain("admin@bnci.ci");
  });
});
