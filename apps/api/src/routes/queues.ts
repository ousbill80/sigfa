/**
 * Routes de gestion des files d'attente — API-004.
 *
 * PATCH /queues/:id — pause/réouverture d'une file (status).
 *   - File fermée (PAUSED/CLOSED) : émission → 422 QUEUE_PAUSED (géré dans tickets.ts)
 *   - Tickets existants restent servables (call-next fonctionne)
 *   - Réouverture → OPEN, émission reprise
 *
 * @module
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Redis } from "ioredis";
import type { Client } from "pg";
import { SigfaError, buildError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";
import { createNoopBus, type RealtimeBus } from "src/services/realtime.js";
import { queueLength } from "src/services/queue-strategy.js";
import {
  estimateWaitMinutes,
  invalidateEstimate,
} from "src/services/queue-estimation.js";
import { buildDiff } from "src/lib/audit-context.js";
import { withAudit, auditContextFrom } from "src/audit/with-audit.js";

/** Variables de contexte Hono injectées par app.ts. */
interface QueueEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
    bus: RealtimeBus;
  };
}

/** Contexte Hono typé pour ce routeur. */
type QueueCtx = Context<QueueEnv>;

/** Schéma de mise à jour d'une file. */
const patchQueueSchema = z.object({
  status: z.enum(["OPEN", "PAUSED", "CLOSED"]).optional(),
  openAt: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  closeAt: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

/** Regex UUID canonique. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lit et valide un paramètre UUID de chemin. */
function paramUuid(c: QueueCtx, name: string): string {
  const value = c.req.param(name);
  if (!value || !UUID_RE.test(value)) {
    throw new SigfaError("NOT_FOUND", "Ressource introuvable.", 404);
  }
  return value;
}

/** Émet une réponse d'erreur au format LA LOI. */
function errorResponse(c: QueueCtx, err: unknown): Response {
  if (err instanceof SigfaError) {
    return c.json(
      buildError(err.code, err.message, err.details),
      err.httpStatus as 400 | 401 | 403 | 404 | 409 | 422
    );
  }
  throw err;
}

/** Résout le bus depuis le contexte, ou fournit un no-op. */
function getBus(c: QueueCtx): RealtimeBus {
  return (c.get("bus") as RealtimeBus | undefined) ?? createNoopBus();
}

/** Parse le corps JSON, `null` si malformé. */
async function parseJson(c: QueueCtx): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/**
 * Crée le routeur des files d'attente.
 *
 * @returns Routeur Hono monté sous /api/v1
 */
export function createQueueRouter(): Hono<QueueEnv> {
  const router = new Hono<QueueEnv>();
  registerPatchQueue(router);
  return router;
}

/** Ligne brute de la table queues. */
interface QueueRow {
  id: string;
  bank_id: string;
  agency_id: string;
  service_id: string;
  status: string;
  is_open: boolean;
  open_at: string | null;
  close_at: string | null;
}

/** Charge une file dans le scope tenant, ou lève 404. */
async function loadQueue(db: Client, tenant: TenantContext, id: string): Promise<QueueRow> {
  const res = await db.query(
    `SELECT id, bank_id, agency_id, service_id, status, is_open, open_at, close_at
       FROM queues WHERE id = $1 AND bank_id = $2`,
    [id, tenant.bankId]
  );
  const row = res.rows[0] as QueueRow | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "File introuvable.", 404);
  return row;
}

/** Enregistre la route PATCH /queues/:id. */
function registerPatchQueue(router: Hono<QueueEnv>): void {
  router.patch("/queues/:id", async (c) => {
    const tenant = c.get("tenant");
    const db = c.get("db");
    const redis = c.get("redis");
    try {
      const queueId = paramUuid(c, "id");
      const body = await parseJson(c);
      const parsed = patchQueueSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          buildError("VALIDATION_ERROR", "Corps invalide.", { issues: parsed.error.issues }),
          400
        );
      }
      const result = await patchQueue(db, redis, tenant, queueId, parsed.data, getBus(c), auditContextFrom(c));
      return c.json(result, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Données validées de mise à jour. */
type PatchQueueInput = z.infer<typeof patchQueueSchema>;

/**
 * Met à jour le statut d'une file (OPEN/PAUSED/CLOSED).
 * Émet `queue:updated` après toute mutation réussie.
 */
async function patchQueue(
  db: Client,
  redis: Redis,
  tenant: TenantContext,
  queueId: string,
  input: PatchQueueInput,
  bus: RealtimeBus,
  auditCtx: ReturnType<typeof auditContextFrom>
): Promise<Record<string, unknown>> {
  const queue = await loadQueue(db, tenant, queueId);

  const newStatus = input.status ?? queue.status;
  const isOpen = newStatus === "OPEN";

  // SEC-001a : mutation + audit dans UNE transaction (rollback si audit échoue).
  const view = await withAudit(auditCtx, async (tx) => {
    await tx.query(
      `UPDATE queues
          SET status = $1,
              is_open = $2,
              open_at = COALESCE($3, open_at),
              close_at = COALESCE($4, close_at),
              updated_at = NOW()
        WHERE id = $5`,
      [newStatus, isOpen, input.openAt ?? null, input.closeAt ?? null, queueId]
    );
    return {
      result: {
        id: queueId,
        agencyId: queue.agency_id,
        serviceId: queue.service_id,
        status: newStatus,
        ...(input.openAt !== undefined ? { openAt: input.openAt } : {}),
        ...(input.closeAt !== undefined ? { closeAt: input.closeAt } : {}),
      },
      audit: {
        action: "PATCH /queues/:id",
        entityType: "queue",
        entityId: queueId,
        diff: buildDiff(
          { status: queue.status, openAt: queue.open_at, closeAt: queue.close_at },
          { status: newStatus, openAt: input.openAt ?? queue.open_at, closeAt: input.closeAt ?? queue.close_at }
        ),
      },
    };
  });

  await invalidateEstimate(redis, queueId);
  const length = await queueLength(queueId, db);
  const estimate = await estimateWaitMinutes(length, queue.service_id, db);
  bus.emit("queue:updated", queue.agency_id, { queueId, length, estimate });

  return view;
}
