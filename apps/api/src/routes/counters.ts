/**
 * Routes guichets — API-008 (core.yaml).
 *
 * - GET   /counters      — liste des guichets d'une agence (agency, MANAGER).
 * - POST  /counters      — création + services couverts (agency, AGENCY_DIRECTOR) + audit.
 * - PATCH /counters/:id  — merge statut/agent/services (agency, MANAGER) + audit.
 *
 * `counter_services` (n-n) reflète les `serviceIds` fournis. Le `number` du guichet
 * est auto-attribué (max+1 par agence). L'agence cible provient de `?agencyId=`
 * (list/create) ou de la ligne du guichet (patch), validée contre le scope JWT.
 *
 * @module
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { SigfaError } from "src/lib/errors.js";
import { safeText } from "src/lib/safe-text.js";
import type { TenantContext } from "src/middleware/tenant.js";
import {
  paramUuid,
  errorResponse,
  parseJson,
  parseStrict,
  readPagination,
  requireBankId,
  assertAgencyScope,
  UUID_RE,
} from "src/lib/admin-helpers.js";
import { recordAudit, buildDiff, extractIp } from "src/lib/audit-context.js";

/** Variables de contexte Hono du routeur guichets. */
interface CounterEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/** Contexte Hono typé. */
type CounterCtx = Context<CounterEnv>;

/** Corps de POST /counters (LA LOI CreateCounterRequest). */
const createCounterSchema = z
  .object({
    label: safeText().min(1),
    serviceIds: z.array(z.string().uuid()).optional(),
  })
  .strict();

/** Corps de PATCH /counters/:id (LA LOI UpdateCounterRequest). */
const updateCounterSchema = z
  .object({
    status: z.enum(["OPEN", "PAUSED", "CLOSED"]).optional(),
    agentId: z.string().uuid().optional(),
    serviceIds: z.array(z.string().uuid()).optional(),
  })
  .strict();

/** Ligne brute de la table `counters`. */
interface CounterRow {
  id: string;
  bank_id: string;
  agency_id: string;
  label: string;
  status: string;
  agent_id: string | null;
}

/**
 * Crée le routeur guichets (monté sous /api/v1).
 *
 * @returns Routeur Hono des routes guichets API-008
 */
export function createCounterRouter(): Hono<CounterEnv> {
  const router = new Hono<CounterEnv>();
  registerListCounters(router);
  registerCreateCounter(router);
  registerPatchCounter(router);
  return router;
}

/** Projette une ligne `counters` vers la ressource `Counter` de LA LOI. */
function toCounter(row: CounterRow): Record<string, unknown> {
  return {
    id: row.id,
    label: row.label,
    agencyId: row.agency_id,
    status: row.status,
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
  };
}

/** Colonnes projetées. */
const CTR_COLS = "id, bank_id, agency_id, label, status, agent_id";

/** Résout l'agence cible depuis `?agencyId=` et la valide contre le scope. */
function requireAgencyId(c: CounterCtx, tenant: TenantContext): string {
  const agencyId = c.req.query("agencyId");
  if (!agencyId || !UUID_RE.test(agencyId)) {
    throw new SigfaError("VALIDATION_ERROR", "agencyId requis.", 400);
  }
  assertAgencyScope(tenant, agencyId);
  return agencyId;
}

