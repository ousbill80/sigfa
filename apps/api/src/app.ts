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
import { buildRouteRegistry } from "src/route-registry.js";
import { mountGlobalRateLimits } from "src/config/rate-limits.js";
import { tenantMiddleware, type TenantContext } from "src/middleware/tenant.js";
import { validateRouteMapping } from "src/middleware/rbac-route-map.js";
import { createNoopBus, type RealtimeBus } from "src/services/realtime.js";
import type { QueueHealthProvider } from "src/routes/health.js";

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
  /**
   * Fournisseur de santé des files BullMQ de notification (NOTIF-001).
   * Injecté par l'entrypoint serveur quand l'infra est démarrée → expose
   * `checks.queues` sur `GET /health` (extension non-breaking, CONTRACT-013).
   */
  queueHealth?: QueueHealthProvider;
  /**
   * Enfile le build d'un export sur l'infra BullMQ (REP-003). Injecté par
   * l'entrypoint serveur quand l'infra d'export est démarrée. Absent → le job
   * d'export reste `PENDING` (aucun échec de route).
   */
  exportEnqueue?: (jobId: string, bankId: string) => Promise<void>;
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

  // Rate-limits GLOBAUX (API-011) — montés AVANT l'auth : bornes IP indépendantes
  // par route sur /public/*, webhooks et /notifications/devices (429 + Retry-After).
  mountGlobalRateLimits(app as unknown as Hono<never>);

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

  // Enregistrement des routeurs depuis le REGISTRE DÉCLARATIF (route-registry.ts).
  // L'ordre, les chemins de base et les injections d'options y sont définis à
  // l'identique. AJOUTER UNE ROUTE = AJOUTER UNE LIGNE dans route-registry.ts,
  // PAS ICI (fin des conflits de merge au milieu de app.ts).
  for (const descriptor of buildRouteRegistry(options)) {
    descriptor.apply(app);
  }

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
