/**
 * Registre déclaratif des routes SIGFA API.
 *
 * SOURCE UNIQUE de l'enregistrement des routeurs de l'app Hono. `app.ts` se
 * contente d'itérer ce tableau : `for (const r of buildRouteRegistry(opts))
 * r.apply(app)`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AJOUTER UNE ROUTE = AJOUTER UNE LIGNE ICI. NE PAS ÉDITER `app.ts`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * L'ORDRE du tableau est significatif : Hono monte les routeurs dans l'ordre
 * d'appel de `app.route`. Ce registre reproduit à l'identique l'ordre, les
 * chemins de base et les injections d'options (`AppOptions`) qui prévalaient
 * dans `app.ts` avant l'extraction — c'est un refactor comportement-préservant.
 *
 * Un descripteur par ligne (format stable) → les futures stories ajoutent leur
 * route en insérant une ligne, sans conflit de merge au milieu de `app.ts`.
 *
 * @module
 */

import type { Env, Hono, Schema } from "hono";
import { createAuthRouter } from "src/routes/auth.js";
import { createTicketRouter } from "src/routes/tickets.js";
import { createTicketSyncRouter } from "src/routes/tickets-sync.js";
import { createQueueRouter } from "src/routes/queues.js";
import { createAgentRouter } from "src/routes/agents.js";
import { createBankRouter } from "src/routes/banks.js";
import { createAgencyRouter } from "src/routes/agencies.js";
import { createServiceRouter } from "src/routes/services.js";
import { createOperationRouter } from "src/routes/operations.js";
import { createCounterRouter } from "src/routes/counters.js";
import { createHoursRouter } from "src/routes/hours.js";
import { createThresholdsRouter } from "src/routes/thresholds.js";
import { createSmsTemplateRouter } from "src/routes/sms-templates.js";
import { createThemeRouter } from "src/routes/theme.js";
import { createOnboardingRouter } from "src/routes/onboarding.js";
import { createKioskSessionRouter } from "src/routes/kiosk-session.js";
import { createTvSessionRouter } from "src/routes/tv-session.js";
import { createAgentImportRouter } from "src/routes/agents-import.js";
import { createDataPrivacyRouter } from "src/routes/data-privacy.js";
import { createPublicTicketRouter } from "src/routes/public-tickets.js";
import { createHealthRouter } from "src/routes/health.js";
import { createAuditLogRouter } from "src/routes/audit-logs.js";
import { createDeviceRouter } from "src/routes/devices.js";
import { createKioskStatusRouter } from "src/routes/kiosks-status.js";
import { createKioskSupervisionRouter } from "src/routes/kiosk-supervision.js";
import { createReportRouter } from "src/routes/reports.js";
import { createNotificationWebhookRouter } from "src/routes/webhooks-notifications.js";
import { createWhatsAppInboundRouter } from "src/routes/webhooks-whatsapp-inbound.js";
import { createAiForecastRouter } from "src/routes/ai-forecast.js";
import { createAnomalyRouter } from "src/ai/anomaly-route.js";
import { createFeedbackInsightsRouter } from "src/ai/feedback-insights-route.js";
import { createNetworkOverviewRouter } from "src/routes/network-overview.js";
import type { AppOptions } from "src/app.js";

/**
 * Descripteur d'une route montable.
 *
 * `basePath` sert à la SUPERVISION (tests d'ordre/doublon, journalisation) ;
 * `apply` monte le routeur concret sur l'app cible en préservant intégralement
 * son `Env` (aucune homogénéisation, donc zéro `any` et zéro cast).
 *
 * `apply` est POLYMORPHE sur l'`Env` de l'app cible (`TEnv`) : il accepte
 * `Hono<AppEnv>` de `app.ts` comme n'importe quelle app Hono, car `app.route`
 * n'impose aucune contrainte entre l'`Env` de l'app hôte et celui du
 * sous-routeur (les Env sont invariants → aucun supertype commun homogène).
 */
export interface RouteDescriptor {
  /** Chemin de base sur lequel le routeur est monté (ex. "/api/v1"). */
  readonly basePath: string;
  /** Monte le routeur de ce descripteur sur l'app cible. */
  readonly apply: <TEnv extends Env>(app: Hono<TEnv, Schema, string>) => void;
}

/**
 * Fabrique un descripteur en capturant le routeur concret dans une clôture.
 *
 * Le paramètre générique `E` est INFÉRÉ depuis le routeur passé : chaque appel
 * `mount(base, createXRouter())` reste typé exactement comme l'était le
 * `app.route(base, createXRouter())` inline d'origine — même sûreté de types,
 * sans exposer un `Env` commun impossible entre routers hétérogènes.
 *
 * @param basePath - Chemin de base passé à `app.route`.
 * @param router   - Sous-application Hono à monter (Env préservé par inférence).
 * @returns Descripteur ordonnable/inspectable.
 */
function mount<E extends Env, S extends Schema, P extends string>(
  basePath: string,
  router: Hono<E, S, P>
): RouteDescriptor {
  return {
    basePath,
    apply: (app) => {
      app.route(basePath, router);
    },
  };
}

