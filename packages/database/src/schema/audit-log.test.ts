import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { auditLog } from "./audit-log.js";

/**
 * Tests structurels du modèle `audit_log` (DB-004) — in-process, sans base.
 * Vérifient les colonnes attendues, l'horloge serveur et les deux index.
 */
describe("DB-004: modèle audit_log (structure)", () => {
  it("DB-004: audit_log porte les colonnes du modèle EARS", () => {
    const config = getTableConfig(auditLog);
    const names = config.columns.map((c) => c.name).sort();
    for (const expected of [
      "id",
      "bank_id",
      "actor_id",
      "actor_role",
      "actor_email",
      "action",
      "entity_type",
      "entity_id",
      "occurred_at",
      "ip",
      "diff",
    ]) {
      expect(names, `colonne ${expected}`).toContain(expected);
    }
  });

  it("DB-004: occurred_at NOT NULL DEFAULT now() (horloge serveur)", () => {
    const config = getTableConfig(auditLog);
    const occurredAt = config.columns.find((c) => c.name === "occurred_at");
    expect(occurredAt?.notNull).toBe(true);
    expect(occurredAt?.hasDefault).toBe(true);
  });

  it("DB-004: bank_id NOT NULL + index (bank_id, occurred_at) et (bank_id, entity_type, entity_id)", () => {
    const config = getTableConfig(auditLog);
    const bankId = config.columns.find((c) => c.name === "bank_id");
    expect(bankId?.notNull).toBe(true);
    const indexNames = config.indexes.map((i) => i.config.name).sort();
    expect(indexNames).toContain("audit_log_bank_id_occurred_at_idx");
    expect(indexNames).toContain("audit_log_bank_id_entity_idx");
  });
});
