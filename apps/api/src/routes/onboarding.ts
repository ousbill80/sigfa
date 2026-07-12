/**
 * Routes onboarding agences — API-009 (admin.yaml).
 *
 * - POST /agencies/:id/clone-from/:templateId — clone la CONFIG d'une agence
 *   template vers l'agence cible : horaires (weekly_schedule), services actifs,
 *   guichets + counter_services. **JAMAIS** de tickets, users, files ni données
 *   clients. Toute agence est clonable (`is_template` = filtre UI, pas un gate).
 * - POST /agencies/:id/kiosk-access — provisionne une borne : credentials bcrypt
 *   (secret affiché une seule fois) + QR d'installation (AGENCY_DIRECTOR).
 *
 * Le clonage recopie la config au sein d'une même banque (garde tenant stricte).
 *
 * @module
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { SigfaError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";
import {
  paramUuid,
  errorResponse,
  parseJson,
  parseStrict,
  requireBankId,
  assertAgencyScope,
} from "src/lib/admin-helpers.js";
import { recordAudit, buildDiff, extractIp } from "src/lib/audit-context.js";
import { createKioskAccess } from "src/services/kiosk-session.service.js";

/** Variables de contexte Hono du routeur onboarding. */
interface OnboardingEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/** Sections de config clonées (LA LOI CloneAgencyResponse.clonedSections). */
const CLONED_SECTIONS = ["hours", "smsTemplates", "thresholds", "services"] as const;

/** Corps optionnel de POST /agencies/:id/kiosk-access (LA LOI KioskAccessRequest). */
const kioskAccessSchema = z
  .object({ label: z.string().max(100).optional() })
  .strict();

/**
 * Crée le routeur onboarding (monté sous /api/v1).
 *
 * @returns Routeur Hono des routes onboarding API-009
 */
export function createOnboardingRouter(): Hono<OnboardingEnv> {
  const router = new Hono<OnboardingEnv>();
  registerClone(router);
  registerKioskAccess(router);
  return router;
}

/** Vérifie qu'une agence existe dans le tenant, ou 404. */
async function assertAgencyExists(
  db: Client,
  bankId: string,
  agencyId: string
): Promise<void> {
  const res = await db.query(
    `SELECT 1 FROM agencies WHERE id = $1 AND bank_id = $2 AND deleted_at IS NULL`,
    [agencyId, bankId]
  );
  if (res.rows.length === 0) {
    throw new SigfaError("NOT_FOUND", "Agence introuvable.", 404);
  }
}

