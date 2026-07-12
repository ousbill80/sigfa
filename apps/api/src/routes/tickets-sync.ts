/**
 * Route de synchronisation offline — API-005.
 *
 * POST /tickets/sync — batch borné (≤100) idempotent de tickets créés hors-ligne.
 *
 * LA LOI (core.yaml, `POST /tickets/sync`) :
 *   - Requête `TicketSyncRequest` = `{ tickets: TicketSyncItem[] }` (1..100).
 *   - `TicketSyncItem` (additionalProperties:false) = `{ localUuid, serviceId,
 *     channel, createdOfflineAt, priority? }`.
 *   - Réponse 200 = `{ synced: {localUuid, serverId, number}[],
 *     skipped: {localUuid, reason}[] }`.
 *   - `X-Idempotency-Key` obligatoire (400 / 409) ; batch >100 → 422 BATCH_TOO_LARGE.
 *
 * Idempotence unitaire par `localUuid` (contrainte DB unique + ON CONFLICT).
 * Transaction PAR TICKET : un échec isolé → skipped, le reste passe.
 * Un `queue:updated` par file affectée ; un `alert:manager` KIOSK_SYSTEM_ERROR
 * par batch dès qu'au moins une ligne est skipped.
 *
 * @module
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Redis } from "ioredis";
import type { Client } from "pg";
import { nanoid } from "nanoid";
import { SigfaError, buildError } from "src/lib/errors.js";
import { logger } from "src/lib/logger.js";
import type { TenantContext } from "src/middleware/tenant.js";
import {
  requireIdempotencyKey,
  findReplay,
  storeReplay,
} from "src/services/idempotency.js";
import { createNoopBus, type RealtimeBus } from "src/services/realtime.js";
import { queueLength } from "src/services/queue-strategy.js";
import { estimateWaitMinutes, invalidateEstimate } from "src/services/queue-estimation.js";

/** Nombre maximum de tickets par batch de synchronisation (LA LOI). */
const MAX_BATCH = 100;
/** Dérive d'horloge tolérée avant de marquer CLOCK_SKEW (millisecondes). */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Variables de contexte Hono injectées par app.ts. */
interface SyncEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
    bus: RealtimeBus;
  };
}

/** Contexte Hono typé pour ce routeur. */
type SyncCtx = Context<SyncEnv>;

/** Schéma d'un item de sync — STRICT (additionalProperties:false du contrat). */
const syncItemSchema = z
  .object({
    localUuid: z.string().uuid(),
    serviceId: z.string().uuid(),
    operationId: z.string().uuid().optional(),
    targetManagerId: z.string().uuid().optional(),
    channel: z.enum(["KIOSK", "QR", "MOBILE", "WHATSAPP"]),
    createdOfflineAt: z.string().datetime(),
    priority: z.enum(["STANDARD", "PRIORITY", "VIP", "PMR", "SENIOR"]).optional(),
  })
  .strict();

/** Schéma de la requête de sync (minItems 1 — la borne 100 est vérifiée à part). */
const syncRequestSchema = z.object({
  tickets: z.array(syncItemSchema).min(1),
});

/** Item validé de sync. */
type SyncItem = z.infer<typeof syncItemSchema>;
/** Ligne synchronisée (LA LOI : localUuid, serverId, number). */
interface SyncedTicket { localUuid: string; serverId: string; number: string; }
/** Ligne ignorée (LA LOI : localUuid, reason). */
interface SkippedTicket { localUuid: string; reason: string; }

/** Parse le corps JSON, `null` si malformé. */
async function parseJson(c: SyncCtx): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/** Résout le bus depuis le contexte, ou fournit un no-op validant. */
function getBus(c: SyncCtx): RealtimeBus {
  return (c.get("bus") as RealtimeBus | undefined) ?? createNoopBus();
}

/** Émet une réponse d'erreur SigfaError au format LA LOI. */
function errorResponse(c: SyncCtx, err: unknown): Response {
  if (err instanceof SigfaError) {
    return c.json(
      buildError(err.code, err.message, err.details),
      err.httpStatus as 400 | 401 | 403 | 404 | 409 | 422
    );
  }
  throw err;
}

/**
 * Crée le routeur de synchronisation offline (monté sous /api/v1).
 * @returns Routeur Hono exposant POST /tickets/sync
 */
export function createTicketSyncRouter(): Hono<SyncEnv> {
  const router = new Hono<SyncEnv>();
  router.post("/tickets/sync", handleSync);
  return router;
}

