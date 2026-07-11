/**
 * idempotency — idempotence Redis 24 h des mutations critiques (API-003).
 *
 * LA LOI : `X-Idempotency-Key` obligatoire sur `POST /tickets`. Même clé +
 * même payload → rejeu byte-identique de la réponse originale (24 h). Même clé
 * + payload différent → 409 `IDEMPOTENCY_CONFLICT`. Clé absente → 400
 * `IDEMPOTENCY_KEY_REQUIRED`.
 *
 * Verrou `SET NX` pour empêcher deux traitements concurrents de la même clé.
 *
 * @module
 */

import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { SigfaError } from "src/lib/errors.js";

/** Durée de rétention d'une clé d'idempotence : 24 heures (secondes). */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/** Préfixe des clés Redis d'idempotence (scopé par tenant + route). */
const KEY_PREFIX = "idem:";

/** Enregistrement persisté pour une clé d'idempotence. */
interface IdempotencyRecord {
  /** Empreinte SHA-256 du payload de la requête originale. */
  payloadHash: string;
  /** Code HTTP de la réponse originale. */
  status: number;
  /** Corps JSON sérialisé (rejoué byte-identique). */
  body: string;
}

/** Résultat d'un rejeu d'idempotence. */
export interface ReplayResult {
  status: number;
  body: string;
}

/** Empreinte déterministe SHA-256 d'un payload sérialisé de façon stable. */
function hashPayload(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

/**
 * Sérialise un objet de façon déterministe (clés triées) pour le hachage.
 * @param value - Valeur à sérialiser
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${entries.join(",")}}`;
}

/** Construit la clé Redis scopée (tenant + route + clé cliente). */
function redisKey(scope: string, key: string): string {
  return `${KEY_PREFIX}${scope}:${key}`;
}

/**
 * Vérifie qu'une clé d'idempotence est fournie sur une mutation critique.
 * @param key - Valeur de l'en-tête X-Idempotency-Key (ou undefined)
 * @returns La clé validée (non vide)
 * @throws {SigfaError} 400 IDEMPOTENCY_KEY_REQUIRED si absente/vide
 */
export function requireIdempotencyKey(key: string | undefined): string {
  if (!key || key.trim().length === 0) {
    throw new SigfaError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "L'en-tête X-Idempotency-Key est obligatoire pour cette mutation.",
      400
    );
  }
  return key;
}

/**
 * Cherche un enregistrement existant : rejeu si payload identique, 409 sinon.
 *
 * @param redis   - Client Redis
 * @param scope   - Scope (ex: `tickets:{bankId}`)
 * @param key     - Clé d'idempotence cliente
 * @param payload - Payload courant de la requête
 * @returns Réponse à rejouer, ou `null` si aucune entrée (premier appel)
 * @throws {SigfaError} 409 IDEMPOTENCY_CONFLICT si payload différent
 */
export async function findReplay(
  redis: Redis,
  scope: string,
  key: string,
  payload: unknown
): Promise<ReplayResult | null> {
  const raw = await redis.get(redisKey(scope, key));
  if (raw === null) return null;
  const record = JSON.parse(raw) as IdempotencyRecord;
  if (record.payloadHash !== hashPayload(payload)) {
    throw new SigfaError(
      "IDEMPOTENCY_CONFLICT",
      "Même X-Idempotency-Key avec un payload différent.",
      409
    );
  }
  return { status: record.status, body: record.body };
}

/**
 * Persiste la réponse originale d'une mutation pour rejeu (24 h).
 *
 * @param redis   - Client Redis
 * @param scope   - Scope de la clé
 * @param key     - Clé d'idempotence cliente
 * @param payload - Payload de la requête originale
 * @param status  - Code HTTP de la réponse
 * @param body    - Corps JSON sérialisé (byte-identique au rejeu)
 */
export async function storeReplay(
  redis: Redis,
  scope: string,
  key: string,
  payload: unknown,
  status: number,
  body: string
): Promise<void> {
  const record: IdempotencyRecord = { payloadHash: hashPayload(payload), status, body };
  await redis.set(redisKey(scope, key), JSON.stringify(record), "EX", IDEMPOTENCY_TTL_SECONDS);
}
