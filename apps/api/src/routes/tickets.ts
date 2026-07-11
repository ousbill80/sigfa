/**
 * Routes du cycle de vie du ticket — API-003.
 *
 * POST   /tickets              — émission idempotente (X-Idempotency-Key requis)
 * GET    /tickets/:id          — détail + position temps réel
 * POST   /tickets/:id/call     — appel ciblé (verrou Redis SET NX)
 * POST   /tickets/:id/serve    — CALLED → SERVING
 * POST   /tickets/:id/close    — SERVING → DONE (+ durées)
 * POST   /tickets/:id/no-show  — CALLED → NO_SHOW (après timeout banque)
 * POST   /tickets/:id/transfer — → TRANSFERRED + réinsertion WAITING file cible
 * POST   /tickets/:id/abandon  — WAITING/CALLED → ABANDONED
 * POST   /counters/:counterId/call-next — sélection FIFO
 *
 * @module
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Redis } from "ioredis";
import type { Client } from "pg";
import { nanoid } from "nanoid";
import { SigfaError, buildError } from "src/lib/errors.js";
import { encryptPhone, hashPhone } from "src/lib/phone-cipher.js";
import type { TenantContext } from "src/middleware/tenant.js";
import {
  nextStatus,
  computeWaitSeconds,
  computeServiceSeconds,
  type TicketStatus,
} from "src/services/sla-engine.js";
import {
  selectNextFifo,
  computePosition,
  queueLength,
  type TicketSelector,
  type Tx,
} from "src/services/queue-strategy.js";
import {
  estimateWaitMinutes,
  invalidateEstimate,
} from "src/services/queue-estimation.js";
import {
  requireIdempotencyKey,
  findReplay,
  storeReplay,
} from "src/services/idempotency.js";
import { createNoopBus, type RealtimeBus } from "src/services/realtime.js";

/** Variables de contexte Hono injectées par app.ts. */
interface TicketEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
    bus: RealtimeBus;
  };
}

/** Schéma d'émission d'un ticket (agencyId dérivé du JWT). */
const createSchema = z.object({
  serviceId: z.string().uuid(),
  channel: z.enum(["KIOSK", "QR", "MOBILE", "WHATSAPP"]),
  phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
  priority: z.enum(["STANDARD", "PRIORITY", "VIP", "PMR", "SENIOR"]).optional(),
  smsConsent: z.boolean().optional(),
});

/** Schéma d'appel ciblé / call-next avec guichet. */
const callSchema = z.object({ counterId: z.string().uuid() });
/** Schéma de transfert. */
const transferSchema = z.object({
  targetServiceId: z.string().uuid(),
  targetCounterId: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
});

/** Parse le corps JSON, `null` si malformé. */
async function parseJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/** Contexte Hono typé pour ce routeur. */
type TicketCtx = Context<TicketEnv>;

/** Émet une réponse d'erreur SigfaError au format LA LOI. */
function errorResponse(c: TicketCtx, err: unknown): Response {
  if (err instanceof SigfaError) {
    return c.json(
      buildError(err.code, err.message, err.details),
      err.httpStatus as 400 | 401 | 403 | 404 | 409 | 422
    );
  }
  throw err;
}

/**
 * Crée le routeur des tickets. Le bus temps réel est injectable (tests) ;
 * défaut : bus no-op validant.
 *
 * @param selector - Stratégie de sélection FIFO (défaut `selectNextFifo`)
 * @returns Routeur Hono monté sous /api/v1
 */
export function createTicketRouter(selector: TicketSelector = selectNextFifo): Hono<TicketEnv> {
  const router = new Hono<TicketEnv>();
  registerCreate(router);
  registerGet(router);
  registerCallNext(router, selector);
  registerCall(router);
  registerTransition(router, "serve");
  registerClose(router);
  registerNoShow(router);
  registerTransfer(router);
  registerAbandon(router);
  return router;
}

/** Résout le bus depuis le contexte, ou fournit un no-op. */
function getBus(c: TicketCtx): RealtimeBus {
  return (c.get("bus") as RealtimeBus | undefined) ?? createNoopBus();
}

/** Regex UUID (canonique) pour valider les paramètres de chemin. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lit un paramètre de chemin et valide sa forme UUID.
 * Un identifiant malformé → 404 (ressource inexistante), jamais un 500 DB.
 *
 * @param c    - Contexte Hono
 * @param name - Nom du paramètre de chemin
 * @throws {SigfaError} 404 NOT_FOUND si le paramètre n'est pas un UUID
 */