/** Handler principal de POST /tickets/sync. */
async function handleSync(c: SyncCtx): Promise<Response> {
  const tenant = c.get("tenant");
  const db = c.get("db");
  const redis = c.get("redis");
  try {
    const key = requireIdempotencyKey(c.req.header("X-Idempotency-Key"));
    const body = await parseJson(c);
    assertBatchSize(body);
    const parsed = syncRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(buildError("VALIDATION_ERROR", "Corps invalide.", { issues: parsed.error.issues }), 400);
    }
    const scope = `tickets-sync:${tenant.bankId ?? "_"}`;
    const replay = await findReplay(redis, scope, key, parsed.data);
    if (replay) return c.newResponse(replay.body, replay.status as 200, { "Content-Type": "application/json" });
    const result = await processBatch(db, redis, tenant, parsed.data.tickets, getBus(c));
    const bodyStr = JSON.stringify(result);
    await storeReplay(redis, scope, key, parsed.data, 200, bodyStr);
    return c.newResponse(bodyStr, 200, { "Content-Type": "application/json" });
  } catch (err) {
    return errorResponse(c, err);
  }
}

/**
 * Vérifie la borne 100 AVANT la validation Zod → 422 BATCH_TOO_LARGE.
 * @throws {SigfaError} 422 BATCH_TOO_LARGE si le batch dépasse la limite
 */
function assertBatchSize(body: unknown): void {
  const tickets = (body as { tickets?: unknown })?.tickets;
  if (Array.isArray(tickets) && tickets.length > MAX_BATCH) {
    throw new SigfaError("BATCH_TOO_LARGE", "Le batch dépasse la limite de 100 tickets par synchronisation.", 422, {
      maxItems: MAX_BATCH,
      receivedItems: tickets.length,
    });
  }
}

/**
 * Traite le batch ticket-par-ticket dans l'ordre `createdOfflineAt` croissant,
 * puis émet les événements agrégés (queue:updated par file, alerte par batch).
 */
async function processBatch(
  db: Client,
  redis: Redis,
  tenant: TenantContext,
  tickets: SyncItem[],
  bus: RealtimeBus
): Promise<{ synced: SyncedTicket[]; skipped: SkippedTicket[] }> {
  const ordered = [...tickets].sort((a, b) => a.createdOfflineAt.localeCompare(b.createdOfflineAt));
  const synced: SyncedTicket[] = [];
  const skipped: SkippedTicket[] = [];
  const affectedQueues = new Set<string>();
  for (const it of ordered) {
    const outcome = await syncOne(db, tenant, it);
    if (outcome.kind === "synced") {
      synced.push(outcome.ticket);
      affectedQueues.add(outcome.queueId);
    } else {
      skipped.push(outcome.ticket);
    }
  }
  await emitAffectedQueues(bus, redis, db, affectedQueues);
  // Toutes les files du batch sont dans l'agence du scope tenant (resolveQueue
  // borne sur tenant.agencyIds[0]) → agencyId de l'alerte = ce scope.
  emitSkipAlert(bus, tenant.agencyIds[0] ?? "", skipped);
  return { synced, skipped };
}

/** Résultat du traitement d'un item : synchronisé (avec sa file) ou ignoré. */
type Outcome =
  | { kind: "synced"; ticket: SyncedTicket; queueId: string }
  | { kind: "skipped"; ticket: SkippedTicket };

/**
 * Traite un item : filtres (CLOCK_SKEW, SERVICE_NOT_FOUND, ALREADY_SYNCED)
 * puis insertion transactionnelle idempotente. Échec isolé → skipped, journalisé.
 */
async function syncOne(db: Client, tenant: TenantContext, it: SyncItem): Promise<Outcome> {
  if (isClockSkewed(it.createdOfflineAt)) return skip(it.localUuid, "CLOCK_SKEW");
  // MODEL-API-A/D1 (offline-sync D8) : operationId optionnel/item → service_id dérivé.
  const resolved = await resolveOperation(db, tenant, it);
  if (resolved.kind === "skip") return skip(it.localUuid, resolved.reason);
  // MODEL-API-B/D6 : conseiller ciblé optionnel → skip RELATIONSHIP_MANAGER_NOT_FOUND si invalide.
  const manager = await resolveTargetManager(db, tenant, it.targetManagerId);
  if (manager.kind === "skip") return skip(it.localUuid, manager.reason);
  const queue = await resolveQueue(db, tenant, resolved.serviceId);
  if (!queue) return skip(it.localUuid, "SERVICE_NOT_FOUND");
  try {
    return await insertSynced(db, tenant, it, queue, resolved.serviceId, resolved.operationId, manager.targetManagerId);
  } catch (err) {
    logger.error({ localUuid: it.localUuid, err }, "sync:ticket-failed");
    return skip(it.localUuid, "SYNC_ERROR");
  }
}

