/**
 * Route de supervision des bornes — ADM-003a (admin.yaml, CONTRACT-013).
 *
 * `GET /agencies/:id/kiosks/status` (AGENCY_DIRECTOR+, scope agence) : renvoie le
 * statut de supervision de CHAQUE borne de l'agence, DÉRIVÉ À LA LECTURE depuis
 * `last_seen` et l'horloge serveur (jamais un état figé) — enum CONTRACT-013
 * `ONLINE`/`DEGRADED`/`SILENT`/`NEVER_SEEN`.
 *
 * Sécurité (SEC-002) : l'accès DB tenant passe par `withArmedTenant`
 * (`app.current_bank_id` armé, RLS contraignante en défense-en-profondeur) — cette
 * route est classée `ARMED` dans le test d'architecture. L'isolation applicative
 * (`WHERE bank_id`) reste posée en plus.
 *
 * Alerte « borne muette » : à chaque lecture, le `KioskSilenceTracker` (état
 * d'épisodes en mémoire, persistant sur la durée de vie du routeur) réconcilie les
 * statuts et émet `kiosk:silent`/`kiosk:recovered` DÉBOUNCÉS vers la room STAFF
 * (`agency:{id}:staff`, jamais la room publique DISPLAY — F-SEC-TV-01). Une coupure
 * agence (N bornes muettes d'un coup) = N alertes uniques agrégées par agence.
 *
 * @module
 */

import { Hono } from "hono";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import type { TenantContext } from "src/middleware/tenant.js";
import type { RealtimeBus } from "src/services/realtime.js";
import {
  errorResponse,
  paramUuid,
  requireBankId,
  assertAgencyScope,
} from "src/lib/admin-helpers.js";
import { asArmable, withArmedTenant } from "src/lib/armed-tenant.js";
import {
  deriveKioskStatus,
  KioskSilenceTracker,
  type KioskStatus,
  type KioskSupervisionRow,
} from "src/services/kiosk-supervision.js";

/** Variables de contexte Hono du routeur supervision borne. */
interface KioskSupervisionEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
    bus: RealtimeBus;
  };
}

/** Ligne brute projetée de `kiosks` (état de supervision). */
interface KioskRawRow {
  id: string;
  agency_id: string;
  last_seen: Date | null;
  printer_status: string;
  created_at: Date;
}

/** Statuts d'imprimante considérés sains (printerOk = true). */
const HEALTHY_PRINTER: ReadonlySet<string> = new Set(["OK", "PAPER_LOW"]);

/** Item de statut de supervision (contrat `KioskSupervisionStatusEntry`). */
interface StatusEntry {
  kioskId: string;
  agencyId: string;
  status: KioskStatus;
  lastSeen: string | null;
}

/**
 * Crée le routeur de supervision des bornes (monté sous /api/v1).
 *
 * Le `KioskSilenceTracker` est instancié DANS la clôture du routeur : son état
 * d'épisodes de silence persiste entre les requêtes servies par cette instance
 * (débounce inter-requêtes). Le bus est lié à la première lecture (identique sur
 * toute la durée de vie de l'app).
 *
 * @returns Routeur Hono de `GET /agencies/:id/kiosks/status`
 */
export function createKioskSupervisionRouter(): Hono<KioskSupervisionEnv> {
  const router = new Hono<KioskSupervisionEnv>();
  let tracker: KioskSilenceTracker | undefined;

  router.get("/agencies/:id/kiosks/status", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const agencyId = paramUuid(c, "id");
      assertAgencyScope(tenant, agencyId);
      const bankId = requireBankId(tenant);

      // SEC-002 : lecture tenant à travers la connexion ARMÉE (RLS contraignante).
      const rows = await withArmedTenant(asArmable(db), bankId, async (conn) => {
        const res = await conn.query(
          `SELECT id, agency_id, last_seen, printer_status, created_at
             FROM kiosks
            WHERE bank_id = $1 AND agency_id = $2
            ORDER BY created_at ASC`,
          [bankId, agencyId]
        );
        return res.rows as KioskRawRow[];
      });

      const now = new Date();
      const supervision = rows.map(toSupervisionRow);
      // Alerte « muette » débouncée (une fois par épisode, room STAFF).
      tracker ??= new KioskSilenceTracker(c.get("bus"));
      tracker.reconcile(supervision, now);

      const kiosks: StatusEntry[] = supervision.map((row) => ({
        kioskId: row.kioskId,
        agencyId: row.agencyId,
        status: deriveKioskStatus(row, now),
        lastSeen: row.lastSeen ? row.lastSeen.toISOString() : null,
      }));
      return c.json({ kiosks }, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  return router;
}

/**
 * Projette une ligne brute `kiosks` vers la forme de supervision (printerOk dérivé
 * du statut imprimante : OK/PAPER_LOW sains, ERROR/OFFLINE = anomalie).
 *
 * @param row - Ligne brute
 * @returns Ligne de supervision
 */
function toSupervisionRow(row: KioskRawRow): KioskSupervisionRow {
  return {
    kioskId: row.id,
    agencyId: row.agency_id,
    lastSeen: row.last_seen,
    printerOk: HEALTHY_PRINTER.has(row.printer_status),
    createdAt: row.created_at,
  };
}
