/**
 * Routes agents — API-007 (agents.yaml).
 *
 * GET  /agents/:id         — profil de l'agent (§23, MANAGER+).
 * POST /agents/:id/status  — machine à états de disponibilité (§164, AGENT+ self).
 * GET  /agents/:id/stats   — statistiques de performance (§243, AGENT self / MANAGER+ scope).
 *
 * (POST /agents/import est HORS scope — API-009.)
 *
 * Règle « self » (§164, §243) : un AGENT n'agit/ne lit QUE ses propres données ;
 * MANAGER+ agit/lit dans son scope d'agence. Le RBAC de route autorise AGENT ;
 * la restriction fine self-vs-scope est appliquée ici.
 *
 * ## Sécurité (SEC-002-CUTOVER-LOT5)
 * TOUT accès DB tenant est routé via `withArmedTenant` (contexte RLS
 * `app.current_bank_id` armé sur la connexion `sigfa_app` NOBYPASSRLS) → cette route
 * est classée **ARMED** dans `tenant-armament-arch.test.ts`. Tables `users` /
 * `agency_users` / `user_services` / `services` / `agencies` / `agent_status_history`
 * (policy `tenant_isolation` + GRANT CRUD `sigfa_app`, 0001) : lecture de scope,
 * mutations de profil, transitions de statut et audit composé SEC-001 (savepoint)
 * s'exécutent dans UNE transaction armée. La lecture (GET profil/stats) partage la
 * même connexion armée le temps de la requête.
 *
 * @module
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { SigfaError, buildError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";
import { createNoopBus, type RealtimeBus } from "src/services/realtime.js";
import {
  changeAgentStatus,
  getCurrentStatus,
  type AgentStatus,
} from "src/services/agent-status.js";
import { computeAgentStats, type StatsPeriod } from "src/services/agent-stats.js";
import { buildDiff, extractIp } from "src/lib/audit-context.js";
import {
  withAudit,
  type AuditRequestContext,
} from "src/audit/with-audit.js";
import { parseStrict } from "src/lib/admin-helpers.js";
import { safeText } from "src/lib/safe-text.js";
import {
  withArmedTenant,
  asArmable,
  isCanonicalUuid,
} from "src/lib/armed-tenant.js";

/** Variables de contexte Hono du routeur agents (bus injecté par app.ts). */
interface AgentEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
    bus: RealtimeBus;
  };
}

/** Rôles considérés « manager et plus » (lecture/écriture dans le scope agence). */
const MANAGER_PLUS = new Set([
  "MANAGER",
  "AGENCY_DIRECTOR",
  "BANK_ADMIN",
  "SUPER_ADMIN",
]);

/** Regex UUID canonique pour valider les paramètres de chemin. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Contexte Hono typé pour ce routeur. */
type AgentCtx = Context<AgentEnv>;

/** Corps de POST /agents/:id/status (LA LOI UpdateAgentStatusRequest). */
const statusSchema = z.object({
  status: z.enum(["AVAILABLE", "SERVING", "PAUSED", "ABSENT", "OFFLINE"]),
  reason: safeText().max(255).nullish(),
});

/** Query de GET /agents/:id/stats. */
const periodSchema = z.enum(["day", "week", "month"]).default("day");

/** Schéma d'un jour de travail (LA LOI WorkSchedule DaySchedule). */
const workDaySchema = z
  .object({
    start: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/),
    end: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/),
  })
  .strict();

/** WorkSchedule hebdomadaire (LA LOI, additionalProperties: false). */
const workScheduleSchema = z
  .object(
    Object.fromEntries(
      ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(
        (d) => [d, workDaySchema.optional()]
      )
    )
  )
  .strict();

/** Corps de PATCH /agents/:id (LA LOI UpdateAgentProfileRequest). */
const updateProfileSchema = z
  .object({
    // Décision PO 2026-07 : DIOULA et BAOULE retirés (LA LOI AgentLanguage v2).
    languages: z.array(z.enum(["FR", "EN"])).min(1).optional(),
    serviceIds: z.array(z.string().uuid()).optional(),
    agencyIds: z.array(z.string().uuid()).optional(),
    workSchedule: workScheduleSchema.optional(),
    phoneMasked: safeText().optional(),
    /** Marquage conseiller (MODEL-API-B/D5) — RBAC AGENCY_DIRECTOR (route). */
    isRelationshipManager: z.boolean().optional(),
    displayName: safeText().max(255).nullish(),
    photoUrl: z.string().url().max(2048).nullish(),
  })
  .strict();

