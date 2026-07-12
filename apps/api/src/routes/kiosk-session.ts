/**
 * Routes session borne — API-009 (public.yaml).
 *
 * - POST   /kiosk/session            — credentials borne → JWT scope agency,
 *   rôle AUTHENTICATED, TTL 12 h (public, sans auth préalable).
 * - DELETE /kiosk/session/:kioskId   — révocation (AGENCY_DIRECTOR) : pose
 *   `session_revoked_at`. Le JWT est ensuite REFUSÉ par le middleware, MÊME si
 *   `exp` est encore valide.
 * - POST   /kiosks/:kioskId/heartbeat — heartbeat borne (AUTHENTICATED) : met à
 *   jour printerStatus/appVersion/lastSeen. Preuve d'usage du JWT + de révocation.
 *
 * @module
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { SigfaError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";
import { errorResponse, parseJson, parseStrict, requireBankId } from "src/lib/admin-helpers.js";
import {
  createKioskSession,
  revokeKioskSession,
} from "src/services/kiosk-session.service.js";

/** Variables de contexte Hono du routeur session borne. */
interface KioskEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/** Statuts d'imprimante (LA LOI PrinterStatus). */
const PRINTER_STATUSES = ["OK", "PAPER_LOW", "ERROR", "OFFLINE"] as const;

/** Corps de POST /kiosk/session (LA LOI KioskSessionRequest). */
const kioskSessionSchema = z
  .object({
    kioskId: z.string().min(1),
    kioskSecret: z.string().min(16),
    agencyId: z.string().uuid(),
  })
  .strict();

/** Corps de POST /kiosks/:kioskId/heartbeat (LA LOI HeartbeatRequest). */
const heartbeatSchema = z
  .object({
    printerStatus: z.enum(PRINTER_STATUSES),
    appVersion: z.string().min(1),
    uptimeSeconds: z.number().int().min(0),
  })
  .strict();

/**
 * Crée le routeur session borne (monté sous /api/v1).
 *
 * @returns Routeur Hono des routes session borne API-009
 */
export function createKioskSessionRouter(): Hono<KioskEnv> {
  const router = new Hono<KioskEnv>();
  registerCreateSession(router);
  registerRevokeSession(router);
  registerHeartbeat(router);
  return router;
}

/** Enregistre POST /kiosk/session (public → JWT 12 h). */
function registerCreateSession(router: Hono<KioskEnv>): void {
  router.post("/kiosk/session", async (c) => {
    const db = c.get("db");
    try {
      const input = parseStrict(kioskSessionSchema, await parseJson(c));
      const session = await createKioskSession({
        db,
        jwtSecret: c.get("jwtSecret"),
        kioskId: input.kioskId,
        kioskSecret: input.kioskSecret,
        agencyId: input.agencyId,
      });
      return c.json(session, 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Enregistre DELETE /kiosk/session/:kioskId (révocation). */
function registerRevokeSession(router: Hono<KioskEnv>): void {
  router.delete("/kiosk/session/:kioskId", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const kioskId = c.req.param("kioskId");
      const bankId = requireBankId(tenant);
      await revokeKioskSession(db, bankId, kioskId);
      return c.json({ success: true }, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Enregistre POST /kiosks/:kioskId/heartbeat (AUTHENTICATED). */
function registerHeartbeat(router: Hono<KioskEnv>): void {
  router.post("/kiosks/:kioskId/heartbeat", async (c) => {
    const db = c.get("db");
    try {
      const kioskId = c.req.param("kioskId");
      const input = parseStrict(heartbeatSchema, await parseJson(c));
      const res = await db.query(
        `UPDATE kiosks
            SET printer_status = $2::printer_status,
                app_version = $3,
                last_seen = now(),
                updated_at = now()
          WHERE id = $1
          RETURNING id`,
        [kioskId, input.printerStatus, input.appVersion]
      );
      if (res.rows.length === 0) {
        throw new SigfaError("KIOSK_NOT_FOUND", "Borne introuvable.", 404);
      }
      return c.json({ serverTime: new Date().toISOString() }, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}
