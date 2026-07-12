/**
 * Tests unitaires — parsing CSV d'import d'agents (API-009).
 *
 * Couvre : en-tête valide, > 500 lignes → IMPORT_TOO_LARGE, colonne manquante →
 * INVALID_CSV_FORMAT, lignes invalides → erreurs précises (rôle, email), et
 * surtout téléphone non-E.164 → INVALID_PHONE_FORMAT.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { parseAgentCsv, MAX_IMPORT_LINES } from "src/lib/csv-agents.js";
import { SigfaError } from "src/lib/errors.js";

const HEADER = "email,firstName,lastName,role,agencyCode,languages,phone";

function build(rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("API-009: CSV agents — format global", () => {
  it("en-tête sans colonne obligatoire → INVALID_CSV_FORMAT", () => {
    try {
      parseAgentCsv("email,firstName,lastName\na@b.ci,A,B");
      expect.unreachable("attendu 422");
    } catch (e) {
      expect(e).toBeInstanceOf(SigfaError);
      expect((e as SigfaError).code).toBe("INVALID_CSV_FORMAT");
    }
  });

  it("> 500 lignes → IMPORT_TOO_LARGE avec details", () => {
    const rows = Array.from(
      { length: MAX_IMPORT_LINES + 1 },
      (_, i) => `a${i}@b.ci,A,B,AGENT,,FR,`
    );
    try {
      parseAgentCsv(build(rows));
      expect.unreachable("attendu 422");
    } catch (e) {
      expect((e as SigfaError).code).toBe("IMPORT_TOO_LARGE");
      expect((e as SigfaError).details).toMatchObject({ maxLines: 500 });
    }
  });

  it("exactement 500 lignes → OK (pas d'erreur)", () => {
    const rows = Array.from(
      { length: MAX_IMPORT_LINES },
      (_, i) => `a${i}@b.ci,A,B,AGENT,,FR,`
    );
    const result = parseAgentCsv(build(rows));
    expect(result.rows).toHaveLength(500);
    expect(result.errors).toHaveLength(0);
  });
});

describe("API-009: CSV agents — validation par ligne", () => {
  it("rôle invalide → erreur INVALID_ROLE ligne précise", () => {
    const result = parseAgentCsv(build(["a@b.ci,A,B,SUPERVISOR,,FR,"]));
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toEqual([
      expect.objectContaining({ line: 2, field: "role", code: "INVALID_ROLE" }),
    ]);
  });

  it("email invalide → erreur INVALID_EMAIL", () => {
    const result = parseAgentCsv(build(["not-an-email,A,B,AGENT,,FR,"]));
    expect(result.errors[0]).toMatchObject({ field: "email", code: "INVALID_EMAIL" });
  });

  it("téléphone non-E.164 → INVALID_PHONE_FORMAT", () => {
    const result = parseAgentCsv(build(["a@b.ci,A,B,AGENT,,FR,0700000001"]));
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]).toMatchObject({
      line: 2,
      field: "phone",
      code: "INVALID_PHONE_FORMAT",
    });
  });

  it("téléphone E.164 valide → ligne acceptée", () => {
    const result = parseAgentCsv(build(["a@b.ci,A,B,AGENT,,FR,+2250700000001"]));
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]?.phone).toBe("+2250700000001");
  });

  it("langues entre guillemets → parsées, défaut FR si vide", () => {
    const result = parseAgentCsv(
      build([`a@b.ci,A,B,AGENT,AG001,"FR,DIOULA",`, "c@d.ci,C,D,AGENT,,,"])
    );
    expect(result.rows[0]?.languages).toEqual(["FR", "DIOULA"]);
    expect(result.rows[0]?.agencyCode).toBe("AG001");
    expect(result.rows[1]?.languages).toEqual(["FR"]);
  });

  it("lignes valides et invalides coexistent (valides conservées)", () => {
    const result = parseAgentCsv(
      build(["ok@b.ci,A,B,AGENT,,FR,", "bad@b.ci,A,B,SUPERVISOR,,FR,"])
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.email).toBe("ok@b.ci");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.line).toBe(3);
  });
});
