/**
 * Tests unitaires — helpers de contexte d'audit (API-008).
 *
 * @module
 */

import { describe, it, expect, vi } from "vitest";
import {
  toActorRole,
  extractIp,
  buildDiff,
  recordAudit,
} from "src/lib/audit-context.js";
import type { TenantContext } from "src/middleware/tenant.js";

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

  it("API-008: extractIp prend le premier hop de x-forwarded-for", () => {
    const lookup = (n: string): string | undefined =>
      n === "x-forwarded-for" ? "41.67.128.1, 10.0.0.1" : undefined;
    expect(extractIp(lookup)).toBe("41.67.128.1");
  });

  it("API-008: extractIp retombe sur x-real-ip puis null", () => {
    expect(extractIp((n) => (n === "x-real-ip" ? "8.8.8.8" : undefined))).toBe(
      "8.8.8.8"
    );
    expect(extractIp(() => undefined)).toBeNull();
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
