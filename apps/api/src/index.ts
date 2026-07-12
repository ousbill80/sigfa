/**
 * Point d'entrée SIGFA API — API-001 / RT-001a.
 *
 * Fail-fast : JWT_SECRET manquant/court → erreur au démarrage.
 * Logs Pino structurés — console.log est interdit.
 *
 * Bascule temps réel (RT-001a, D2/D6) : `REALTIME_MODE ∈ {off, real}`, défaut
 * `off`. `off` → `createNoopBus`, aucun socket, aucun scheduler. `real` →
 * `serve()` capture le httpServer → `createSocketServer` → `createSocketBus` →
 * `startAlertScheduler` ; SIGTERM/SIGINT → graceful shutdown (zéro orphelin).
 *
 * La logique testable (mode, ordre, shutdown, bus différé) vit dans
 * `services/realtime-bootstrap.ts` ; ce fichier n'assemble que le câblage prod
 * (bloc exclu de la couverture v8).
 *
 * @module
 */

/* v8 ignore start */
import { serve } from "@hono/node-server";
import type http from "http";
import { Redis } from "ioredis";
import pg from "pg";
import { createApp } from "src/app.js";
import { getJwtSecret, getRedisUrl, getDatabaseUrl } from "src/lib/env.js";
import { logger } from "src/lib/logger.js";
import { createSocketServer } from "src/services/socket-server.js";
import { createSocketBus } from "src/services/socket-bus.js";
import { startAlertScheduler } from "src/services/alert-scheduler.js";
import {
  resolveRealtimeMode,
  createDeferredBus,
  buildRealtime,
  shutdownRealtime,
  type DeferredBus,
  type RealtimeDeps,
  type RealtimeHandle,
} from "src/services/realtime-bootstrap.js";

/**
 * Crée les clients PG et Redis, construit l'app Hono avec un bus différé.
 * Lève une erreur si JWT_SECRET absent ou trop court.
 *
 * @throws {Error} Si JWT_SECRET manquant ou trop court
 */
export async function bootstrap(): Promise<{
  app: ReturnType<typeof createApp>;
  db: pg.Client;
  redis: Redis;
  jwtSecret: Uint8Array;
  bus: DeferredBus;
}> {
  const jwtSecret = new TextEncoder().encode(getJwtSecret());
  const redisUrl = getRedisUrl();
  const dbUrl = getDatabaseUrl();

  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null });
  await redis.connect();

  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();

  // Bus différé : noop validant tant que le socket bus n'est pas branché (mode
  // `real`). En mode `off`, il reste noop pour toute la durée de vie.
  const bus = createDeferredBus();
  const app = createApp({ db, redis, jwtSecret, bus });
  return { app, db, redis, jwtSecret, bus };
}

/** Déduit host/port BullMQ depuis l'URL Redis. */
function connectionFromRedisUrl(redisUrl: string): { host: string; port: number } {
  const u = new URL(redisUrl);
  return { host: u.hostname, port: Number(u.port || "6379") };
}

/**
 * Démarre le serveur HTTP sur le port configuré, et — en mode `real` — le socket
 * temps réel + le scheduler d'alertes, avec graceful shutdown sur SIGTERM/SIGINT.
 */
export async function startServer(): Promise<void> {
  const { app, db, redis, jwtSecret, bus } = await bootstrap();
  const port = Number(process.env["API_PORT"] ?? "3001");
  const mode = resolveRealtimeMode(process.env["REALTIME_MODE"]);

  const server = serve({ fetch: app.fetch, port }, () => {
    logger.info({ port, realtimeMode: mode }, "SIGFA API démarrée");
  });

  if (mode !== "real") return;

  const deps: RealtimeDeps = {
    httpServer: server as unknown as http.Server,
    db,
    redis,
    connection: connectionFromRedisUrl(getRedisUrl()),
    jwtSecret,
    createSocketServer,
    createSocketBus,
    startAlertScheduler,
  };
  const handle: RealtimeHandle = await buildRealtime(deps, bus);
  logger.info("SIGFA temps réel actif (socket + scheduler)");

  const onSignal = (signal: string): void => {
    logger.info({ signal }, "SIGFA arrêt gracieux en cours");
    void shutdownRealtime(handle, deps).then(() => {
      logger.info("SIGFA arrêt gracieux terminé");
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  startServer().catch((err: unknown) => {
    logger.error({ err }, "Échec du démarrage");
    process.exit(1);
  });
}
/* v8 ignore stop */