function paramUuid(c: TicketCtx, name: string): string {
  const value = c.req.param(name);
  if (!value || !UUID_RE.test(value)) {
    throw new SigfaError("NOT_FOUND", "Ressource introuvable.", 404);
  }
  return value;
}

/** Charge une ligne ticket dans le scope tenant, ou lève 404. */
async function loadTicket(db: Client, tenant: TenantContext, id: string): Promise<TicketRow> {
  const res = await db.query(
    `SELECT * FROM tickets WHERE id = $1 AND bank_id = $2`,
    [id, tenant.bankId]
  );
  const row = res.rows[0] as TicketRow | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Ticket introuvable.", 404);
  return row;
}

/** Ligne brute de la table tickets (snake_case). */
interface TicketRow {
  id: string;
  bank_id: string;
  agency_id: string;
  queue_id: string;
  service_id: string;
  counter_id: string | null;
  number: number;
  display_number: string | null;
  tracking_id: string;
  channel: string;
  status: TicketStatus;
  priority: string;
  issued_at: Date;
  called_at: Date | null;
  served_at: Date | null;
  closed_at: Date | null;
}

// ── POST /tickets ────────────────────────────────────────────────────────────

/** Enregistre la route d'émission idempotente. */
function registerCreate(router: Hono<TicketEnv>): void {
  router.post("/tickets", async (c) => {
    const tenant = c.get("tenant");
    const db = c.get("db");
    const redis = c.get("redis");
    try {
      const key = requireIdempotencyKey(c.req.header("X-Idempotency-Key"));
      const body = await parseJson(c);
      const parsed = createSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(buildError("VALIDATION_ERROR", "Corps invalide.", { issues: parsed.error.issues }), 400);
      }
      const scope = `tickets:${tenant.bankId ?? "_"}`;
      const replay = await findReplay(redis, scope, key, parsed.data);
      if (replay) return replayResponse(c, replay);
      const result = await issueTicket(db, redis, tenant, parsed.data, getBus(c));
      const bodyStr = JSON.stringify(result);
      await storeReplay(redis, scope, key, parsed.data, 201, bodyStr);
      return replayResponse(c, { status: 201, body: bodyStr });
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Rejoue une réponse enregistrée byte-identique. */
function replayResponse(c: TicketCtx, replay: { status: number; body: string }): Response {
  return c.newResponse(replay.body, replay.status as 201, {
    "Content-Type": "application/json",
  });
}

/** Données validées d'émission. */
type CreateInput = z.infer<typeof createSchema>;

/**
 * Émet un ticket : résout la file, alloue le numéro (lock-then-increment),
 * compose displayNumber, persiste, calcule position/estimation, émet events.
 */
async function issueTicket(
  db: Client,
  redis: Redis,
  tenant: TenantContext,
  input: CreateInput,
  bus: RealtimeBus
): Promise<Record<string, unknown>> {
  await db.query("BEGIN");
  try {
    const ctx = await resolveServiceQueue(db, tenant, input.serviceId);
    const number = await allocateNumber(db, ctx.queueId);
    const displayNumber = `${ctx.code}-${String(number).padStart(3, "0")}`;
    const trackingId = nanoid(21);
    const phone = buildPhone(input);
    const inserted = await insertTicket(db, {
      tenant,
      ctx,
      input,
      number,
      displayNumber,
      trackingId,
      phone,
    });
    const position = await computePosition(inserted.id, db);
    const estimate = await estimateWaitMinutes(position, input.serviceId, db);
    await db.query("COMMIT");
    await emitCreated(bus, redis, db, { inserted, ctx, tenant, displayNumber });
    return {
      id: inserted.id,
      number: `A${String(number).padStart(3, "0")}`,
      displayNumber,
      status: "WAITING",
      priority: input.priority ?? "STANDARD",
      serviceId: input.serviceId,
      agencyId: ctx.agencyId,
      channel: input.channel,
      position,
      estimatedWaitMinutes: estimate,
      trackingId,
      createdAt: inserted.issued_at.toISOString(),
    };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

/** Chiffre + hache le téléphone fourni (ou renvoie des nulls). */
function buildPhone(input: CreateInput): { encrypted: string | null; hash: string | null; consent: boolean } {
  if (!input.phoneNumber) return { encrypted: null, hash: null, consent: false };
  return {
    encrypted: encryptPhone(input.phoneNumber),
    hash: hashPhone(input.phoneNumber),
    consent: input.smsConsent ?? false,
  };
}

/** Résout la file (queue) + code service pour l'agence du JWT. */
async function resolveServiceQueue(
  db: Client,
  tenant: TenantContext,
  serviceId: string
): Promise<{ queueId: string; agencyId: string; code: string }> {
  const agencyId = tenant.agencyIds[0];
  if (!agencyId) throw new SigfaError("FORBIDDEN", "Aucune agence dans le scope du JWT.", 403);
  const res = await db.query(
    `SELECT q.id AS queue_id, q.agency_id, s.code
       FROM queues q JOIN services s ON s.id = q.service_id
      WHERE q.service_id = $1 AND q.agency_id = $2 AND q.bank_id = $3`,
    [serviceId, agencyId, tenant.bankId]
  );
  const row = res.rows[0] as { queue_id: string; agency_id: string; code: string } | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "File introuvable pour ce service.", 404);
  return { queueId: row.queue_id, agencyId: row.agency_id, code: row.code };
}

/**
 * Alloue le prochain numéro par lock-then-increment avec reset quotidien Abidjan.
 * Le reset s'ancre sur le dernier `issued_day` : si aucun ticket aujourd'hui,
 * le compteur repart à 1.
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

/** Insère la ligne ticket et retourne id + issued_at. */
async function insertTicket(
  db: Client,
  args: {
    tenant: TenantContext;
    ctx: { queueId: string; agencyId: string };
    input: CreateInput;
    number: number;
    displayNumber: string;
    trackingId: string;
    phone: { encrypted: string | null; hash: string | null; consent: boolean };
  }
): Promise<{ id: string; issued_at: Date }> {
  const res = await db.query(
    `INSERT INTO tickets
       (bank_id, agency_id, queue_id, service_id, number, display_number,
        tracking_id, channel, status, priority, phone_encrypted, phone_hash, sms_consent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'WAITING',$9,$10,$11,$12)
     RETURNING id, issued_at`,
    [
      args.tenant.bankId,
      args.ctx.agencyId,
      args.ctx.queueId,
      args.input.serviceId,
      args.number,
      args.displayNumber,
      args.trackingId,
      args.input.channel,
      args.input.priority ?? "STANDARD",
      args.phone.encrypted,
      args.phone.hash,
      args.phone.consent,
    ]
  );
  return res.rows[0] as { id: string; issued_at: Date };
}

/** Émet ticket:created + queue:updated après commit. */
async function emitCreated(
  bus: RealtimeBus,
  redis: Redis,
  db: Client,
  args: {
    inserted: { id: string };
    ctx: { queueId: string };
    tenant: TenantContext;
    displayNumber: string;
  }
): Promise<void> {
  bus.emit("ticket:created", {
    ticketId: args.inserted.id,
    queueId: args.ctx.queueId,
    agencyId: args.tenant.agencyIds[0] ?? "",
    displayNumber: args.displayNumber,
    status: "WAITING",
  });
  await emitQueueUpdated(bus, redis, db, args.ctx.queueId);
}

/** Recalcule et émet queue:updated {length, estimate}, invalide le cache. */
async function emitQueueUpdated(bus: RealtimeBus, redis: Redis, db: Tx, queueId: string): Promise<void> {
  await invalidateEstimate(redis, queueId);
  const length = await queueLength(queueId, db);
  const serviceRes = await db.query(`SELECT service_id FROM queues WHERE id = $1`, [queueId]);
  const serviceId = (serviceRes.rows[0] as { service_id: string } | undefined)?.service_id;
  const estimate = serviceId ? await estimateWaitMinutes(length, serviceId, db) : 0;
  bus.emit("queue:updated", { queueId, length, estimate });
}

// ── GET /tickets/:id ─────────────────────────────────────────────────────────

/** Enregistre la route de détail + position. */
function registerGet(router: Hono<TicketEnv>): void {
  router.get("/tickets/:id", async (c) => {
    const tenant = c.get("tenant");
    const db = c.get("db");
    try {
      const row = await loadTicket(db, tenant, paramUuid(c, "id"));
      const position = await computePosition(row.id, db);
      const estimate = await estimateWaitMinutes(position, row.service_id, db);
      return c.json(ticketView(row, position, estimate), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Compose la vue publique d'un ticket. */
function ticketView(row: TicketRow, position: number, estimate: number): Record<string, unknown> {
  return {
    id: row.id,
    number: `A${String(row.number).padStart(3, "0")}`,
    displayNumber: row.display_number,
    status: row.status,
    priority: row.priority,
    serviceId: row.service_id,
    agencyId: row.agency_id,
    channel: row.channel,
    position,
    estimatedWaitMinutes: estimate,
    trackingId: row.tracking_id,
    counterId: row.counter_id ?? undefined,
    calledAt: row.called_at?.toISOString(),
    servedAt: row.served_at?.toISOString(),
    closedAt: row.closed_at?.toISOString(),
    createdAt: row.issued_at.toISOString(),
  };
}

// ── POST /counters/:counterId/call-next ──────────────────────────────────────

/** Enregistre la route call-next (sélection FIFO). */
function registerCallNext(router: Hono<TicketEnv>, selector: TicketSelector): void {
  router.post("/counters/:counterId/call-next", async (c) => {
    const tenant = c.get("tenant");
    const db = c.get("db");
    try {
      const counterId = paramUuid(c, "counterId");
      const result = await callNext(db, c.get("redis"), tenant, counterId, selector, getBus(c));
      return c.json(result, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Sélectionne FIFO le prochain WAITING d'un guichet et le passe CALLED. */
async function callNext(
  db: Client,
  redis: Redis,
  tenant: TenantContext,
  counterId: string,
  selector: TicketSelector,
  bus: RealtimeBus
): Promise<Record<string, unknown>> {
  await db.query("BEGIN");
  try {
    const queueId = await counterQueue(db, tenant, counterId);
    const selected = await selector(queueId, counterId, db);
    if (!selected) throw new SigfaError("QUEUE_EMPTY", "Aucun ticket éligible dans la file.", 404);
    const now = new Date();
    await db.query(
      `UPDATE tickets SET status = 'CALLED', counter_id = $1, called_at = $2, updated_at = NOW() WHERE id = $3`,
      [counterId, now, selected.id]
    );
    await db.query("COMMIT");
    await afterCall(bus, redis, db, { ticketId: selected.id, queueId, counterId });
    return callView(selected.id, selected.serviceId, counterId, now);
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

/** Résout la file desservie par un guichet (via son service courant/queue agence). */
async function counterQueue(db: Client, tenant: TenantContext, counterId: string): Promise<string> {
  const res = await db.query(
    `SELECT q.id AS queue_id
       FROM counters c
       JOIN queues q ON q.agency_id = c.agency_id
      WHERE c.id = $1 AND c.bank_id = $2
      ORDER BY q.created_at ASC
      LIMIT 1`,
    [counterId, tenant.bankId]
  );
  const row = res.rows[0] as { queue_id: string } | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Guichet ou file introuvable.", 404);
  return row.queue_id;
}

/** Émet ticket:called + queue:updated après un appel. */
async function afterCall(
  bus: RealtimeBus,
  redis: Redis,
  db: Client,
  args: { ticketId: string; queueId: string; counterId: string }
): Promise<void> {
  const res = await db.query(`SELECT display_number FROM tickets WHERE id = $1`, [args.ticketId]);
  const displayNumber = (res.rows[0] as { display_number: string }).display_number;
  bus.emit("ticket:called", {
    ticketId: args.ticketId,
    queueId: args.queueId,
    counterId: args.counterId,
    displayNumber,
    status: "CALLED",
  });
  await emitQueueUpdated(bus, redis, db, args.queueId);
}

/** Vue de réponse d'un appel. */
function callView(id: string, serviceId: string, counterId: string, calledAt: Date): Record<string, unknown> {
  return { id, status: "CALLED", counterId, serviceId, position: 0, estimatedWaitMinutes: 0, calledAt: calledAt.toISOString() };
}

// ── POST /tickets/:id/call ───────────────────────────────────────────────────

/** Enregistre l'appel ciblé (verrou Redis SET NX). */
function registerCall(router: Hono<TicketEnv>): void {
  router.post("/tickets/:id/call", async (c) => {
    const tenant = c.get("tenant");
    const db = c.get("db");
    const redis = c.get("redis");
    try {
      const body = await parseJson(c);
      const parsed = callSchema.safeParse(body);
      if (!parsed.success) return c.json(buildError("VALIDATION_ERROR", "Corps invalide."), 400);
      const result = await callTargeted(db, redis, tenant, paramUuid(c, "id"), parsed.data.counterId, getBus(c));
      return c.json(result, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Appel ciblé d'un ticket précis avec verrou Redis SET NX. */
async function callTargeted(
  db: Client,
  redis: Redis,
  tenant: TenantContext,
  id: string,
  counterId: string,
  bus: RealtimeBus
): Promise<Record<string, unknown>> {
  const row = await loadTicket(db, tenant, id);
  const locked = await redis.set(`ticket-lock:${id}`, counterId, "EX", 30, "NX");
  if (locked === null) {
    const owner = await redis.get(`ticket-lock:${id}`);
    if (owner && owner !== counterId) {
      throw new SigfaError("TICKET_ALREADY_CLAIMED", `Ce ticket a déjà été pris.`, 409, {
        claimedByCounterId: owner,
      });
    }
  }
  nextStatus(row.status, "call");
  const now = new Date();
  await db.query(
    `UPDATE tickets SET status = 'CALLED', counter_id = $1, called_at = COALESCE(called_at, $2), updated_at = NOW() WHERE id = $3`,
    [counterId, now, id]
  );
  await afterCall(bus, redis, db, { ticketId: id, queueId: row.queue_id, counterId });
  return callView(id, row.service_id, counterId, row.called_at ?? now);
}

// ── POST /tickets/:id/serve ──────────────────────────────────────────────────

/** Enregistre une transition simple (serve). */
function registerTransition(router: Hono<TicketEnv>, action: "serve"): void {
  router.post(`/tickets/:id/${action}`, async (c) => {
    const tenant = c.get("tenant");
    const db = c.get("db");
    try {
      const row = await loadTicket(db, tenant, paramUuid(c, "id"));
      const target = nextStatus(row.status, action);
      await db.query(
        `UPDATE tickets SET status = $1, served_at = COALESCE(served_at, NOW()), updated_at = NOW() WHERE id = $2`,
        [target, row.id]
      );
      return c.json({ id: row.id, status: target, counterId: row.counter_id ?? undefined }, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

// ── POST /tickets/:id/close ──────────────────────────────────────────────────

/** Enregistre la clôture (SERVING → DONE + durées). */
function registerClose(router: Hono<TicketEnv>): void {
  router.post("/tickets/:id/close", async (c) => {
    const tenant = c.get("tenant");
    const db = c.get("db");
    const redis = c.get("redis");
    try {
      const row = await loadTicket(db, tenant, paramUuid(c, "id"));
      nextStatus(row.status, "close");
      const result = await closeTicket(db, redis, row, getBus(c));
      return c.json(result, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Clôture le ticket, calcule les durées, émet ticket:closed. */
async function closeTicket(
  db: Client,
  redis: Redis,
  row: TicketRow,
  bus: RealtimeBus
): Promise<Record<string, unknown>> {
  const closedAt = new Date();
  const waitTime = row.called_at ? computeWaitSeconds(row.issued_at, row.called_at) : 0;
  const serviceTime = row.served_at ? computeServiceSeconds(row.served_at, closedAt) : 0;
  await db.query(
    `UPDATE tickets SET status = 'DONE', closed_at = $1, wait_time_seconds = $2, service_time_seconds = $3, updated_at = NOW() WHERE id = $4`,
    [closedAt, waitTime, serviceTime, row.id]
  );
  bus.emit("ticket:closed", {
    ticketId: row.id,
    queueId: row.queue_id,
    counterId: row.counter_id ?? row.id,
    status: "DONE",
    waitTime,
    serviceTime,
  });
  await emitQueueUpdated(bus, redis, db, row.queue_id);
  return { id: row.id, status: "DONE", counterId: row.counter_id ?? undefined, waitTime, serviceTime, closedAt: closedAt.toISOString() };
}

// ── POST /tickets/:id/no-show ────────────────────────────────────────────────

/** Enregistre le no-show (après timeout banque, 422 avant). */
function registerNoShow(router: Hono<TicketEnv>): void {
  router.post("/tickets/:id/no-show", async (c) => {
    const tenant = c.get("tenant");
    const db = c.get("db");
    try {
      const row = await loadTicket(db, tenant, paramUuid(c, "id"));
      nextStatus(row.status, "no-show");
      await assertNoShowTimeout(db, row);
      await db.query(
        `UPDATE tickets SET status = 'NO_SHOW', no_show_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [row.id]
      );
      await emitQueueUpdated(getBus(c), c.get("redis"), db, row.queue_id);
      return c.json({ id: row.id, status: "NO_SHOW" }, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Vérifie que le délai `no_show_timeout_minutes` de la banque est écoulé. */
async function assertNoShowTimeout(db: Client, row: TicketRow): Promise<void> {
  const res = await db.query(
    `SELECT (b.no_show_timeout_minutes * 60) AS timeout_s,
            EXTRACT(EPOCH FROM (NOW() - t.called_at))::int AS elapsed_s
       FROM tickets t JOIN banks b ON b.id = t.bank_id
      WHERE t.id = $1`,
    [row.id]
  );
  const r = res.rows[0] as { timeout_s: number; elapsed_s: number | null };
  if (r.elapsed_s === null || r.elapsed_s < r.timeout_s) {
    throw new SigfaError(
      "UNPROCESSABLE_ENTITY",
      "Délai de non-présentation non écoulé.",
      422,
      { timeoutSeconds: r.timeout_s, elapsedSeconds: r.elapsed_s ?? 0 }
    );
  }
}

// ── POST /tickets/:id/transfer ───────────────────────────────────────────────

/** Enregistre le transfert (→ TRANSFERRED + réinsertion WAITING file cible). */
function registerTransfer(router: Hono<TicketEnv>): void {
  router.post("/tickets/:id/transfer", async (c) => {
    const tenant = c.get("tenant");
    const db = c.get("db");
    try {
      const body = await parseJson(c);
      const parsed = transferSchema.safeParse(body);
      if (!parsed.success) return c.json(buildError("VALIDATION_ERROR", "Corps invalide."), 400);
      const row = await loadTicket(db, tenant, paramUuid(c, "id"));
      nextStatus(row.status, "transfer");
      const result = await transferTicket(db, c.get("redis"), tenant, row, parsed.data, getBus(c));
      return c.json(result, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Marque TRANSFERRED, crée la ligne ticket_transfers, réinsère un WAITING cible. */
async function transferTicket(
  db: Client,
  redis: Redis,
  tenant: TenantContext,
  row: TicketRow,
  input: z.infer<typeof transferSchema>,
  bus: RealtimeBus
): Promise<Record<string, unknown>> {
  await db.query("BEGIN");
  try {
    await db.query(`UPDATE tickets SET status = 'TRANSFERRED', updated_at = NOW() WHERE id = $1`, [row.id]);
    await db.query(
      `INSERT INTO ticket_transfers (bank_id, ticket_id, from_counter_id, from_service_id, to_service_id, to_counter_id, reason, transferred_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [row.bank_id, row.id, row.counter_id, row.service_id, input.targetServiceId, input.targetCounterId ?? null, input.reason ?? null, tenant.userId]
    );
    const target = await reinsertTarget(db, tenant, row, input.targetServiceId);
    await db.query("COMMIT");
    await emitQueueUpdated(bus, redis, db, row.queue_id);
    await emitQueueUpdated(bus, redis, db, target.queueId);
    return { id: row.id, status: "TRANSFERRED", targetTicketId: target.ticketId, targetServiceId: input.targetServiceId };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

/** Réinsère un nouveau ticket WAITING dans la file du service cible. */
async function reinsertTarget(
  db: Client,
  tenant: TenantContext,
  row: TicketRow,
  targetServiceId: string
): Promise<{ ticketId: string; queueId: string }> {
  const ctx = await resolveServiceQueue(db, tenant, targetServiceId);
  const number = await allocateNumber(db, ctx.queueId);
  const displayNumber = `${ctx.code}-${String(number).padStart(3, "0")}`;
  const res = await db.query(
    `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, display_number, tracking_id, channel, status, priority, phone_encrypted, phone_hash, sms_consent)
     SELECT bank_id, agency_id, $1, $2, $3, $4, $5, channel, 'WAITING', priority, phone_encrypted, phone_hash, sms_consent
       FROM tickets WHERE id = $6
     RETURNING id`,
    [ctx.queueId, targetServiceId, number, displayNumber, nanoid(21), row.id]
  );
  return { ticketId: (res.rows[0] as { id: string }).id, queueId: ctx.queueId };
}

// ── POST /tickets/:id/abandon ────────────────────────────────────────────────

/** Enregistre l'abandon (WAITING/CALLED → ABANDONED). */
function registerAbandon(router: Hono<TicketEnv>): void {
  router.post("/tickets/:id/abandon", async (c) => {
    const tenant = c.get("tenant");
    const db = c.get("db");
    try {
      const row = await loadTicket(db, tenant, paramUuid(c, "id"));
      nextStatus(row.status, "abandon");
      await db.query(`UPDATE tickets SET status = 'ABANDONED', updated_at = NOW() WHERE id = $1`, [row.id]);
      await emitQueueUpdated(getBus(c), c.get("redis"), db, row.queue_id);
      return c.json({ id: row.id, status: "ABANDONED" }, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}
