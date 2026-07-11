import { z } from "zod";
import { mulberry32 } from "./mulberry32.js";
import { generateForSchema } from "./zod-generator.js";

/** Options d'invocation de la factory */
export interface FactoryOptions<T> {
  /** Graine PRNG — même graine → même fixture */
  seed?: number;
  /** Surcharges typées — champ inexistant = erreur TypeScript */
  overrides?: Partial<T>;
}

/**
 * Crée une factory typée à partir d'un schéma Zod.
 * La fixture générée est valide au sens du schéma (parse réussit).
 * Utilise mulberry32 (PRNG maison) — zéro faker.
 *
 * @param schema - Schéma Zod source (ZodObject)
 * @returns Fonction factory(options?) → T
 */
export function createFactory<S extends z.ZodObject<z.ZodRawShape>>(
  schema: S
): (options?: FactoryOptions<z.infer<S>>) => z.infer<S> {
  return (options?: FactoryOptions<z.infer<S>>): z.infer<S> => {
    const seed = options?.seed ?? Math.floor(Math.random() * 999999);
    const rng = mulberry32(seed);
    const generated = generateForSchema<z.infer<S>>(schema, rng);
    const merged = options?.overrides
      ? { ...(generated as Record<string, unknown>), ...options.overrides }
      : generated;
    return schema.parse(merged);
  };
}
