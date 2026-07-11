import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { retentionPolicies } from "./retention.js";

/**
 * DB-008 — Tests structurels du schéma `retention_policies` (in-process, sans base).
 *
 * Vérifient les colonnes, la borne 1..60, le défaut 13, l'unicité par banque et
 * l'index bank_id-first. Les tests de comportement (RLS, purge, bornes réelles) sont
 * dans `src/crypto/purge.test.ts` (intégration Testcontainers).
 *
 * @module
 */

describe("DB-008: modèle retention_policies (structure)", () => {
  it("DB-008: retention_policies — colonnes attendues (bank_id, phone_retention_months)", () => {
    const config = getTableConfig(retentionPolicies);
    const names = config.columns.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("bank_id");
    expect(names).toContain("phone_retention_months");
    expect(names).toContain("created_at");
    expect(names).toContain("updated_at");
  });

  it("DB-008: phone_retention_months NOT NULL avec défaut 13", () => {
    const config = getTableConfig(retentionPolicies);
    const col = config.columns.find((c) => c.name === "phone_retention_months");
    expect(col).toBeDefined();
    expect(col!.notNull).toBe(true);
    expect(col!.hasDefault).toBe(true);
    // Le défaut est 13 (UEMOA).
    expect(col!.default).toBe(13);
  });

  it("DB-008: CHECK borné 1..60 présent (retention_policies_months_range)", () => {
    const config = getTableConfig(retentionPolicies);
    const check = config.checks.find((c) => c.name === "retention_policies_months_range");
    expect(check).toBeDefined();
  });

  it("DB-008: unicité par banque + index bank_id-first", () => {
    const config = getTableConfig(retentionPolicies);
    const unique = config.uniqueConstraints.find(
      (u) => u.name === "retention_policies_bank_id_key"
    );
    expect(unique).toBeDefined();

    const idx = config.indexes.find((i) => i.config.name === "retention_policies_bank_id_idx");
    expect(idx).toBeDefined();
  });

  it("DB-008: bank_id NOT NULL (FK banks) — pas de politique orpheline", () => {
    const config = getTableConfig(retentionPolicies);
    const bankId = config.columns.find((c) => c.name === "bank_id");
    expect(bankId).toBeDefined();
    expect(bankId!.notNull).toBe(true);
  });
});
