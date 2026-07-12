/**
 * Tests for agents-import (WEB-006) — import report summary.
 * @module lib/agents-import.test
 */
import { describe, it, expect } from "vitest";
import { toImportSummary, summaryLine } from "./agents-import";

describe("agents-import — résumé", () => {
  it("WEB-006: import CSV — résumé N créés / M ignorés / K erreurs", () => {
    const summary = toImportSummary({
      created: 48,
      skipped: 2,
      errors: [
        { line: 12, field: "email", code: "DUPLICATE_EMAIL", message: "L'email est déjà enregistré." },
        { line: 35, field: "role", code: "INVALID_ROLE", message: "Rôle invalide." },
      ],
    });
    expect(summary.created).toBe(48);
    expect(summary.skipped).toBe(2);
    expect(summary.errorCount).toBe(2);
    // Motif par ligne présent (message humain, pas le code brut).
    expect(summary.errors[0]!.line).toBe(12);
    expect(summary.errors[0]!.message).toContain("email");
    expect(summaryLine(summary)).toBe("48 créés / 2 ignorés / 2 erreurs");
  });

  it("WEB-006: payload malformé → résumé défensif (0/0/0)", () => {
    const s = toImportSummary(null);
    expect(summaryLine(s)).toBe("0 créés / 0 ignorés / 0 erreurs");
    // Une erreur sans line/message est ignorée.
    const s2 = toImportSummary({ created: 1, skipped: 0, errors: [{ field: "x" }] });
    expect(s2.errorCount).toBe(0);
    expect(s2.created).toBe(1);
  });
});
