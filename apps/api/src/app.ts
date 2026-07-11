/**
 * Application Hono SIGFA API — bootstrap principal.
 *
 * Expose /api/v1 avec :
 * - Gestion d'erreur globale au format LA LOI
 * - Logs Pino structurés (console.log interdit)
 * - Middleware tenant + RBAC (API-002)
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
import { createTicketRouter } from "src/routes/tickets.js";
import { tenantMiddleware, type TenantContext } from "src/middleware/tenant.js";
import { validateRouteMapping } from "src/middleware/rbac-route-map.js";
import { createNoopBus, type RealtimeBus } from "src/services/realtime.js";

// Valider le mapping route→rôle au démarrage du module
validateRouteMapping();

/** Variables de contexte globales de l'app */
interface AppEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
    bus: RealtimeBus;
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
  /** Bus temps réel injectable (défaut : no-op validant). API-003. */
  bus?: RealtimeBus;
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
  const bus = options.bus ?? createNoopBus();

  // Injection des dépendances dans chaque requête
  app.use("*", async (c, next) => {
    c.set("db", options.db);
    c.set("redis", options.redis);
    c.set("jwtSecret", options.jwtSecret);
    c.set("bus", bus);
    await next();
  });

  // Middleware tenant + RBAC (API-002) — vérifie JWT, rôle, et scope tenant
  app.use("/api/v1/*", tenantMiddleware as Parameters<typeof app.use>[1]);

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

  // Routes tickets (API-003) sous /api/v1 (chemins /tickets, /counters/…)
  const ticketRouter = createTicketRouter();
  app.route("/api/v1", ticketRouter);

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
