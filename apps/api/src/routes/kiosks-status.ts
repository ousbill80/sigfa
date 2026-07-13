/**
 * Route de supervision des bornes — API-011 (reporting.yaml `GET /kiosks/status`).
 *
 * MANAGER+ (scope agency). Liste les bornes avec un statut DÉRIVÉ du dernier
 * heartbeat : `OFFLINE` (borne silencieuse >3 min) si `last_seen < NOW() -
 * KIOSK_SILENT_THRESHOLD_S` (180 s = 3× l'intervalle nominal de 60 s), sinon
 * `ONLINE`. Une borne n'ayant jamais émis de heartbeat (`last_seen IS NULL`) est
 * également `OFFLINE`. Statut conforme à l'enum LA LOI `ONLINE | OFFLINE | DEGRADED`.
 *
 * Le seuil est dérivé en SQL de `NOW()` : il suit l'horloge base, ce qui permet
 * aux tests d'antidater `last_seen` pour franchir le seuil de façon déterministe.
 *
 * ## Sécurité (SEC-002-CUTOVER-LOT2)
 * La lecture tenant est routée via `withArmedTenant` (contexte RLS
 * `app.current_bank_id` armé sur la connexion `sigfa_app` NOBYPASSRLS) → cette route
 * est classée **ARMED** dans `tenant-armament-arch.test.ts`. La table `kiosks` a la
 * policy `tenant_isolation` (SELECT bank_id = current_bank_id) + GRANT SELECT
 * `sigfa_app` (migration 0001). Le filtrage applicatif `WHERE bank_id`/scope agence est
 * conservé en défense-en-profondeur.
 *
 * @module
 */

import { Hono } from "hono";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import type { TenantContext } from "src/middleware/tenant.js";
import { errorResponse, assertAgencyScope, requireBankId } from "src/lib/admin-helpers.js";
import { KIOSK_SILENT_THRESHOLD_S } from "src/config/kiosk.js";
import { withArmedTenant, asArmable } from "src/lib/armed-tenant.js";

/** Variables de contexte Hono du routeur supervision. */
interface KioskStatusEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/** Ligne brute projetée de `kiosks` + statut dérivé. */
interface KioskStatusRow {
  kiosk_id: string;
  agency_id: string;
  last_seen: Date | null;
  printer_status: string;
  is_silent: boolean;
}

/**
 * Crée le routeur de supervision des bornes (monté sous /api/v1).
 *
 * @returns Routeur Hono de `GET /kiosks/status`
 */
export function createKioskStatusRouter(): Hono<KioskStatusEnv> {
  const router = new Hono<KioskStatusEnv>();
  router.get("/kiosks/status", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const bankId = requireBankId(tenant);
      const agencyId = c.req.query("agencyId");
      const { where, params } = buildScope(tenant, agencyId);
      // SEC-002 : lecture tenant à travers la connexion ARMÉE (RLS contraignante).
      const rows = await withArmedTenant(asArmable(db), bankId, async (conn) => {
        const res = await conn.query(
          `SELECT id AS kiosk_id, agency_id, last_seen, printer_status,
                  (last_seen IS NULL OR last_seen < NOW() - ($${params.length + 1} || ' seconds')::interval)
                    AS is_silent
             FROM kiosks ${where}
            ORDER BY created_at ASC`,
          [...params, String(KIOSK_SILENT_THRESHOLD_S)]
        );
        return res.rows as KioskStatusRow[];
      });
      return c.json({ kiosks: rows.map(toKioskStatus) }, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
  return router;
}

/** Rôles à portée BANQUE : voient toutes les agences de leur banque (sans filtre agence). */
const BANK_SCOPED_ROLES: ReadonlySet<string> = new Set([
  "SUPER_ADMIN",
  "BANK_ADMIN",
]);

/**
 * Construit la portée tenant de la requête : bornes de la banque du JWT, filtrées
 * par agence si `agencyId` est fourni (et dans le scope du JWT).
 *
 * Durcissement Boucle 3 F3 : pour les rôles NON bank-scoped (MANAGER,
 * AGENCY_DIRECTOR, …), en l'ABSENCE de query `agencyId`, la portée est restreinte
 * aux `tenant.agencyIds` du JWT — un MANAGER de l'agence A ne voit donc jamais les
 * bornes d'une autre agence de sa banque. SUPER_ADMIN/BANK_ADMIN conservent la
 * vue banque complète.
 *
 * @param tenant   - Contexte tenant
 * @param agencyId - Agence demandée (optionnelle)
 * @returns Clause WHERE paramétrée et ses paramètres
 */
function buildScope(
  tenant: TenantContext,
  agencyId: string | undefined
): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (tenant.bankId) {
    params.push(tenant.bankId);
    clauses.push(`bank_id = $${params.length}`);
  }
  if (agencyId) {
    assertAgencyScope(tenant, agencyId);
    params.push(agencyId);
    clauses.push(`agency_id = $${params.length}`);
  } else if (!BANK_SCOPED_ROLES.has(tenant.role)) {
    // Rôle à portée agence sans agencyId explicite → borner aux agences du JWT.
    // `= ANY($n)` sur un tableau vide ne matche rien → aucune fuite hors scope.
    params.push(tenant.agencyIds);
    clauses.push(`agency_id = ANY($${params.length}::uuid[])`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
}

/**
 * Projette une ligne kiosk vers l'item de statut LA LOI, avec le statut dérivé
 * ONLINE/OFFLINE (borne silencieuse >3 min).
 *
 * @param row - Ligne brute + `is_silent`
 * @returns Item de statut conforme
 */
function toKioskStatus(row: KioskStatusRow): Record<string, unknown> {
  return {
    kioskId: row.kiosk_id,
    agencyId: row.agency_id,
    status: row.is_silent ? "OFFLINE" : "ONLINE",
    lastSeen: row.last_seen ? row.last_seen.toISOString() : null,
    printerStatus: row.printer_status,
  };
}
