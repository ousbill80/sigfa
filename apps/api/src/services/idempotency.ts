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

/** Préfixe des verrous « in-flight » (traitement en cours d'une clé). */
const LOCK_PREFIX = "idem-lock:";

/** TTL du verrou in-flight (ms) : borne le blocage si un worker meurt en cours. */
const LOCK_TTL_MS = 10_000;

/** Fenêtre d'attente courte qu'un traitement concurrent publie sa réponse (ms). */
const WAIT_TOTAL_MS = 5_000;

/** Intervalle de polling de la réponse concurrente (ms). */
const WAIT_STEP_MS = 50;

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

/** Construit la clé du verrou in-flight scopé. */
function lockKey(scope: string, key: string): string {
  return `${LOCK_PREFIX}${scope}:${key}`;
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
  // Le résultat est mémorisé : libérer le verrou in-flight pour débloquer les
  // requêtes concurrentes en attente (elles liront la réponse mémorisée).
  await redis.del(lockKey(scope, key));
}

/** Issue de l'acquisition atomique d'idempotence. */
export type IdempotencyOutcome =
  | { kind: "replay"; result: ReplayResult }
  | { kind: "proceed" };

/**
 * Point d'entrée ATOMIQUE de l'idempotence (Boucle 3 F3).
 *
 * Empêche deux requêtes concurrentes de MÊME clé de créer deux ressources :
 *   1. Si une réponse est déjà mémorisée (payload identique) → rejeu.
 *      (payload différent → 409 IDEMPOTENCY_CONFLICT via `findReplay`.)
 *   2. Sinon, on tente de poser un verrou `SET NX PX` (marqueur in-flight) :
 *      - verrou OBTENU → `proceed` : l'appelant traite puis appelle `storeReplay`
 *        (qui libère le verrou).
 *      - verrou DÉJÀ pris → un traitement concurrent est en cours : on attend
 *        brièvement sa réponse mémorisée (rejeu) ; à défaut → 409 IN_PROGRESS.
 *
 * @param redis   - Client Redis
 * @param scope   - Scope (ex. `tickets:{bankId}`)
 * @param key     - Clé d'idempotence cliente
 * @param payload - Payload courant de la requête
 * @returns `replay` (réponse à rejouer) ou `proceed` (traiter puis storeReplay)
 * @throws {SigfaError} 409 IDEMPOTENCY_CONFLICT (payload différent) ou 409
 *   IDEMPOTENCY_IN_PROGRESS (traitement concurrent non résolu à temps)
 */
export async function acquireIdempotency(
  redis: Redis,
  scope: string,
  key: string,
  payload: unknown
): Promise<IdempotencyOutcome> {
  const existing = await findReplay(redis, scope, key, payload);
  if (existing) return { kind: "replay", result: existing };

  // Verrou in-flight atomique : un SEUL gagnant traite la requête.
  const acquired = await redis.set(
    lockKey(scope, key),
    hashPayload(payload),
    "PX",
    LOCK_TTL_MS,
    "NX"
  );
  if (acquired !== null) return { kind: "proceed" };

  // Un traitement concurrent détient le verrou : attendre sa réponse mémorisée.
  const replay = await waitForReplay(redis, scope, key, payload);
  if (replay) return { kind: "replay", result: replay };

  throw new SigfaError(
    "IDEMPOTENCY_IN_PROGRESS",
    "Une requête concurrente avec la même clé d'idempotence est en cours de traitement.",
    409
  );
}

/**
 * Attend (polling court) qu'un traitement concurrent publie sa réponse mémorisée.
 * S'arrête dès qu'une réponse est disponible OU que le verrou in-flight disparaît.
 *
 * @param redis   - Client Redis
 * @param scope   - Scope de la clé
 * @param key     - Clé d'idempotence
 * @param payload - Payload courant (pour la garde de conflit)
 * @returns La réponse à rejouer, ou `null` si rien n'est publié à temps
 */
async function waitForReplay(
  redis: Redis,
  scope: string,
  key: string,
  payload: unknown
): Promise<ReplayResult | null> {
  const deadline = Date.now() + WAIT_TOTAL_MS;
  while (Date.now() < deadline) {
    await sleep(WAIT_STEP_MS);
    const replay = await findReplay(redis, scope, key, payload);
    if (replay) return replay;
    // Le verrou a disparu SANS réponse mémorisée (worker mort/échec) → abandon.
    const stillLocked = await redis.exists(lockKey(scope, key));
    if (stillLocked === 0) {
      const late = await findReplay(redis, scope, key, payload);
      return late;
    }
  }
  return null;
}

/**
 * Libère le verrou in-flight sans mémoriser de réponse (échec du traitement) :
 * une future requête de même clé pourra retenter. À appeler dans le `catch` du
 * traitement après une acquisition `proceed`.
 *
 * @param redis - Client Redis
 * @param scope - Scope de la clé
 * @param key   - Clé d'idempotence
 */
export async function releaseIdempotencyLock(
  redis: Redis,
  scope: string,
  key: string
): Promise<void> {
  await redis.del(lockKey(scope, key));
}

/** Pause asynchrone (polling d'idempotence). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