/** Enregistre POST /agencies/:id/clone-from/:templateId + audit. */
function registerClone(router: Hono<OnboardingEnv>): void {
  router.post("/agencies/:id/clone-from/:templateId", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const targetId = paramUuid(c, "id");
      const templateId = paramUuid(c, "templateId");
      const bankId = requireBankId(tenant);
      await assertAgencyExists(db, bankId, targetId);
      await assertAgencyExists(db, bankId, templateId);
      await cloneConfig(db, bankId, templateId, targetId);
      await recordAudit({
        db,
        tenant,
        action: "POST /agencies/:id/clone-from/:templateId",
        entityType: "agency",
        entityId: targetId,
        ip: extractIp(c),
        diff: buildDiff({}, { clonedFrom: templateId }),
      });
      return c.json(
        {
          targetAgencyId: targetId,
          templateAgencyId: templateId,
          clonedSections: [...CLONED_SECTIONS],
          clonedAt: new Date().toISOString(),
        },
        200
      );
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/**
 * Clone la CONFIG de l'agence template vers la cible (jamais de données).
 * Copie : horaires (weekly_schedule), services actifs, guichets + counter_services.
 *
 * @param db         - Connexion PG (tenant courant)
 * @param bankId     - Banque (garde tenant)
 * @param templateId - Agence source
 * @param targetId   - Agence cible
 */
async function cloneConfig(
  db: Client,
  bankId: string,
  templateId: string,
  targetId: string
): Promise<void> {
  await cloneHours(db, bankId, templateId, targetId);
  const serviceMap = await cloneServices(db, bankId, templateId, targetId);
  await cloneCounters(db, bankId, templateId, targetId, serviceMap);
}

/** Copie l'hebdo (weekly_schedule) template → cible. */
async function cloneHours(
  db: Client,
  bankId: string,
  templateId: string,
  targetId: string
): Promise<void> {
  await db.query(
    `UPDATE agencies dst
        SET weekly_schedule = src.weekly_schedule, updated_at = now()
       FROM agencies src
      WHERE dst.id = $1 AND src.id = $2 AND dst.bank_id = $3 AND src.bank_id = $3`,
    [targetId, templateId, bankId]
  );
}

/**
 * Copie les services actifs template → cible et retourne la correspondance
 * `serviceId source → serviceId cible` (pour les counter_services).
 */
async function cloneServices(
  db: Client,
  bankId: string,
  templateId: string,
  targetId: string
): Promise<Map<string, string>> {
  const res = await db.query(
    `SELECT id, code, name, sla_minutes, display_order
       FROM services
      WHERE bank_id = $1 AND agency_id = $2 AND deleted_at IS NULL AND is_active = true
      ORDER BY display_order ASC`,
    [bankId, templateId]
  );
  const map = new Map<string, string>();
  for (const svc of res.rows as ServiceRow[]) {
    const inserted = await db.query(
      `INSERT INTO services (bank_id, agency_id, code, name, sla_minutes, display_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (agency_id, code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [bankId, targetId, svc.code, svc.name, svc.sla_minutes, svc.display_order]
    );
    map.set(svc.id, (inserted.rows[0] as { id: string }).id);
  }
  return map;
}

/** Ligne service projetée pour le clonage. */
interface ServiceRow {
  id: string;
  code: string;
  name: string;
  sla_minutes: number;
  display_order: number;
}

/** Ligne guichet projetée pour le clonage. */
interface CounterRow {
  id: string;
  number: number;
  label: string;
}

/**
 * Copie les guichets template → cible (statut CLOSED, sans agent/ticket), puis
 * recopie les counter_services en remappant les serviceId via `serviceMap`.
 */
async function cloneCounters(
  db: Client,
  bankId: string,
  templateId: string,
  targetId: string,
  serviceMap: Map<string, string>
): Promise<void> {
  const counters = await db.query(
    `SELECT id, number, label FROM counters
      WHERE bank_id = $1 AND agency_id = $2 ORDER BY number ASC`,
    [bankId, templateId]
  );
  for (const counter of counters.rows as CounterRow[]) {
    const inserted = await db.query(
      `INSERT INTO counters (bank_id, agency_id, number, label, status)
       VALUES ($1, $2, $3, $4, 'CLOSED')
       ON CONFLICT (agency_id, number) DO UPDATE SET label = EXCLUDED.label
       RETURNING id`,
      [bankId, targetId, counter.number, counter.label]
    );
    const targetCounterId = (inserted.rows[0] as { id: string }).id;
    await cloneCounterServices(db, bankId, counter.id, targetCounterId, serviceMap);
  }
}

/** Recopie les liaisons counter_services (remap serviceId source → cible). */
async function cloneCounterServices(
  db: Client,
  bankId: string,
  srcCounterId: string,
  dstCounterId: string,
  serviceMap: Map<string, string>
): Promise<void> {
  const links = await db.query(
    `SELECT service_id FROM counter_services WHERE bank_id = $1 AND counter_id = $2`,
    [bankId, srcCounterId]
  );
  for (const link of links.rows as Array<{ service_id: string }>) {
    const targetServiceId = serviceMap.get(link.service_id);
    if (!targetServiceId) continue;
    await db.query(
      `INSERT INTO counter_services (bank_id, counter_id, service_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (counter_id, service_id) DO NOTHING`,
      [bankId, dstCounterId, targetServiceId]
    );
  }
}

/** Enregistre POST /agencies/:id/kiosk-access + audit. */
function registerKioskAccess(router: Hono<OnboardingEnv>): void {
  router.post("/agencies/:id/kiosk-access", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const agencyId = paramUuid(c, "id");
      assertAgencyScope(tenant, agencyId);
      const bankId = requireBankId(tenant);
      await assertAgencyExists(db, bankId, agencyId);
      const input = parseStrict(kioskAccessSchema, (await parseJson(c)) ?? {});
      const creds = await createKioskAccess({
        db,
        bankId,
        agencyId,
        label: input.label ?? null,
      });
      await recordAudit({
        db,
        tenant,
        action: "POST /agencies/:id/kiosk-access",
        entityType: "kiosk",
        entityId: creds.kioskId,
        ip: extractIp(c),
        diff: buildDiff({}, { kioskId: creds.kioskId }),
      });
      return c.json(creds, 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}
