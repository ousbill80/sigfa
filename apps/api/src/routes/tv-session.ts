/**
 * Route session d'affichage TV public — CONTRACT-013 (public.yaml).
 *
 * - POST /tv/session — `agencyId` (uuid Zod) → JWT DISPLAY lecture seule, scope
 *   agency, TTL 12 h (43200 s), non renouvelable (public, sans auth préalable).
 *   404 opaque `AGENCY_NOT_FOUND` si l'agence n'existe pas (anti-énumération).
 *
 * ## Armement RLS (SEC-002-CUTOVER-LOT7)
 * Le tenant (bankId) n'est PAS porté par une auth staff : il est RÉSOLU depuis
 * l'`agencyId` revendiqué (session publique). La résolution initiale de la banque
 * est INTRINSÈQUEMENT PRÉ-TENANT (on ignore encore le tenant) — seule étape hors
 * armement. UNE FOIS le bankId dérivé, la confirmation d'existence de l'agence est
 * REJOUÉE via `withArmedTenant` (RLS `agencies` contraignante) : une session ne
 * confirme QUE des agences de SA banque. Cette route est classée `ARMED`.
 *
 * Rate-limit par IP monté globalement (`config/rate-limits.ts`, `TRUST_PROXY`
 * respecté via `resolveClientIp`) : 429 `TOO_MANY_REQUESTS` + `details.retryAfterSeconds`.
 *
 * @module
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import type { TenantContext } from "src/middleware/tenant.js";
import type { RealtimeBus } from "src/services/realtime.js";
import { errorResponse, parseJson, parseStrict } from "src/lib/admin-helpers.js";
import { asArmable, withArmedTenant } from "src/lib/armed-tenant.js";
import { createTvSession } from "src/services/tv-session.service.js";

/** Variables de contexte Hono du routeur session TV. */
interface TvEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
    bus: RealtimeBus;
  };
}

/** Corps de POST /tv/session (LA LOI `TvSessionRequest`). */
const tvSessionSchema = z
  .object({
    agencyId: z.string().uuid(),
  })
  .strict();

/**
 * Crée le routeur session TV (monté sous /api/v1).
 *
 * @returns Routeur Hono de la route session TV CONTRACT-013
 */
export function createTvSessionRouter(): Hono<TvEnv> {
  const router = new Hono<TvEnv>();
  registerCreateSession(router);
  return router;
}

/** Enregistre POST /tv/session (public → JWT DISPLAY 12 h). */
function registerCreateSession(router: Hono<TvEnv>): void {
  router.post("/tv/session", async (c) => {
    const db = c.get("db");
    try {
      const input = parseStrict(tvSessionSchema, await parseJson(c));
      const session = await createTvSession({
        db,
        jwtSecret: c.get("jwtSecret"),
        agencyId: input.agencyId,
        // SEC-002 : la confirmation tenant de l'agence passe par la connexion ARMÉE
        // (`app.current_bank_id` posé sur le bankId résolu, RLS `agencies` contraignante).
        armedRead: (bankId, fn) => withArmedTenant(asArmable(db), bankId, fn),
      });
      return c.json(session, 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}
