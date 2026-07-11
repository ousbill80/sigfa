import { describe, it, expect } from "vitest";
import { expectTypeOf } from "expect-type";
import {
  uuidSchema,
  paginationMetaSchema,
  errorSchema,
  SCHEMAS_VERSION,
  type UuidSchema,
  type PaginationMetaSchema,
  type ErrorSchema,
} from "./index.js";

describe("@sigfa/schemas — version", () => {
  it("INFRA-008: SCHEMAS_VERSION est une chaîne semver", () => {
    expect(SCHEMAS_VERSION).toBe("0.0.0");
  });
});

describe("@sigfa/schemas — primitifs partagés", () => {
  // uuidSchema
  describe("uuidSchema", () => {
    it("INFRA-005: uuidSchema accepte un UUID v4 valide", () => {
      const valid = "550e8400-e29b-41d4-a716-446655440000";
      expect(() => uuidSchema.parse(valid)).not.toThrow();
    });

    it("INFRA-005: uuidSchema rejette une chaîne non-UUID", () => {
      expect(() => uuidSchema.parse("not-a-uuid")).toThrow();
    });

    it("INFRA-005: tous les types exportés proviennent de z.infer (UuidSchema)", () => {
      expectTypeOf<UuidSchema>().toEqualTypeOf<string>();
    });
  });

  // paginationMetaSchema
  describe("paginationMetaSchema", () => {
    it("INFRA-005: paginationMetaSchema accepte page ≥1, limit 1-100, total ≥0", () => {
      const valid = {
        data: [] as unknown[],
        meta: { page: 1, limit: 20, total: 0 },
      };
      expect(() => paginationMetaSchema.parse(valid)).not.toThrow();
    });

    it("INFRA-005: paginationMetaSchema — limit par défaut à 20", () => {
      const result = paginationMetaSchema.parse({
        data: [],
        meta: { page: 1, total: 0 },
      });
      expect(result.meta.limit).toBe(20);
    });

    it("INFRA-005: paginationMetaSchema rejette page < 1", () => {
      expect(() =>
        paginationMetaSchema.parse({ data: [], meta: { page: 0, limit: 10, total: 0 } })
      ).toThrow();
    });

    it("INFRA-005: paginationMetaSchema rejette limit > 100", () => {
      expect(() =>
        paginationMetaSchema.parse({ data: [], meta: { page: 1, limit: 101, total: 0 } })
      ).toThrow();
    });

    it("INFRA-005: paginationMetaSchema rejette total < 0", () => {
      expect(() =>
        paginationMetaSchema.parse({ data: [], meta: { page: 1, limit: 10, total: -1 } })
      ).toThrow();
    });

    it("INFRA-005: tous les types exportés proviennent de z.infer (PaginationMetaSchema)", () => {
      expectTypeOf<PaginationMetaSchema["meta"]["page"]>().toEqualTypeOf<number>();
    });
  });

  // errorSchema
  describe("errorSchema", () => {
    it("INFRA-005: errorSchema accepte un code conforme /^[A-Z][A-Z0-9_]*$/", () => {
      const valid = {
        error: { code: "NOT_FOUND", message: "Resource not found" },
      };
      expect(() => errorSchema.parse(valid)).not.toThrow();
    });

    it("INFRA-005: errorSchema rejette un code ne commençant pas par majuscule", () => {
      expect(() =>
        errorSchema.parse({ error: { code: "notFound", message: "err" } })
      ).toThrow();
    });

    it("INFRA-005: errorSchema rejette un message vide", () => {
      expect(() =>
        errorSchema.parse({ error: { code: "ERR", message: "" } })
      ).toThrow();
    });

    it("INFRA-005: errorSchema accepte details optionnel comme record", () => {
      const valid = {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input",
          details: { field: "email", reason: "invalid format" },
        },
      };
      expect(() => errorSchema.parse(valid)).not.toThrow();
    });

    it("INFRA-005: tous les types exportés proviennent de z.infer (ErrorSchema)", () => {
      expectTypeOf<ErrorSchema["error"]["code"]>().toEqualTypeOf<string>();
    });
  });
});
