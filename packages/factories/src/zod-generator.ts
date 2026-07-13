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
function generateArrayValue(schema: z.ZodArray, rng: () => number): unknown[] {
  const len = Math.floor(rng() * 4); // 0-3 éléments
  // zod v4 : l'élément est exposé via `_def.element` (v3 utilisait `_def.type`).
  const element = schema._def.element as z.ZodTypeAny;
  return Array.from({ length: len }, () => generateValue(element, rng));
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
  // zod v4 : la forme est un objet simple (`_def.shape`) ; v3 exposait une
  // fonction `_def.shape()`. On lit ici directement l'objet des propriétés.
  const shape = schema._def.shape as Record<string, z.ZodTypeAny>;
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
    // zod v4 : les valeurs sont exposées via `_def.entries` (map libellé→valeur) ;
    // v3 exposait un tableau `_def.values`.
    const values = Object.values(schema._def.entries) as string[];
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

/**
 * Métadonnée d'un check zod v4. Les checks sont exposés via
 * `schema._zod.def.checks[]`, chaque check portant sa définition dans
 * `check._zod.def`. Le champ `check` remplace le `kind` de la v3.
 */
interface ZodV4CheckDef {
  /** Type de check (ex. "string_format", "min_length", "greater_than"). */
  check?: string;
  /** Format string (ex. "uuid", "email") quand `check === "string_format"`. */
  format?: string;
  /** Longueur minimale (`min_length`). */
  minimum?: number;
  /** Longueur maximale (`max_length`). */
  maximum?: number;
  /** Borne numérique (`greater_than` / `less_than`). */
  value?: number;
}

/**
 * Extrait les définitions de checks d'un schéma zod v4.
 * @param schema - Schéma zod (string ou number)
 */
function readChecks(schema: z.ZodTypeAny): ZodV4CheckDef[] {
  const zodInternal = (schema as { _zod?: { def?: { checks?: unknown[] } } })._zod;
  const rawChecks = zodInternal?.def?.checks ?? [];
  return rawChecks.map(
    (c) => ((c as { _zod?: { def?: ZodV4CheckDef } })._zod?.def ?? {}) as ZodV4CheckDef
  );
}

/** Génère une valeur string respectant les checks (uuid, min, max) */
function generateStringValue(schema: z.ZodString, rng: () => number): string {
  const checks = readChecks(schema);
  const isUuid = checks.some((c) => c.check === "string_format" && c.format === "uuid");
  if (isUuid) {
    return generateUuid(rng);
  }
  const minCheck = checks.find((c) => c.check === "min_length");
  const maxCheck = checks.find((c) => c.check === "max_length");
  const minLen = minCheck?.minimum !== undefined ? Math.max(1, minCheck.minimum) : 4;
  const maxLen = maxCheck?.maximum !== undefined ? Math.min(64, maxCheck.maximum) : 12;
  return generateString(rng, minLen, maxLen);
}

/** Génère une valeur number respectant les checks (int, min, max) */
function generateNumberValue(schema: z.ZodNumber, rng: () => number): number {
  const checks = readChecks(schema);
  // zod v4 : `int()` devient un check `number_format` (format entier safeint/int32…).
  const isInt = checks.some((c) => c.check === "number_format");
  const minCheck = checks.find((c) => c.check === "greater_than");
  const maxCheck = checks.find((c) => c.check === "less_than");
  const lo = minCheck?.value !== undefined ? minCheck.value : 0;
  const hi = maxCheck?.value !== undefined ? maxCheck.value : lo + 100;
  const range = hi - lo;
  const raw = lo + rng() * range;
  return isInt ? Math.floor(raw) : Math.round(raw * 100) / 100;
}