/** Enregistre GET /counters. */
function registerListCounters(router: Hono<CounterEnv>): void {
  router.get("/counters", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const bankId = requireBankId(tenant);
      const agencyId = requireAgencyId(c, tenant);
      const { page, limit, offset } = readPagination(c);
      const res = await db.query(
        `SELECT ${CTR_COLS} FROM counters
          WHERE bank_id=$1 AND agency_id=$2
          ORDER BY number ASC LIMIT $3 OFFSET $4`,
        [bankId, agencyId, limit, offset]
      );
      const count = await db.query(
        `SELECT COUNT(*)::int AS total FROM counters WHERE bank_id=$1 AND agency_id=$2`,
        [bankId, agencyId]
      );
      return c.json(
        {
          data: (res.rows as CounterRow[]).map(toCounter),
          meta: { page, limit, total: (count.rows[0] as { total: number }).total },
        },
        200
      );
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Enregistre POST /counters + counter_services + audit. */
function registerCreateCounter(router: Hono<CounterEnv>): void {
  router.post("/counters", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const bankId = requireBankId(tenant);
      const agencyId = requireAgencyId(c, tenant);
      const input = parseStrict(createCounterSchema, await parseJson(c));
      const created = await insertCounter(db, bankId, agencyId, input);
      await syncCounterServices(db, bankId, created.id, input.serviceIds ?? []);
      await recordAudit({
        db,
        tenant,
        action: "POST /counters",
        entityType: "counter",
        entityId: created.id,
        ip: extractIp(c),
        diff: buildDiff({}, { label: created.label, serviceIds: input.serviceIds ?? [] }),
      });
      return c.json(toCounter(created), 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Insère un guichet avec numéro auto-attribué (max+1 par agence). */
async function insertCounter(
  db: Client,
  bankId: string,
  agencyId: string,
  input: z.infer<typeof createCounterSchema>
): Promise<CounterRow> {
  const res = await db.query(
    `INSERT INTO counters (bank_id, agency_id, number, label, status)
     VALUES ($1, $2,
       (SELECT COALESCE(MAX(number),0)+1 FROM counters WHERE agency_id=$2),
       $3, 'OPEN')
     RETURNING ${CTR_COLS}`,
    [bankId, agencyId, input.label]
  );
  return res.rows[0] as CounterRow;
}

/**
 * Remplace l'ensemble des services couverts par un guichet (idempotent).
 * Vérifie que chaque service appartient au tenant, sinon 422.
 */
async function syncCounterServices(
  db: Client,
  bankId: string,
  counterId: string,
  serviceIds: string[]
): Promise<void> {
  await db.query(`DELETE FROM counter_services WHERE counter_id=$1 AND bank_id=$2`, [counterId, bankId]);
  for (const serviceId of serviceIds) {
    const ok = await db.query(
      `SELECT 1 FROM services WHERE id=$1 AND bank_id=$2 AND deleted_at IS NULL`,
      [serviceId, bankId]
    );
    if (ok.rows.length === 0) {
      throw new SigfaError("UNPROCESSABLE_ENTITY", "Service inconnu pour ce guichet.", 422, { serviceId });
    }
    await db.query(
      `INSERT INTO counter_services (bank_id, counter_id, service_id) VALUES ($1,$2,$3)`,
      [bankId, counterId, serviceId]
    );
  }
}

/** Charge un guichet du tenant, ou 404. */
async function loadCounter(db: Client, bankId: string, id: string): Promise<CounterRow> {
  const res = await db.query(
    `SELECT ${CTR_COLS} FROM counters WHERE id=$1 AND bank_id=$2`,
    [id, bankId]
  );
  const row = res.rows[0] as CounterRow | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Guichet introuvable.", 404);
  return row;
}

/** Enregistre PATCH /counters/:id (merge partiel) + audit. */
function registerPatchCounter(router: Hono<CounterEnv>): void {
  router.patch("/counters/:id", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const id = paramUuid(c, "id");
      const bankId = requireBankId(tenant);
      const before = await loadCounter(db, bankId, id);
      assertAgencyScope(tenant, before.agency_id);
      const input = parseStrict(updateCounterSchema, await parseJson(c));
      const after = await updateCounter(db, bankId, id, input);
      if (input.serviceIds !== undefined) {
        await syncCounterServices(db, bankId, id, input.serviceIds);
      }
      await recordAudit({
        db,
        tenant,
        action: "PATCH /counters/:id",
        entityType: "counter",
        entityId: id,
        ip: extractIp(c),
        diff: buildDiff(
          { status: before.status, agentId: before.agent_id },
          { status: after.status, agentId: after.agent_id }
        ),
      });
      return c.json(toCounter(after), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Applique un merge partiel (statut/agent). */
async function updateCounter(
  db: Client,
  bankId: string,
  id: string,
  input: z.infer<typeof updateCounterSchema>
): Promise<CounterRow> {
  const res = await db.query(
    `UPDATE counters
        SET status = COALESCE($3, status),
            agent_id = COALESCE($4, agent_id),
            updated_at = NOW()
      WHERE id=$1 AND bank_id=$2
      RETURNING ${CTR_COLS}`,
    [id, bankId, input.status ?? null, input.agentId ?? null]
  );
  const row = res.rows[0] as CounterRow | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Guichet introuvable.", 404);
  return row;
}