/**
 * Résout l'opération d'un item sync (MODEL-API-A/D1). `operationId` absent →
 * `serviceId` tel quel. `operationId` fourni : opération active dans le scope
 * agence, `service_id` dérivé ; opération inconnue/inactive/hors agence →
 * skip `OPERATION_NOT_FOUND` ; incohérence avec `serviceId` → skip
 * `SERVICE_OPERATION_MISMATCH` (un item fautif est ignoré, le reste passe).
 */
async function resolveOperation(
  db: Client,
  tenant: TenantContext,
  it: SyncItem
): Promise<
  | { kind: "ok"; serviceId: string; operationId: string | null }
  | { kind: "skip"; reason: string }
> {
  if (!it.operationId) return { kind: "ok", serviceId: it.serviceId, operationId: null };
  const agencyId = tenant.agencyIds[0];
  if (!agencyId) return { kind: "skip", reason: "OPERATION_NOT_FOUND" };
  const res = await db.query(
    `SELECT id, service_id FROM operations
      WHERE id = $1 AND agency_id = $2 AND bank_id = $3 AND is_active = true`,
    [it.operationId, agencyId, tenant.bankId]
  );
  const row = res.rows[0] as { id: string; service_id: string } | undefined;
  if (!row) return { kind: "skip", reason: "OPERATION_NOT_FOUND" };
  if (it.serviceId !== row.service_id) return { kind: "skip", reason: "SERVICE_OPERATION_MISMATCH" };
  return { kind: "ok", serviceId: row.service_id, operationId: row.id };
}

/**
 * Résout le conseiller ciblé d'un item sync (MODEL-API-B/D6). `targetManagerId`
 * absent → pas de ciblage. Fourni : valide un conseiller ACTIF de l'agence du
 * scope (`is_relationship_manager AND is_active AND deleted_at IS NULL`, affecté
 * à l'agence) ; inconnu/non-conseiller/hors agence → skip
 * `RELATIONSHIP_MANAGER_NOT_FOUND` (l'item fautif est ignoré, le reste passe).
 */
async function resolveTargetManager(
  db: Client,
  tenant: TenantContext,
  targetManagerId: string | undefined
): Promise<
  | { kind: "ok"; targetManagerId: string | null }
  | { kind: "skip"; reason: string }
> {
  if (!targetManagerId) return { kind: "ok", targetManagerId: null };
  const agencyId = tenant.agencyIds[0];
  if (!agencyId) return { kind: "skip", reason: "RELATIONSHIP_MANAGER_NOT_FOUND" };
  const res = await db.query(
    `SELECT u.id
       FROM users u
       JOIN agency_users au ON au.user_id = u.id AND au.agency_id = $2
      WHERE u.id = $1
        AND u.is_relationship_manager = true
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND u.bank_id = $3`,
    [targetManagerId, agencyId, tenant.bankId]
  );
  if (res.rows.length === 0) return { kind: "skip", reason: "RELATIONSHIP_MANAGER_NOT_FOUND" };
  return { kind: "ok", targetManagerId };
}

/** Construit un résultat skipped. */
function skip(localUuid: string, reason: string): Outcome {
  return { kind: "skipped", ticket: { localUuid, reason } };
}

/** Vrai si `createdOfflineAt` est dans le futur au-delà de la tolérance de dérive. */
function isClockSkewed(createdOfflineAt: string): boolean {
  return new Date(createdOfflineAt).getTime() - Date.now() > CLOCK_SKEW_MS;
}

/** File + code service pour l'agence du JWT (ou `null` si hors scope/inexistant). */
async function resolveQueue(
  db: Client,
  tenant: TenantContext,
  serviceId: string
): Promise<{ queueId: string; agencyId: string; code: string } | null> {
  const agencyId = tenant.agencyIds[0];
  if (!agencyId) return null;
  const res = await db.query(
    `SELECT q.id AS queue_id, q.agency_id, s.code
       FROM queues q JOIN services s ON s.id = q.service_id
      WHERE q.service_id = $1 AND q.agency_id = $2 AND q.bank_id = $3`,
    [serviceId, agencyId, tenant.bankId]
  );
  const row = res.rows[0] as { queue_id: string; agency_id: string; code: string } | undefined;
  return row ? { queueId: row.queue_id, agencyId: row.agency_id, code: row.code } : null;
}