/**
 * Construit le tableau ordonné des routes de l'app à partir des options.
 *
 * Les routeurs dépendant d'injections optionnelles (`queueHealth`,
 * `exportEnqueue`) sont construits ici depuis `opts`, exactement comme avant.
 *
 * @param opts - Options de l'app (mêmes injections que `createApp`).
 * @returns Tableau ordonné de descripteurs `{ basePath, apply }`.
 */
export function buildRouteRegistry(opts: AppOptions): readonly RouteDescriptor[] {
  return [
    // Routes auth sous /api/v1/auth
    mount("/api/v1/auth", createAuthRouter()),
    // Routes tickets (API-003/004) sous /api/v1 (chemins /tickets, /counters/…)
    mount("/api/v1", createTicketRouter()),
    // Route de synchronisation offline (API-005) : POST /tickets/sync.
    mount("/api/v1", createTicketSyncRouter()),
    // Routes files d'attente (API-004) sous /api/v1 (PATCH /queues/:id)
    mount("/api/v1", createQueueRouter()),
    // Routes agents (API-007) : /agents/:id, /agents/:id/status, /agents/:id/stats
    mount("/api/v1", createAgentRouter()),
    // Routes CRUD admin (API-008) — banques (platform + bank).
    mount("/api/v1", createBankRouter()),
    // Routes CRUD admin (API-008) — agences (CRUD + soft-delete).
    mount("/api/v1", createAgencyRouter()),
    // Routes CRUD admin (API-008) — services & guichets (scope agence).
    mount("/api/v1", createServiceRouter()),
    // Routes CRUD opérations (MODEL-API-A) — enfants d'un service, scope agence.
    mount("/api/v1", createOperationRouter()),
    mount("/api/v1", createCounterRouter()),
    // Routes admin config (API-008, admin.yaml) — horaires, seuils, templates SMS.
    mount("/api/v1", createHoursRouter()),
    mount("/api/v1", createThresholdsRouter()),
    mount("/api/v1", createSmsTemplateRouter()),
    // Routes onboarding & plateforme (API-009). Theming, clonage config, session
    // borne (JWT 12 h + révocation), import CSV, droit à l'oubli.
    mount("/api/v1", createThemeRouter()),
    mount("/api/v1", createOnboardingRouter()),
    mount("/api/v1", createKioskSessionRouter()),
    // Session d'affichage TV publique (CONTRACT-013) : token DISPLAY lecture seule.
    mount("/api/v1", createTvSessionRouter()),
    mount("/api/v1", createAgentImportRouter()),
    mount("/api/v1", createDataPrivacyRouter()),
    // Routes PUBLIQUES (API-010, public.yaml) — suivi & feedback client SANS JWT.
    mount("/api/v1", createPublicTicketRouter()),
    // Routes API-011 : santé, supervision bornes, audit, devices.
    // - /health : public, checks postgres+redis (+ queues si injecté), 503 si down.
    mount("/api/v1", createHealthRouter("0.0.0", opts.queueHealth)),
    mount("/api/v1", createKioskStatusRouter()),
    // Supervision borne ADM-003a (admin.yaml, CONTRACT-013) : état dérivé à la
    // lecture (ONLINE/DEGRADED/SILENT/NEVER_SEEN) + alerte « muette » débouncée.
    mount("/api/v1", createKioskSupervisionRouter()),
    mount("/api/v1", createAuditLogRouter()),
    // Supervision réseau cross-tenant NET-001 (reporting.yaml, CONTRACT-006/013) :
    // GET /admin/network-overview — SUPER_ADMIN, LECTURE SEULE (agrégats/compteurs,
    // zéro PII), audit PLATFORM_READ, mutations → 403 PLATFORM_READ_ONLY.
    mount("/api/v1", createNetworkOverviewRouter()),
    mount("/api/v1", createDeviceRouter()),
    // Routes reporting KPI (REP-001) : GET /reports/kpis + /reports/daily/:agencyId.
    // `enqueueExport` injecté seulement si `exportEnqueue` fourni (sinon export PENDING).
    mount(
      "/api/v1",
      createReportRouter(
        opts.exportEnqueue ? { enqueueExport: opts.exportEnqueue } : {}
      )
    ),
    // Webhook d'accusé de livraison des notifications (NOTIF-002, CONTRACT-007) —
    // public (pas de JWT) mais signature fournisseur obligatoire. Routeur isolé.
    mount("/api/v1", createNotificationWebhookRouter()),
    // Webhook WhatsApp ENTRANT signé par banque (NOTIF-003, CONTRACT-003) — public
    // (pas de JWT) mais signature HMAC propre à la banque obligatoire. Routeur isolé.
    mount("/api/v1", createWhatsAppInboundRouter()),
    // Prévision d'affluence IA (IA-002, CONTRACT-008) : GET /ai/forecast. Runtime
    // GATED sur données réelles — provider par défaut → 422 INSUFFICIENT_HISTORY.
    mount("/api/v1", createAiForecastRouter()),
    // Anomalies IA agrégées (IA-003, CONTRACT-008) : GET /ai/anomalies (lecture seule).
    mount("/api/v1", createAnomalyRouter()),
    // Insights NLP feedbacks + scoring qualité (IA-004, CONTRACT-008) : GET /ai/feedback-insights.
    mount("/api/v1", createFeedbackInsightsRouter()),
  ];
}
