/**
 * Point d'entrée SIGFA API — API-001
 *
 * Fail-fast : JWT_SECRET manquant/court → erreur au démarrage.
 * Logs Pino structurés — console.log est interdit.
 *
 * @module
 */

/* v8 ignore start */
import { serve } from "@hono/node-server";
import { Redis } from "ioredis";
import pg from "pg";
import { createApp } from "src/app.js";
import { getJwtSecret, getRedisUrl, getDatabaseUrl } from "src/lib/env.js";
import { logger } from "src/lib/logger.js";

/**
 * Crée les clients PG et Redis, construit l'app Hono.
 * Lève une erreur si JWT_SECRET absent ou trop court.
 *
 * @throws {Error} Si JWT_SECRET manquant ou trop court
 */
export async function bootstrap(): Promise<{
  app: ReturnType<typeof createApp>;
  db: pg.Client;
  redis: Redis;
}> {
  const jwtSecret = new TextEncoder().encode(getJwtSecret());
  const redisUrl = getRedisUrl();
  const dbUrl = getDatabaseUrl();

  const redis = new Redis(redisUrl, { lazyConnect: true });
  await redis.connect();

  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();

  const app = createApp({ db, redis, jwtSecret });
  return { app, db, redis };
}

/**
 * Démarre le serveur HTTP sur le port configuré.
 */
export async function startServer(): Promise<void> {
  const { app } = await bootstrap();
  const port = Number(process.env["API_PORT"] ?? "3001");

  serve({ fetch: app.fetch, port }, () => {
    logger.info({ port }, "SIGFA API démarrée");
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  startServer().catch((err: unknown) => {
    logger.error({ err }, "Échec du démarrage");
    process.exit(1);
  });
}
/* v8 ignore stop */
