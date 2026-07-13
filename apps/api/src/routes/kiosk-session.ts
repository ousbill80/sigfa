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
 * ## Armement RLS (SEC-002-CUTOVER-LOT7)
 * Le tenant (bankId) provient d'un TOKEN/SESSION, jamais d'une auth staff pour les
 * chemins publics. Chaque accès DB tenant est routé — APRÈS résolution du tenant —
 * à travers `withArmedTenant` (`app.current_bank_id` armé, connexion `sigfa_app`
 * NOBYPASSRLS, RLS `kiosks`/`audit_log` contraignantes) :
 *
 * - `POST /kiosk/session` : l'authentification par credentials (`createKioskSession`,
 *   lookup borne + bcrypt + persistance de session) est INTRINSÈQUEMENT PRÉ-TENANT
 *   (on ignore la banque avant d'authentifier la borne) — elle reste hors armement.
 *   L'audit d'ouverture, POST-résolution du bankId, est écrit à travers la connexion
 *   ARMÉE (RLS `audit_log` contraignante).
 * - `DELETE /kiosk/session/:kioskId` : tenant porté par le JWT staff → révocation
 *   `kiosks` + audit ARMÉS (`app.current_bank_id` posé).
 * - `POST /kiosks/:kioskId/heartbeat` : tenant porté par le JWT borne → UPDATE
 *   `kiosks` ARMÉ.
 *
 * Cette route est classée `ARMED` dans le test d'architecture.
 *
 * @module
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { SigfaError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";
import type { RealtimeBus } from "src/services/realtime.js";
import { errorResponse, parseJson, parseStrict, requireBankId, UUID_RE } from "src/lib/admin-helpers.js";
import {
  createKioskSession,
  revokeKioskSession,
} from "src/services/kiosk-session.service.js";
import { recordAudit, extractIp } from "src/lib/audit-context.js";
import { withAudit } from "src/audit/with-audit.js";
import { asArmable, withArmedTenant } from "src/lib/armed-tenant.js";

/** Variables de contexte Hono du routeur session borne. */
interface KioskEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
    bus: RealtimeBus;
  };
}

/** Statuts d'imprimante (LA LOI PrinterStatus). */
const PRINTER_STATUSES = ["OK", "PAPER_LOW", "ERROR", "OFFLINE"] as const;