/**
 * Crée le routeur agents (monté sous /api/v1).
 *
 * @returns Routeur Hono des routes agents API-007
 */
export function createAgentRouter(): Hono<AgentEnv> {
  const router = new Hono<AgentEnv>();
  registerGetProfile(router);
  registerPatchProfile(router);
  registerPostStatus(router);
  registerGetStats(router);
  return router;
}

/** Résout le bus depuis le contexte, ou fournit un no-op validant. */
function getBus(c: AgentCtx): RealtimeBus {
  return (c.get("bus") as RealtimeBus | undefined) ?? createNoopBus();
}

/** Lit et valide un paramètre de chemin UUID, sinon 404. */
function paramUuid(c: AgentCtx, name: string): string {
  const value = c.req.param(name);
  if (!value || !UUID_RE.test(value)) {
    throw new SigfaError("NOT_FOUND", "Ressource introuvable.", 404);
  }
  return value;
}

/** Émet une réponse d'erreur SigfaError au format LA LOI. */
function errorResponse(c: AgentCtx, err: unknown): Response {
  if (err instanceof SigfaError) {
    return c.json(
      buildError(err.code, err.message, err.details),
      err.httpStatus as 400 | 401 | 403 | 404 | 409 | 422
    );
  }
  throw err;
}

/**
 * Applique la règle « self / scope » : un AGENT ne peut cibler que lui-même ;
 * MANAGER+ peut cibler tout agent de son scope d'agence.
 *
 * @param db      - Connexion PG
 * @param tenant  - Contexte tenant courant
 * @param agentId - Agent ciblé par la requête
 * @throws {SigfaError} 403 FORBIDDEN si un AGENT cible un autre agent ;
 *                      404 NOT_FOUND si l'agent est hors du scope tenant.
 */
async function assertSelfOrScope(
  db: Client,
  tenant: TenantContext,
  agentId: string
): Promise<void> {
  const isManagerPlus = MANAGER_PLUS.has(tenant.role);
  if (!isManagerPlus) {
    if (agentId !== tenant.userId) {
      throw new SigfaError(
        "FORBIDDEN",
        "Un agent ne peut accéder qu'à ses propres données.",
        403
      );
    }
    return;
  }
  await assertAgentInTenantScope(db, tenant, agentId);
}

/**
 * Vérifie que l'agent cible appartient au tenant (banque) et, pour un rôle
 * agence, à une agence du scope JWT. Sinon 404 (ne révèle pas l'existence).
 */
async function assertAgentInTenantScope(
  db: Client,
  tenant: TenantContext,
  agentId: string
): Promise<void> {
  if (tenant.role === "SUPER_ADMIN") return;
  const res = await db.query(
    `SELECT au.agency_id
       FROM users u
       LEFT JOIN agency_users au ON au.user_id = u.id
      WHERE u.id = $1 AND u.bank_id = $2`,
    [agentId, tenant.bankId]
  );
  if (res.rows.length === 0) {
    throw new SigfaError("NOT_FOUND", "Agent introuvable.", 404);
  }
  const agencyIds = (res.rows as Array<{ agency_id: string | null }>)
    .map((r) => r.agency_id)
    .filter((a): a is string => a !== null);
  const inScope =
    tenant.agencyIds.length === 0 ||
    agencyIds.some((a) => tenant.agencyIds.includes(a));
  if (!inScope) {
    throw new SigfaError("NOT_FOUND", "Agent introuvable.", 404);
  }
}

// ── GET /agents/:id — profil (§23) ───────────────────────────────────────────

