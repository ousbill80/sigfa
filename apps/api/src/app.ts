/**
 * Application Hono SIGFA API — bootstrap principal.
 *
 * Expose /api/v1 avec :
 * - Gestion d'erreur globale au format LA LOI
 * - Logs Pino structurés (console.log interdit)
 * - Routes /auth/*
 *
 * @module
 */

import { Hono } from "hono";
import type { Redis } from "ioredis";
import type { Client } from "pg";
import { buildError } from "src/lib/errors.js";
import { logger } from "src/lib/logger.js";
import { createAuthRouter } from "src/routes/auth.js";

/** Variables de contexte globales de l'app */
interface AppEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
  };
}

/**
 * Options de création de l'application.
 */
export interface AppOptions {
  /** Client PostgreSQL (connexion applicative) */
  db: Client;
  /** Client Redis */
  redis: Redis;
  /** Secret JWT (Uint8Array) */
  jwtSecret: Uint8Array;
}

/**
 * Crée et configure l'application Hono SIGFA.
 * Injecte les dépendances dans le contexte.
 *
 * @param options - Dépendances de l'application
 * @returns Application Hono configurée
 */
export function createApp(options: AppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Injection des dépendances dans chaque requête
  app.use("*", async (c, next) => {
    c.set("db", options.db);
    c.set("redis", options.redis);
    c.set("jwtSecret", options.jwtSecret);
    await next();
  });

  // Logging structuré Pino de chaque requête
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    logger.info(
      { method: c.req.method, path: c.req.path, status: c.res.status, ms },
      "request"
    );
  });

  // Routes auth sous /api/v1/auth
  const authRouter = createAuthRouter();
  app.route("/api/v1/auth", authRouter);

  // Handler 404 pour les routes inconnues
  app.notFound((c) =>
    c.json(buildError("NOT_FOUND", "Route introuvable."), 404)
  );

  // Handler d'erreur global — format LA LOI
  app.onError((err, c) => {
    logger.error({ err }, "Erreur non gérée");
    return c.json(
      buildError("INTERNAL_SERVER_ERROR", "Erreur interne du serveur."),
      500
    );
  });

  return app;
}