/**
 * Insère un ticket synchronisé en transaction avec idempotence unitaire
 * (`ON CONFLICT (local_uuid) DO NOTHING`). Conflit → ALREADY_SYNCED.
 */
async function insertSynced(
  db: Client,
  tenant: TenantContext,
  it: SyncItem,
  queue: { queueId: string; agencyId: string; code: string },
  serviceId: string,
  operationId: string | null,
  targetManagerId: string | null
): Promise<Outcome> {
  await db.query("BEGIN");
  try {
    const number = await allocateNumber(db, queue.queueId);
    const displayNumber = `${queue.code}-${String(number).padStart(3, "0")}`;
    const inserted = await insertRow(db, tenant, it, queue, number, displayNumber, serviceId, operationId, targetManagerId);
    if (!inserted) {
      await db.query("ROLLBACK");
      return skip(it.localUuid, "ALREADY_SYNCED");
    }
    await db.query("COMMIT");
    return {
      kind: "synced",
      queueId: queue.queueId,
      ticket: { localUuid: it.localUuid, serverId: inserted.id, number: `A${String(number).padStart(3, "0")}` },
    };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

/**
 * Alloue le prochain numéro par lock-then-increment avec reset quotidien Abidjan
 * (identique à l'émission API-003).
 */
async function allocateNumber(db: Client, queueId: string): Promise<number> {
  const res = await db.query(
    `UPDATE queues q
        SET current_ticket_number = CASE
              WHEN EXISTS (
                SELECT 1 FROM tickets t
                 WHERE t.queue_id = q.id
                   AND t.issued_day = (NOW() AT TIME ZONE 'Africa/Abidjan')::date
              ) THEN q.current_ticket_number + 1
              ELSE 1
            END
      WHERE q.id = $1
      RETURNING current_ticket_number`,
    [queueId]
  );
  return (res.rows[0] as { current_ticket_number: number }).current_ticket_number;
}

/** Insère la ligne ticket (ON CONFLICT local_uuid → `undefined` = déjà syncé). */
async function insertRow(
  db: Client,
  tenant: TenantContext,
  it: SyncItem,
  queue: { queueId: string; agencyId: string },
  number: number,
  displayNumber: string,
  serviceId: string,
  operationId: string | null,
  targetManagerId: string | null
): Promise<{ id: string } | undefined> {
  const res = await db.query(
    `INSERT INTO tickets
       (bank_id, agency_id, queue_id, service_id, operation_id, target_manager_id, number, display_number,
        tracking_id, local_uuid, channel, status, priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'WAITING',$12)
     ON CONFLICT (local_uuid) DO NOTHING
     RETURNING id`,
    [
      tenant.bankId,
      queue.agencyId,
      queue.queueId,
      serviceId,
      operationId,
      targetManagerId,
      number,
      displayNumber,
      nanoid(21),
      it.localUuid,
      it.channel,
      it.priority ?? "STANDARD",
    ]
  );
  return res.rows[0] as { id: string } | undefined;
}

/**
 * Émet un `queue:updated` par file affectée (recalcul longueur + estimation).
 * L'`agency_id` de chaque file est chargé dans la requête existante (service_id)
 * — aucun aller-retour DB ajouté.
 */
async function emitAffectedQueues(
  bus: RealtimeBus,
  redis: Redis,
  db: Client,
  queueIds: Set<string>
): Promise<void> {
  for (const queueId of queueIds) {
    await invalidateEstimate(redis, queueId);
    const length = await queueLength(queueId, db);
    const svc = await db.query(
      `SELECT service_id, agency_id FROM queues WHERE id = $1`,
      [queueId]
    );
    const svcRow = svc.rows[0] as
      | { service_id: string; agency_id: string }
      | undefined;
    if (!svcRow) continue;
    const estimate = await estimateWaitMinutes(length, svcRow.service_id, db);
    bus.emit("queue:updated", svcRow.agency_id, { queueId, length, estimate });
  }
}

/**
 * Émet UNE alerte `alert:manager` KIOSK_SYSTEM_ERROR par batch dès qu'au moins
 * une ligne est skipped. Payload = compte + raisons agrégées. L'`agencyId` est
 * celui du scope tenant du batch (toutes les files sont de cette agence).
 */
function emitSkipAlert(
  bus: RealtimeBus,
  agencyId: string,
  skipped: SkippedTicket[]
): void {
  if (skipped.length === 0) return;
  const reasons: Record<string, number> = {};
  for (const s of skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
  bus.emit("alert:manager", agencyId, {
    type: "KIOSK_SYSTEM_ERROR",
    payload: { skippedCount: skipped.length, reasons },
  });
}
