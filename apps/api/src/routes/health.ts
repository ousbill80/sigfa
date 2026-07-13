/**
 * Route de santé — API-011 (reporting.yaml `GET /health`).
 *
 * Public, sans authentification ni tenant. Vérifie les dépendances critiques
 * (PostgreSQL, Redis) en parallèle avec un budget de temps serré (<100 ms) puis
 * retourne :
 *  - `200` `{ status: 'UP', version, timestamp, uptime, checks: { postgres, redis } }`
 *    quand toutes les dépendances répondent ;
 *  - `503` `ErrorResponse` `SERVICE_UNAVAILABLE` (`details.status: 'DOWN'` + checks
 *    précis) dès qu'une dépendance est indisponible (conteneur coupé, connexion morte).
 *
 * Le corps 200 respecte `HealthResponse` de LA LOI (champs requis `status`,
 * `version`, `timestamp`) et l'enrichit des champs `uptime`/`checks` demandés par
 * la story (schéma sans `additionalProperties: false` → compatible Schemathesis).
 *
 * @module
 */

import { Hono } from "hono";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { buildError } from "src/lib/errors.js";
import type { QueueHealth } from "src/services/notification-jobs.js";

/** Variables de contexte Hono injectées par app.ts. */
interface HealthEnv {
  Variables: { db: Client; redis: Redis };
}

/** Budget maximal d'un check de dépendance avant de le déclarer down (ms). */
const CHECK_TIMEOUT_MS = 80;

/** Horodatage de démarrage du process (pour l'uptime en secondes). */
const START_TIME = Date.now();

/** État d'une dépendance : `up` ou `down`. */
type DepState = "up" | "down";

/**
 * Fournisseur optionnel de la santé des files BullMQ de notification (NOTIF-001).
 * Injecté par `app.ts` quand l'infrastructure de notification est démarrée ;
 * absent, le check `queues` n'apparaît pas (extension non-breaking, CONTRACT-013).
 */
export type QueueHealthProvider = () => Promise<QueueHealth>;

/**
 * Crée le routeur de santé (monté sous /api/v1).
 *
 * Le corps 200 respecte `HealthResponse` (LA LOI, champs requis `status`,
 * `version`, `timestamp`) et l'enrichit de `uptime` + `checks`. Quand un
 * `queueHealth` est injecté, `checks.queues` expose la santé des files BullMQ
 * (waiting/active/failed/... + DLQ) — extension non-breaking prête pour
 * CONTRACT-013. Un job bloqué en DLQ passe la réponse en 503 (dépendance dégradée).
 *
 * @param version     - Version applicative exposée (défaut `0.0.0`).
 * @param queueHealth - Fournisseur optionnel de la santé des files (NOTIF-001).
 * @returns Routeur Hono de `/health`
 */
export function createHealthRouter(
  version = "0.0.0",
  queueHealth?: QueueHealthProvider
): Hono<HealthEnv> {
  const router = new Hono<HealthEnv>();
  router.get("/health", async (c) => {
    const [postgres, redis, queues] = await Promise.all([
      checkPostgres(c.get("db")),
      checkRedis(c.get("redis")),
      checkQueues(queueHealth),
    ]);
    const checks = {
      postgres,
      redis,
      ...(queues ? { queues } : {}),
    };
    const queuesHealthy = queues === undefined || queues.healthy;
    const healthy = postgres === "up" && redis === "up" && queuesHealthy;
    const timestamp = new Date().toISOString();
    if (!healthy) {
      return c.json(
        buildError("SERVICE_UNAVAILABLE", "Le service est temporairement indisponible.", {
          status: "DOWN",
          checks,
        }),
        503
      );
    }
    return c.json(
      {
        status: "UP",
        version,
        timestamp,
        uptime: Math.floor((Date.now() - START_TIME) / 1000),
        checks,
      },
      200
    );
  });
  return router;
}

/**
 * Interroge la santé des files de notification (si un fournisseur est injecté).
 * Ne propage jamais l'erreur : une panne de sonde compte comme file dégradée.
 *
 * @param provider - Fournisseur optionnel de la santé des files
 * @returns Santé des files, ou `undefined` si non câblé
 */
async function checkQueues(
  provider?: QueueHealthProvider
): Promise<QueueHealth | undefined> {
  if (!provider) return undefined;
  try {
    return await provider();
  } catch {
    // Sonde en échec → file marquée dégradée (healthy:false) sans crash du /health.
    return { channels: [], dlq: { name: "notifications-dlq", counts: { waiting: 0, active: 0, failed: 0, completed: 0, delayed: 1 } }, healthy: false };
  }
}

/**
 * Vérifie PostgreSQL par un `SELECT 1` borné en temps.
 *
 * @param db - Client PG
 * @returns `up` si la requête répond, `down` sinon (timeout, connexion morte)
 */
async function checkPostgres(db: Client): Promise<DepState> {
  return withTimeout(async () => {
    await db.query("SELECT 1");
  });
}

/**
 * Vérifie Redis par un `PING` borné en temps.
 *
 * @param redis - Client Redis
 * @returns `up` si `PONG`, `down` sinon (timeout, connexion morte)
 */
async function checkRedis(redis: Redis): Promise<DepState> {
  return withTimeout(async () => {
    const pong = await redis.ping();
    if (pong !== "PONG") throw new Error("unexpected ping reply");
  });
}

/**
 * Exécute une sonde avec un budget de temps : `down` si elle échoue ou dépasse
 * `CHECK_TIMEOUT_MS`. Ne propage jamais l'erreur (le health-check ne crashe pas).
 *
 * @param probe - Sonde asynchrone à exécuter
 * @returns `up` si la sonde réussit dans le budget, `down` sinon
 */
async function withTimeout(probe: () => Promise<void>): Promise<DepState> {
  const timeout = new Promise<DepState>((resolve) =>
    setTimeout(() => resolve("down"), CHECK_TIMEOUT_MS)
  );
  const run: Promise<DepState> = probe().then(
    (): DepState => "up",
    (): DepState => "down"
  );
  return Promise.race([run, timeout]);
}
