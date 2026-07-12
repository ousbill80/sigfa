/**
 * Tests unitaires — helpers transverses des routeurs admin (API-008).
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  parseStrict,
  assertAgencyScope,
  requireBankId,
} from "src/lib/admin-helpers.js";
import { SigfaError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";

function tenant(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    requestId: "r",
    userId: "u",
    bankId: "11111111-1111-4111-a111-111111111111",
    role: "AGENCY_DIRECTOR",
    agencyIds: ["33333333-3333-4333-a333-333333333333"],
    ...overrides,
  };
}

describe("API-008: admin-helpers", () => {
  const schema = z
    .object({ name: z.string() })
    .strict();

  it("API-008: parseStrict accepte un corps conforme", () => {
    expect(parseStrict(schema, { name: "X" })).toEqual({ name: "X" });
  });

  it("API-008: parseStrict lève 422 UNPROCESSABLE_ENTITY sur champ inconnu", () => {
    try {
      parseStrict(schema, { name: "X", unknown: 1 });
      throw new Error("attendu: 422");
    } catch (err) {
      expect(err).toBeInstanceOf(SigfaError);
      expect((err as SigfaError).httpStatus).toBe(422);
      expect((err as SigfaError).code).toBe("UNPROCESSABLE_ENTITY");
    }
  });

  it("API-008: assertAgencyScope autorise BANK_ADMIN partout", () => {
    expect(() =>
      assertAgencyScope(tenant({ role: "BANK_ADMIN" }), "any-agency")
    ).not.toThrow();
  });

  it("API-008: assertAgencyScope 403 pour DIRECTOR hors de son agence", () => {
    try {
      assertAgencyScope(tenant(), "99999999-9999-4999-a999-999999999999");
      throw new Error("attendu: 403");
    } catch (err) {
      expect((err as SigfaError).httpStatus).toBe(403);
    }
  });

  it("API-008: requireBankId lève 403 si bankId null", () => {
    expect(() => requireBankId(tenant({ bankId: null }))).toThrow(SigfaError);
  });
});
