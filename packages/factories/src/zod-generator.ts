import { z } from "zod";

/** Alphabet pour les chaînes générées */
const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Génère un octet hex (2 chars) à partir du PRNG.
 * @param rng - Fonction PRNG
 */
function hexByte(rng: () => number): string {
  return Math.floor(rng() * 256).toString(16).padStart(2, "0");
}

/**
 * Génère un UUID v4 conforme (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx).
 * y est dans {8,9,a,b} pour respecter la variante RFC 4122.
 * @param rng - Fonction de nombre aléatoire dans [0,1)
 */
function generateUuid(rng: () => number): string {
  // time_low: 8 hex chars = 4 octets
  const p1 = hexByte(rng) + hexByte(rng) + hexByte(rng) + hexByte(rng);
  // time_mid: 4 hex chars = 2 octets
  const p2 = hexByte(rng) + hexByte(rng);
  // time_hi_and_version: 4 hex chars, version=4
  const p3 = "4" + Math.floor(rng() * 16).toString(16) + hexByte(rng);
  // clock_seq: 4 hex chars, variante = 8/9/a/b
  const varBit = ["8", "9", "a", "b"][Math.floor(rng() * 4)] ?? "8";
  const p4 = varBit + Math.floor(rng() * 16).toString(16) + hexByte(rng);
  // node: 12 hex chars = 6 octets
  const p5 =
    hexByte(rng) + hexByte(rng) + hexByte(rng) +
    hexByte(rng) + hexByte(rng) + hexByte(rng);
  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

/**
 * Génère une chaîne aléatoire de longueur variable.
 * @param rng - Fonction de nombre aléatoire dans [0,1)
 * @param minLen - Longueur minimale
 * @param maxLen - Longueur maximale
 */
function generateString(rng: () => number, minLen = 4, maxLen = 12): string {
  const len = minLen + Math.floor(rng() * (maxLen - minLen + 1));
  return Array.from({ length: len }, () => CHARS[Math.floor(rng() * CHARS.length)]).join("");
}

/**
 * Génère une valeur valide pour un schéma Zod donné.
 * Couvre : string/uuid, number/int, boolean, enum, optional, array, object.
 * @param schema - Schéma Zod source
 * @param rng - Fonction PRNG
 */
export function generateForSchema<T>(schema: z.ZodTypeAny, rng: () => number): T {
  return generateValue(schema, rng) as T;
}

/**
 * Génère un tableau de valeurs pour un schéma ZodArray (0–3 éléments).
 * @param schema - Schéma ZodArray source
 * @param rng - Fonction PRNG
 */
function generateArrayValue(schema: z.ZodArray<z.ZodTypeAny>, rng: () => number): unknown[] {
  const len = Math.floor(rng() * 4); // 0-3 éléments
  return Array.from({ length: len }, () =>
    generateValue(schema._def.type as z.ZodTypeAny, rng)
  );
}

/**
 * Génère un objet pour un schéma ZodObject en parcourant toutes ses propriétés.
 * @param schema - Schéma ZodObject source
 * @param rng - Fonction PRNG
 */
function generateObjectValue(
  schema: z.ZodObject<z.ZodRawShape>,
  rng: () => number
): Record<string, unknown> {
  const shape = schema._def.shape() as Record<string, z.ZodTypeAny>;
  const result: Record<string, unknown> = {};
  for (const [key, fieldSchema] of Object.entries(shape)) {
    result[key] = generateValue(fieldSchema, rng);
  }
  return result;
}

/** Génère récursivement une valeur pour un schéma Zod */
function generateValue(schema: z.ZodTypeAny, rng: () => number): unknown {
  if (schema instanceof z.ZodString) return generateStringValue(schema, rng);
  if (schema instanceof z.ZodNumber) return generateNumberValue(schema, rng);
  if (schema instanceof z.ZodBoolean) return rng() >= 0.5;
  if (schema instanceof z.ZodEnum) {
    const values = schema._def.values as string[];
    return values[Math.floor(rng() * values.length)];
  }
  if (schema instanceof z.ZodOptional) {
    return rng() > 0.3 ? generateValue(schema._def.innerType as z.ZodTypeAny, rng) : undefined;
  }
  if (schema instanceof z.ZodArray) return generateArrayValue(schema, rng);
  if (schema instanceof z.ZodObject) return generateObjectValue(schema, rng);
  if (schema instanceof z.ZodDefault) {
    return generateValue(schema._def.innerType as z.ZodTypeAny, rng);
  }
  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) return null;
  return null;
}

/** Génère une valeur string respectant les checks (uuid, min, max) */
function generateStringValue(schema: z.ZodString, rng: () => number): string {
  const checks = schema._def.checks as Array<{ kind: string }>;
  const isUuid = checks.some((c) => c.kind === "uuid");
  if (isUuid) {
    return generateUuid(rng);
  }
  const minCheck = checks.find((c): c is { kind: "min"; value: number } => c.kind === "min");
  const maxCheck = checks.find((c): c is { kind: "max"; value: number } => c.kind === "max");
  const minLen = minCheck ? Math.max(1, minCheck.value) : 4;
  const maxLen = maxCheck ? Math.min(64, maxCheck.value) : 12;
  return generateString(rng, minLen, maxLen);
}

/** Génère une valeur number respectant les checks (int, min, max) */
function generateNumberValue(schema: z.ZodNumber, rng: () => number): number {
  const checks = schema._def.checks as Array<{ kind: string }>;
  const isInt = checks.some((c) => c.kind === "int");
  const minCheck = checks.find((c): c is { kind: "min"; value: number; inclusive: boolean } =>
    c.kind === "min"
  );
  const maxCheck = checks.find((c): c is { kind: "max"; value: number; inclusive: boolean } =>
    c.kind === "max"
  );
  const lo = minCheck ? minCheck.value : 0;
  const hi = maxCheck ? maxCheck.value : lo + 100;
  const range = hi - lo;
  const raw = lo + rng() * range;
  return isInt ? Math.floor(raw) : Math.round(raw * 100) / 100;
}