/** Statuts d'imprimante en erreur → déclenchent un épisode `kiosk:printer-error`. */
const PRINTER_ERROR_STATUSES: ReadonlySet<string> = new Set(["ERROR", "OFFLINE"]);

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
    const ip = extractIp(c);
    try {
      const input = parseStrict(kioskSessionSchema, await parseJson(c));
      // SEC-002 — résolution PRÉ-TENANT du tenant de la borne : on ignore la banque
      // avant d'avoir authentifié la borne. Ce lookup par `id` est le SEUL accès
      // légitimement hors armement (résolution d'identité de session, cf. en-tête).
      const bankId = await resolvePreTenantBankId(db, input.kioskId);
      // SEC-001a + SEC-002 : ouverture de session borne + audit ATOMIQUES à travers
      // la connexion ARMÉE (`app.current_bank_id = bankId`, RLS kiosks/audit_log
      // contraignantes). Acteur = la borne (public, actorId/role null) ; jamais le
      // secret dans le diff. Un échec (auth invalide) relâche la transaction armée.
      const session = await withArmedTenant(asArmable(db), bankId, async () => {
        const created = await createKioskSession({
          db,
          jwtSecret: c.get("jwtSecret"),
          kioskId: input.kioskId,
          kioskSecret: input.kioskSecret,
          agencyId: input.agencyId,
        });
        await recordAudit({
          db,
          tenant: { requestId: "", userId: "", bankId, role: "NONE", agencyIds: [] },
          action: "POST /kiosk/session",
          entityType: "kiosk",
          entityId: input.kioskId,
          ip,
          diff: { after: { agencyId: input.agencyId, sessionOpened: true } },
        });
        return created;
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
      // SEC-001a + SEC-002 : révocation de session borne + audit ATOMIQUES à travers
      // la connexion ARMÉE (`app.current_bank_id = bankId` posé AVANT toute requête,
      // RLS kiosks/audit_log contraignantes). `withAudit` compose par SAVEPOINT dans
      // la transaction armée (`inTransaction:true`) ; l'englobant commit une fois.
      await withArmedTenant(asArmable(db), bankId, async () => {
        await withAudit(
          { db, tenant, ip: extractIp(c), inTransaction: true },
          async () => {
            await revokeKioskSession(db, bankId, kioskId);
            return {
              result: undefined,
              audit: {
                action: "DELETE /kiosk/session/:kioskId",
                entityType: "kiosk",
                entityId: kioskId,
                diff: { after: { sessionRevoked: true } },
              },
            };
          }
        );
      });
      return c.json({ success: true }, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/**
 * Résout le `bank_id` d'une borne par son `id` — PRÉ-TENANT (résolution d'identité
 * de session, cf. en-tête). Une borne inconnue / un id non-UUID → **401 opaque**
 * `KIOSK_AUTH_FAILED` (jamais un oracle d'existence, aligné sur le rejet d'auth du
 * service). Ce lookup précède l'armement car le tenant est ENCORE inconnu ici.
 *
 * @param db      - Connexion PG
 * @param kioskId - Identifiant de la borne (colonne `id`)
 * @returns Le `bank_id` de la borne
 * @throws {SigfaError} 401 KIOSK_AUTH_FAILED si la borne est introuvable (opaque)
 */
async function resolvePreTenantBankId(db: Client, kioskId: string): Promise<string> {
  // Un id non-UUID ne désigne aucune borne → 401 opaque (jamais de 500 sur cast).
  if (!UUID_RE.test(kioskId)) {
    throw new SigfaError("KIOSK_AUTH_FAILED", "Authentification borne échouée.", 401);
  }
  const res = await db.query(`SELECT bank_id FROM kiosks WHERE id = $1`, [kioskId]);
  const row = res.rows[0] as { bank_id: string } | undefined;
  if (!row) {
    throw new SigfaError("KIOSK_AUTH_FAILED", "Authentification borne échouée.", 401);
  }
  return row.bank_id;
}

/** Ligne kiosk projetée par l'UPDATE du heartbeat (état avant/après). */
interface HeartbeatRow {
  id: string;
  agency_id: string;
  previous_status: string;
  printer_status: string;
}

/** Enregistre POST /kiosks/:kioskId/heartbeat (AUTHENTICATED) + épisode erreur. */
function registerHeartbeat(router: Hono<KioskEnv>): void {
  router.post("/kiosks/:kioskId/heartbeat", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const kioskId = c.req.param("kioskId");
      assertOwnKiosk(tenant, kioskId);
      const bankId = requireBankId(tenant);
      const input = parseStrict(heartbeatSchema, await parseJson(c));
      // SEC-002 : UPDATE `kiosks` à travers la connexion ARMÉE (RLS `app.current_bank_id`
      // contraignante) — une borne ne rafraîchit QUE sa propre ligne, dans SA banque.
      const row = await withArmedTenant(asArmable(db), bankId, (conn) =>
        applyHeartbeat(conn as unknown as Client, kioskId, input.printerStatus, input.appVersion)
      );
      maybeEmitPrinterError(c.get("bus"), row);
      return c.json({ serverTime: new Date().toISOString() }, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/**
 * Interdit l'écriture cross-borne : un JWT de session borne ne peut rafraîchir
 * QUE sa propre borne. Le `kioskId` du path DOIT correspondre au claim `kioskId`
 * du JWT. Sinon 404 opaque (jamais de fuite d'existence d'une borne d'un autre
 * tenant/agence — Boucle 3 F3).
 *
 * @param tenant  - Contexte tenant (porte `kioskId` pour un JWT borne)
 * @param kioskId - Borne ciblée par le path
 * @throws {SigfaError} 404 KIOSK_NOT_FOUND si le kioskId du path ≠ claim JWT
 */
function assertOwnKiosk(tenant: TenantContext, kioskId: string): void {
  // Un JWT de session borne PORTE toujours `kioskId`. Un JWT dépourvu de ce claim
  // (utilisateur humain AUTHENTICATED) n'est pas une borne : la route est réservée
  // aux bornes (self-heartbeat), donc refus opaque.
  if (!tenant.kioskId || tenant.kioskId !== kioskId) {
    throw new SigfaError("KIOSK_NOT_FOUND", "Borne introuvable.", 404);
  }
}

/**
 * Met à jour last_seen/printer_status/app_version et renvoie l'état avant/après.
 * `previous_status` (capturé via une sous-requête sur l'ancienne ligne) permet de
 * détecter la TRANSITION d'un état sain vers un état d'erreur (nouvel épisode).
 *
 * @param db            - Client PG
 * @param kioskId       - Identifiant de la borne
 * @param printerStatus - Nouveau statut imprimante
 * @param appVersion    - Version applicative rapportée
 * @throws {SigfaError} 404 KIOSK_NOT_FOUND si la borne n'existe pas
 */
async function applyHeartbeat(
  db: Client,
  kioskId: string,
  printerStatus: string,
  appVersion: string
): Promise<HeartbeatRow> {
  // Le param `kioskId` est un `string` libre au contrat : un id non-UUID ne peut
  // désigner aucune borne → 404 (jamais de 500 sur cast UUID invalide).
  if (!UUID_RE.test(kioskId)) {
    throw new SigfaError("KIOSK_NOT_FOUND", "Borne introuvable.", 404);
  }
  const res = await db.query(
    `UPDATE kiosks AS k
        SET printer_status = $2::printer_status,
            app_version = $3,
            last_seen = now(),
            updated_at = now()
       FROM (SELECT id, printer_status AS previous_status FROM kiosks WHERE id = $1) AS old
      WHERE k.id = old.id
      RETURNING k.id, k.agency_id, old.previous_status, k.printer_status`,
    [kioskId, printerStatus, appVersion]
  );
  if (res.rows.length === 0) {
    throw new SigfaError("KIOSK_NOT_FOUND", "Borne introuvable.", 404);
  }
  return res.rows[0] as HeartbeatRow;
}

/**
 * Émet `kiosk:printer-error` UNE fois par épisode : uniquement quand le statut
 * PASSE d'un état sain (OK/PAPER_LOW) à un état d'erreur (ERROR/OFFLINE). Tant que
 * la borne reste en erreur, aucune ré-émission ; un retour à OK clôt l'épisode et
 * autorise une nouvelle émission au prochain basculement.
 *
 * @param bus - Bus temps réel injecté
 * @param row - État avant/après du heartbeat
 */
function maybeEmitPrinterError(bus: RealtimeBus, row: HeartbeatRow): void {
  const wasHealthy = !PRINTER_ERROR_STATUSES.has(row.previous_status);
  const isError = PRINTER_ERROR_STATUSES.has(row.printer_status);
  if (wasHealthy && isError) {
    bus.emit("kiosk:printer-error", row.agency_id, {
      kioskId: row.id,
      agencyId: row.agency_id,
      since: new Date().toISOString(),
    });
  }
}
