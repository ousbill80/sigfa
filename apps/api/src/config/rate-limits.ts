/**
 * Rate-limits GLOBAUX des routes publiques & webhooks — API-011.
 *
 * Monte le helper RÉUTILISABLE `rateLimitMiddleware` (API-010) sur les surfaces
 * exposées SANS JWT (routes `/public/*`, webhooks) et sur `POST /notifications/devices`
 * (429 dédié). Chaque route a sa PROPRE fenêtre glissante Redis (clés préfixées par
 * un nom de route distinct) : les fenêtres sont donc INDÉPENDANTES. Le middleware
 * émet un `429 TOO_MANY_REQUESTS` + `Retry-After` conforme LA LOI.
 *
 * Les limites par-route fines d'API-010 (suivi 30/min, feedback 5/min IP×trackingId)
 * restent internes au routeur public et continuent de fonctionner : ce montage global
 * ajoute une borne IP supplémentaire, sans remplacer les gardes existantes.
 *
 * @module
 */

import type { Hono } from "hono";
import { rateLimitMiddleware, clientIp, type RateLimitRule } from "src/lib/rate-limit.js";

/** Une entrée de configuration : préfixe de route + règle IP. */
interface RouteLimit {
  /** Préfixe de chemin (sous /api/v1) sur lequel monter la règle. */
  path: string;
  /** Nom de dimension unique (garantit une fenêtre Redis indépendante). */
  name: string;
  /** Limite d'appels dans la fenêtre. */
  limit: number;
  /** Fenêtre glissante (secondes). */
  windowSeconds: number;
}

/**
 * Table des limites globales par route (valeurs LA LOI).
 * `devices` : 10/min/IP (LA LOI). Les routes publiques de suivi/feedback portent
 * une borne IP large en plus de leurs gardes fines internes ; les webhooks sont
 * bornés pour absorber une tempête de callbacks fournisseur.
 */
export const GLOBAL_RATE_LIMITS: readonly RouteLimit[] = [
  { path: "/notifications/devices", name: "devices", limit: 10, windowSeconds: 60 },
  { path: "/public/tickets", name: "public-tickets", limit: 60, windowSeconds: 60 },
  // Listes publiques NOMINATIVES/opérations (MODEL-API-B/D5) : routes sans auth
  // `/public/agencies/{id}/relationship-managers` ET `/public/agencies/{id}/operations`.
  // Le montage `/public/agencies/*` couvre les DEUX sous-routes → surface
  // d'énumération/scraping bornée à 60/min/IP (fenêtre indépendante).
  { path: "/public/agencies", name: "public-agencies", limit: 60, windowSeconds: 60 },
  { path: "/webhooks", name: "webhooks", limit: 120, windowSeconds: 60 },
  // Session d'affichage TV publique (CONTRACT-013) : route publique sans auth,
  // bornée par IP (fenêtre indépendante). Un écran mural ne crée qu'une session
  // par démarrage/renouvellement 12 h → 20/min/IP absorbe largement le nominal.
  { path: "/tv/session", name: "tv-session", limit: 20, windowSeconds: 60 },
];

/**
 * Construit une règle de rate-limit IP indépendante pour une route.
 * La clé encode le `name` de la route → fenêtre Redis distincte de toute autre.
 *
 * @param entry - Entrée de configuration
 * @returns Règle consommable par `rateLimitMiddleware`
 */
function toRule(entry: RouteLimit): RateLimitRule {
  return {
    keyFn: (c) => `route:${entry.name}:ip:${clientIp(c)}`,
    limit: entry.limit,
    windowSeconds: entry.windowSeconds,
  };
}

/**
 * Monte les middlewares de rate-limit globaux sur l'app, sous `/api/v1`.
 * À appeler AVANT le montage des routeurs concernés.
 *
 * @param app - Application Hono (avec `redis` dans le contexte)
 */
export function mountGlobalRateLimits(app: Hono<never>): void {
  for (const entry of GLOBAL_RATE_LIMITS) {
    const middleware = rateLimitMiddleware([toRule(entry)]);
    app.use(`/api/v1${entry.path}`, middleware as Parameters<typeof app.use>[1]);
    app.use(`/api/v1${entry.path}/*`, middleware as Parameters<typeof app.use>[1]);
  }
}
