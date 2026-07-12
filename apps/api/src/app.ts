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
import { createTicketSyncRouter } from "src/routes/tickets-sync.js";
import { createQueueRouter } from "src/routes/queues.js";
import { createAgentRouter } from "src/routes/agents.js";
import { createBankRouter } from "src/routes/banks.js";
import { createAgencyRouter } from "src/routes/agencies.js";
import { createServiceRouter } from "src/routes/services.js";
import { createCounterRouter } from "src/routes/counters.js";
import { createHoursRouter } from "src/routes/hours.js";
import { createThresholdsRouter } from "src/routes/thresholds.js";
import { createSmsTemplateRouter } from "src/routes/sms-templates.js";
import { createThemeRouter } from "src/routes/theme.js";
import { createOnboardingRouter } from "src/routes/onboarding.js";
import { createKioskSessionRouter } from "src/routes/kiosk-session.js";
import { createAgentImportRouter } from "src/routes/agents-import.js";
import { createDataPrivacyRouter } from "src/routes/data-privacy.js";
import { createPublicTicketRouter } from "src/routes/public-tickets.js";
import { createHealthRouter } from "src/routes/health.js";
import { createAuditLogRouter } from "src/routes/audit-logs.js";
import { createDeviceRouter } from "src/routes/devices.js";
import { createKioskStatusRouter } from "src/routes/kiosks-status.js";
import { mountGlobalRateLimits } from "src/config/rate-limits.js";
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

  // Routes auth sous /api/v1/auth
  const authRouter = createAuthRouter();
  app.route("/api/v1/auth", authRouter);

  // Routes tickets (API-003/004) sous /api/v1 (chemins /tickets, /counters/…)
  const ticketRouter = createTicketRouter();
  app.route("/api/v1", ticketRouter);

  // Route de synchronisation offline (API-005) : POST /tickets/sync.
  // Montée AVANT le routeur tickets générique ? Non : Hono route par chemin exact,
  // et /tickets/sync n'entre pas en collision avec /tickets/:id (POST simple).
  const ticketSyncRouter = createTicketSyncRouter();
  app.route("/api/v1", ticketSyncRouter);

  // Routes files d'attente (API-004) sous /api/v1 (PATCH /queues/:id)
  const queueRouter = createQueueRouter();
  app.route("/api/v1", queueRouter);

  // Routes agents (API-007) sous /api/v1 (/agents/:id, /agents/:id/status, /agents/:id/stats)
  const agentRouter = createAgentRouter();
  app.route("/api/v1", agentRouter);

  // Routes CRUD admin (API-008) — banques (platform + bank).
  const bankRouter = createBankRouter();
  app.route("/api/v1", bankRouter);

  // Routes CRUD admin (API-008) — agences (CRUD + soft-delete).
  const agencyRouter = createAgencyRouter();
  app.route("/api/v1", agencyRouter);

  // Routes CRUD admin (API-008) — services & guichets (scope agence).
  const serviceRouter = createServiceRouter();
  app.route("/api/v1", serviceRouter);
  const counterRouter = createCounterRouter();
  app.route("/api/v1", counterRouter);

  // Routes admin config (API-008, admin.yaml) — horaires, seuils, templates SMS.
  const hoursRouter = createHoursRouter();
  app.route("/api/v1", hoursRouter);
  const thresholdsRouter = createThresholdsRouter();
  app.route("/api/v1", thresholdsRouter);
  const smsTemplateRouter = createSmsTemplateRouter();
  app.route("/api/v1", smsTemplateRouter);

  // Routes onboarding & plateforme (API-009, admin.yaml + public.yaml + agents.yaml).
  // Theming (couleurs corrigées ≥4.5:1, presign R2), clonage de config,
  // session borne (JWT 12 h + révocation), import CSV, droit à l'oubli.
  const themeRouter = createThemeRouter();
  app.route("/api/v1", themeRouter);
  const onboardingRouter = createOnboardingRouter();
  app.route("/api/v1", onboardingRouter);
  const kioskSessionRouter = createKioskSessionRouter();
  app.route("/api/v1", kioskSessionRouter);
  const agentImportRouter = createAgentImportRouter();
  app.route("/api/v1", agentImportRouter);
  const dataPrivacyRouter = createDataPrivacyRouter();
  app.route("/api/v1", dataPrivacyRouter);

  // Routes PUBLIQUES (API-010, public.yaml) — suivi & feedback client SANS JWT.
  // Anti-spam Redis, fenêtre 24 h UTC, NPS incrémental, 404 opaque anti-énumération.
  const publicTicketRouter = createPublicTicketRouter();
  app.route("/api/v1", publicTicketRouter);

  // Routes API-011 (dernière story F3) : santé, supervision bornes, audit, devices.
  // - /health : public, sans auth/tenant (checks postgres+redis, 503 si down).
  // - /kiosks/status : supervision MANAGER+ (ONLINE/SILENT dérivé de last_seen).
  // - /audit-logs : lecture seule stricte (AUDITOR|SUPER_ADMIN).
  // - /notifications/devices : enregistrement idempotent + DELETE ownership.
  app.route("/api/v1", createHealthRouter());
  app.route("/api/v1", createKioskStatusRouter());
  app.route("/api/v1", createAuditLogRouter());
  app.route("/api/v1", createDeviceRouter());

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
