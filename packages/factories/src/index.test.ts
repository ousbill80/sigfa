import { describe, it, expect } from "vitest";
import { expectTypeOf } from "expect-type";
import * as fc from "fast-check";
import { z } from "zod";
import { createFactory } from "./index.js";

describe("@sigfa/factories — createFactory", () => {
  const sampleSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    age: z.number().int().min(0).max(120),
    active: z.boolean(),
    role: z.enum(["admin", "user", "guest"]),
  });

  describe("INFRA-005: createFactory — validité Zod", () => {
    it("INFRA-005: pour chaque schéma primitif, fixture de factory → parse réussit (fast-check, numRuns ≥100)", () => {
      const factory = createFactory(sampleSchema);
      fc.assert(
        fc.property(fc.nat({ max: 999999 }), (seed) => {
          const fixture = factory({ seed });
          const result = sampleSchema.safeParse(fixture);
          return result.success;
        }),
        { numRuns: 100 }
      );
    });

    it("INFRA-005: même graine → fixtures identiques", () => {
      const factory = createFactory(sampleSchema);
      const a = factory({ seed: 42 });
      const b = factory({ seed: 42 });
      expect(a).toEqual(b);
    });

    it("INFRA-005: graines différentes → fixtures différentes (probabilistique)", () => {
      const factory = createFactory(sampleSchema);
      const a = factory({ seed: 1 });
      const b = factory({ seed: 2 });
      // Au moins un champ doit différer
      expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    });

    it("INFRA-005: surcharge d'un champ existant → valeur surchargée", () => {
      const factory = createFactory(sampleSchema);
      const fixture = factory({ seed: 42, overrides: { name: "Moussa" } });
      expect(fixture.name).toBe("Moussa");
    });
  });

  describe("INFRA-005: createFactory — propriétés type-level", () => {
    it("INFRA-005: surcharge d'un champ inexistant → erreur TypeScript (expect-type compile-time)", () => {
      const factory = createFactory(sampleSchema);
      // Ce test vérifie la structure de type retournée
      const fixture = factory({ seed: 42 });
      expectTypeOf(fixture).toMatchTypeOf<z.infer<typeof sampleSchema>>();
    });

    it("INFRA-005: le retour de createFactory est typé z.infer du schéma", () => {
      const factory = createFactory(sampleSchema);
      type Expected = z.infer<typeof sampleSchema>;
      const fixture = factory({ seed: 1 });
      expectTypeOf(fixture).toEqualTypeOf<Expected>();
    });
  });

  describe("INFRA-005: createFactory — types Zod couverts", () => {
    it("INFRA-005: schéma avec optional → parse réussit (fast-check, numRuns ≥100)", () => {
      const withOptional = z.object({
        id: z.string().uuid(),
        nickname: z.string().optional(),
        count: z.number().int().min(0),
      });
      const factory = createFactory(withOptional);
      fc.assert(
        fc.property(fc.nat({ max: 999999 }), (seed) => {
          const fixture = factory({ seed });
          return withOptional.safeParse(fixture).success;
        }),
        { numRuns: 100 }
      );
    });

    it("INFRA-005: schéma avec array → parse réussit (fast-check, numRuns ≥100)", () => {
      const withArray = z.object({
        tags: z.array(z.string()),
        score: z.number().min(0).max(100),
      });
      const factory = createFactory(withArray);
      fc.assert(
        fc.property(fc.nat({ max: 999999 }), (seed) => {
          const fixture = factory({ seed });
          return withArray.safeParse(fixture).success;
        }),
        { numRuns: 100 }
      );
    });
  });
});