/** Enregistre GET /agents/:id (profil complet). */
function registerGetProfile(router: Hono<AgentEnv>): void {
  router.get("/agents/:id", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const agentId = paramUuid(c, "id");
      const bankId = requireArmableBankId(tenant);
      // SEC-002 : lecture de scope + chargement du profil dans UNE transaction
      // ARMÉE (RLS `app.current_bank_id` contraignante en défense-en-profondeur).
      const profile = await withArmedTenant(asArmable(db), bankId, async (conn) => {
        const armed = conn as unknown as Client;
        await assertAgentInTenantScope(armed, tenant, agentId);
        return loadAgentProfile(armed, tenant, agentId);
      });
      return c.json(profile, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Charge et compose le profil agent (LA LOI AgentProfile). */
async function loadAgentProfile(
  db: Client,
  tenant: TenantContext,
  agentId: string
): Promise<Record<string, unknown>> {
  const res = await db.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.bank_id,
            u.languages::text[] AS languages, u.work_schedule, u.is_relationship_manager, u.display_name,
            u.photo_url, u.created_at
       FROM users u
      WHERE u.id = $1 AND u.bank_id = $2`,
    [agentId, tenant.bankId]
  );
  const row = res.rows[0] as
    | {
        id: string;
        email: string;
        first_name: string;
        last_name: string;
        role: string;
        bank_id: string;
        languages: string[];
        work_schedule: unknown;
        is_relationship_manager: boolean;
        display_name: string | null;
        photo_url: string | null;
        created_at: Date;
      }
    | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Agent introuvable.", 404);

  const agencies = await listAgencyIds(db, agentId);
  const services = await listServiceIds(db, agentId);
  const status = await getCurrentStatus(db, agentId);

  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
    bankId: row.bank_id,
    agencyId: agencies[0] ?? row.bank_id,
    status,
    languages: row.languages.length > 0 ? row.languages : ["FR"],
    serviceIds: services,
    agencyIds: agencies,
    isRelationshipManager: row.is_relationship_manager,
    ...(row.display_name !== null ? { displayName: row.display_name } : {}),
    ...(row.photo_url !== null ? { photoUrl: row.photo_url } : {}),
    ...(row.work_schedule ? { workSchedule: row.work_schedule } : {}),
    createdAt: row.created_at.toISOString(),
  };
}

/** Liste les agences d'affectation d'un agent. */
async function listAgencyIds(db: Client, agentId: string): Promise<string[]> {
  const res = await db.query(
    `SELECT agency_id FROM agency_users WHERE user_id = $1 ORDER BY created_at ASC`,
    [agentId]
  );
  return (res.rows as Array<{ agency_id: string }>).map((r) => r.agency_id);
}

/** Liste les services traitables d'un agent. */
async function listServiceIds(db: Client, agentId: string): Promise<string[]> {
  const res = await db.query(
    `SELECT service_id FROM user_services WHERE user_id = $1 ORDER BY created_at ASC`,
    [agentId]
  );
  return (res.rows as Array<{ service_id: string }>).map((r) => r.service_id);
}

// ── PATCH /agents/:id — profil (services, langues, agences, horaires) ────────

/** Enregistre PATCH /agents/:id (merge partiel du profil) + audit. */
function registerPatchProfile(router: Hono<AgentEnv>): void {
  router.patch("/agents/:id", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const agentId = paramUuid(c, "id");
      const input = parseStrict(updateProfileSchema, await parseJson(c));
      const bankId = requireArmableBankId(tenant);
      const ip = extractIp(c);
      // SEC-002 : lecture de scope + before/after + mutation + audit (savepoint)
      // dans UNE transaction ARMÉE. `withAudit(inTransaction:true)` compose par
      // SAVEPOINT : la mutation et l'insert d'audit héritent du contexte RLS
      // `app.current_bank_id` et committent atomiquement une seule fois.
      const after = await withArmedTenant(asArmable(db), bankId, async (conn) => {
        const armed = conn as unknown as Client;
        await assertAgentInTenantScope(armed, tenant, agentId);
        const before = await loadAgentProfile(armed, tenant, agentId);
        const auditCtx: AuditRequestContext = {
          db: armed,
          tenant,
          ip,
          inTransaction: true,
        };
        return withAudit(auditCtx, async (tx) => {
          await applyProfileUpdate(tx, tenant, agentId, input);
          const updated = await loadAgentProfile(tx, tenant, agentId);
          return {
            result: updated,
            audit: {
              action: "PATCH /agents/:id",
              entityType: "user",
              entityId: agentId,
              diff: buildDiff(
                {
                  languages: before["languages"], serviceIds: before["serviceIds"], agencyIds: before["agencyIds"],
                  workSchedule: before["workSchedule"], isRelationshipManager: before["isRelationshipManager"],
                  displayName: before["displayName"], photoUrl: before["photoUrl"],
                },
                {
                  languages: updated["languages"], serviceIds: updated["serviceIds"], agencyIds: updated["agencyIds"],
                  workSchedule: updated["workSchedule"], isRelationshipManager: updated["isRelationshipManager"],
                  displayName: updated["displayName"], photoUrl: updated["photoUrl"],
                }
              ),
            },
          };
        });
      });
      return c.json(after, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/**
 * Applique un merge partiel du profil : langues/horaires en place, services et
 * agences remplacés (liste complète) quand fournis. Chaque set fourni est réécrit.
 */
async function applyProfileUpdate(
  db: Client,
  tenant: TenantContext,
  agentId: string,
  input: z.infer<typeof updateProfileSchema>
): Promise<void> {
  const bankId = requireArmableBankId(tenant);
  if (input.languages !== undefined || input.workSchedule !== undefined) {
    await db.query(
      `UPDATE users
          SET languages = COALESCE($3::agent_language[], languages),
              work_schedule = COALESCE($4::jsonb, work_schedule),
              updated_at = NOW()
        WHERE id=$1 AND bank_id=$2`,
      [agentId, bankId, input.languages ?? null, input.workSchedule ? JSON.stringify(input.workSchedule) : null]
    );
  }
  // MODEL-API-B/D5 : marquage conseiller (chaque champ appliqué s'il est FOURNI).
  if (
    input.isRelationshipManager !== undefined ||
    input.displayName !== undefined ||
    input.photoUrl !== undefined
  ) {
    await db.query(
      `UPDATE users
          SET is_relationship_manager = CASE WHEN $3::boolean IS NULL THEN is_relationship_manager ELSE $3 END,
              display_name = CASE WHEN $4::boolean THEN $5 ELSE display_name END,
              photo_url    = CASE WHEN $6::boolean THEN $7 ELSE photo_url END,
              updated_at = NOW()
        WHERE id=$1 AND bank_id=$2`,
      [
        agentId,
        bankId,
        input.isRelationshipManager ?? null,
        input.displayName !== undefined,
        input.displayName ?? null,
        input.photoUrl !== undefined,
        input.photoUrl ?? null,
      ]
    );
  }
  if (input.serviceIds !== undefined) {
    await replaceUserServices(db, bankId, agentId, input.serviceIds);
  }
  if (input.agencyIds !== undefined) {
    await replaceAgencyUsers(db, bankId, agentId, input.agencyIds);
  }
}

/** Remplace les compétences service d'un agent (valide l'appartenance tenant). */
async function replaceUserServices(
  db: Client,
  bankId: string,
  agentId: string,
  serviceIds: string[]
): Promise<void> {
  await db.query(`DELETE FROM user_services WHERE user_id=$1 AND bank_id=$2`, [agentId, bankId]);
  for (const serviceId of serviceIds) {
    const ok = await db.query(
      `SELECT 1 FROM services WHERE id=$1 AND bank_id=$2 AND deleted_at IS NULL`,
      [serviceId, bankId]
    );
    if (ok.rows.length === 0) {
      throw new SigfaError("UNPROCESSABLE_ENTITY", "Service inconnu pour cet agent.", 422, { serviceId });
    }
    await db.query(
      `INSERT INTO user_services (bank_id, user_id, service_id) VALUES ($1,$2,$3)`,
      [bankId, agentId, serviceId]
    );
  }
}

/** Remplace les affectations d'agence d'un agent (valide l'appartenance tenant). */
async function replaceAgencyUsers(
  db: Client,
  bankId: string,
  agentId: string,
  agencyIds: string[]
): Promise<void> {
  await db.query(`DELETE FROM agency_users WHERE user_id=$1 AND bank_id=$2`, [agentId, bankId]);
  for (const agencyId of agencyIds) {
    const ok = await db.query(
      `SELECT 1 FROM agencies WHERE id=$1 AND bank_id=$2 AND deleted_at IS NULL`,
      [agencyId, bankId]
    );
    if (ok.rows.length === 0) {
      throw new SigfaError("UNPROCESSABLE_ENTITY", "Agence inconnue pour cet agent.", 422, { agencyId });
    }
    await db.query(
      `INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3)`,
      [bankId, agencyId, agentId]
    );
  }
}

// ── POST /agents/:id/status — machine à états (§164) ─────────────────────────

/** Enregistre POST /agents/:id/status. */
function registerPostStatus(router: Hono<AgentEnv>): void {
  router.post("/agents/:id/status", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const agentId = paramUuid(c, "id");
      const parsed = statusSchema.safeParse(await parseJson(c));
      if (!parsed.success) {
        return c.json(
          buildError("VALIDATION_ERROR", "Corps invalide.", {
            issues: parsed.error.issues,
          }),
          400
        );
      }
      const bankId = requireArmableBankId(tenant);
      const ip = extractIp(c);
      // SEC-002 : garde self/scope + changement de statut + audit dans UNE
      // transaction ARMÉE. `withAudit(inTransaction:true)` compose par SAVEPOINT
      // sous le contexte RLS `app.current_bank_id` : un échec d'audit rollback
      // l'écriture d'agent_status_history (pas de best-effort), RLS armée AVANT.
      const result = await withArmedTenant(asArmable(db), bankId, async (conn) => {
        const armed = conn as unknown as Client;
        await assertSelfOrScope(armed, tenant, agentId);
        const auditCtx: AuditRequestContext = {
          db: armed,
          tenant,
          ip,
          inTransaction: true,
        };
        return withAudit(auditCtx, async (tx) => {
          const changed = await changeAgentStatus({
            db: tx,
            bus: getBus(c),
            bankId,
            agentId,
            target: parsed.data.status as AgentStatus,
          });
          return {
            result: changed,
            audit: {
              action: "POST /agents/:id/status",
              entityType: "user",
              entityId: agentId,
              diff: buildDiff(
                { status: changed.previousStatus },
                { status: changed.status }
              ),
            },
          };
        });
      });
      return c.json(result, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

// ── GET /agents/:id/stats — statistiques (§243) ──────────────────────────────

/** Enregistre GET /agents/:id/stats. */
function registerGetStats(router: Hono<AgentEnv>): void {
  router.get("/agents/:id/stats", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const agentId = paramUuid(c, "id");
      const parsedPeriod = periodSchema.safeParse(
        c.req.query("period") ?? "day"
      );
      if (!parsedPeriod.success) {
        return c.json(
          buildError("VALIDATION_ERROR", "Paramètre period invalide."),
          400
        );
      }
      const bankId = requireArmableBankId(tenant);
      // SEC-002 : garde self/scope + calcul des stats dans UNE transaction ARMÉE
      // (RLS `app.current_bank_id` contraignante — lecture tenant isolée).
      const stats = await withArmedTenant(asArmable(db), bankId, async (conn) => {
        const armed = conn as unknown as Client;
        await assertSelfOrScope(armed, tenant, agentId);
        return computeAgentStats(
          armed,
          agentId,
          bankId,
          parsedPeriod.data as StatsPeriod
        );
      });
      return c.json(stats, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Parse le corps JSON, `null` si malformé. */
async function parseJson(c: AgentCtx): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/**
 * Exige un `bankId` tenant en UUID canonique pour l'armement RLS (SEC-002).
 * Absent (contexte plateforme) ou malformé → 403 : une route tenant ne s'arme
 * jamais sans banque résolue (le `bank_id` est interpolé dans `SET LOCAL`).
 *
 * @param tenant - Contexte tenant résolu
 * @throws {SigfaError} 403 FORBIDDEN si `bankId` absent/non-UUID
 */
function requireArmableBankId(tenant: TenantContext): string {
  const bankId = tenant.bankId;
  if (!bankId || !isCanonicalUuid(bankId)) {
    throw new SigfaError(
      "FORBIDDEN",
      "Contexte de banque requis pour cette opération.",
      403
    );
  }
  return bankId;
}
