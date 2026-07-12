/**
 * Routes du cycle de vie du ticket — API-003/004.
 *
 * POST   /tickets              — émission idempotente (X-Idempotency-Key requis)
 *                                 → 422 QUEUE_PAUSED si file fermée (API-004)
 * GET    /tickets/:id          — détail + position temps réel (priorités, API-004)
 * POST   /tickets/:id/call     — appel ciblé (verrou Redis SET NX)
 * POST   /tickets/:id/serve    — CALLED → SERVING
 * POST   /tickets/:id/close    — SERVING → DONE (+ durées)
 * POST   /tickets/:id/no-show  — CALLED → NO_SHOW (après timeout banque)
 * POST   /tickets/:id/transfer — → TRANSFERRED + réinsertion WAITING file cible
 * POST   /tickets/:id/abandon  — WAITING/CALLED → ABANDONED
 * POST   /counters/:counterId/call-next — sélection prioritaire VIP>PMR>SENIOR>PRIORITY>STANDARD (API-004)
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
  queueLength,
  type TicketSelector,
  type Tx,
} from "src/services/queue-strategy.js";
import {
  selectNextPriority,
  computePositionPriority,
  shouldAlertOverflow,
  findOverflowQueues,
} from "src/services/queue-engine.js";
import {
  estimateWaitMinutes,
  invalidateEstimate,
} from "src/services/queue-estimation.js";
import {
  requireIdempotencyKey,
  acquireIdempotency,
  storeReplay,
  releaseIdempotencyLock,
} from "src/services/idempotency.js";
import { createNoopBus, type RealtimeBus } from "src/services/realtime.js";
import {
  changeAgentStatus,
  getCurrentStatus,
} from "src/services/agent-status.js";

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
  /** Langue requise pour le routage (API-004 — préférence, pas un blocage). */
  requiredLanguage: z.string().max(10).optional(),
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
 * @param selector - Stratégie de sélection (défaut `selectNextPriority` — API-004)
 * @returns Routeur Hono monté sous /api/v1
 */
export function createTicketRouter(selector: TicketSelector = selectNextPriority): Hono<TicketEnv> {
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
      // Idempotence ATOMIQUE (Boucle 3 F3) : verrou in-flight SET NX PX pour
      // qu'une seule requête concurrente crée le ticket ; les autres rejouent la
      // réponse mémorisée (ou 409 IDEMPOTENCY_IN_PROGRESS).
      const outcome = await acquireIdempotency(redis, scope, key, parsed.data);
      if (outcome.kind === "replay") return replayResponse(c, outcome.result);
      let bodyStr: string;
      try {
        const result = await issueTicket(db, redis, tenant, parsed.data, getBus(c));
        bodyStr = JSON.stringify(result);
      } catch (processErr) {
        // Échec du traitement : libérer le verrou pour permettre un nouvel essai.
        await releaseIdempotencyLock(redis, scope, key);
        throw processErr;
      }
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
 * Entrée d'émission générique (JWT ou borne publique). `bankId`/`agencyId` sont
 * fournis explicitement : le chemin agent les dérive du JWT, le chemin public du
 * corps de la requête (agence/service validés existants et cohérents).
 */
export interface IssueTicketInput {
  serviceId: string;
  channel: "KIOSK" | "QR" | "MOBILE" | "WHATSAPP";
  phoneNumber?: string | undefined;
  priority?: "STANDARD" | "PRIORITY" | "VIP" | "PMR" | "SENIOR" | undefined;
  smsConsent?: boolean | undefined;
  requiredLanguage?: string | undefined;
}

/** Contexte tenant résolu (bank + agence) pour l'émission. */
export interface IssueTenant {
  bankId: string | null;
  agencyId: string;
}

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
  const agencyId = tenant.agencyIds[0];
  if (!agencyId) throw new SigfaError("FORBIDDEN", "Aucune agence dans le scope du JWT.", 403);
  return issueTicketFor(db, redis, { bankId: tenant.bankId, agencyId }, input, bus);
}

/**
 * Cœur d'émission RÉUTILISABLE (agent JWT ou borne publique) : résout la file
 * pour `(bankId, agencyId, serviceId)`, alloue le numéro, persiste, calcule
 * position/estimation, émet `ticket:created`/`queue:updated`.
 *
 * Le `bankId` d'émission est TOUJOURS celui dérivé de la file résolue (jamais
 * un champ client), garantissant l'absence de fuite inter-tenant.
 *
 * @param db     - Connexion PG
 * @param redis  - Client Redis
 * @param at     - Tenant résolu (bank + agence) — source du scope
 * @param input  - Données validées d'émission
 * @param bus    - Bus temps réel
 */
export async function issueTicketFor(
  db: Client,
  redis: Redis,
  at: IssueTenant,
  input: IssueTicketInput,
  bus: RealtimeBus
): Promise<Record<string, unknown>> {
  await db.query("BEGIN");
  try {
    const ctx = await resolveServiceQueue(db, at, input.serviceId);
    const number = await allocateNumber(db, ctx.queueId);
    const displayNumber = `${ctx.code}-${String(number).padStart(3, "0")}`;
    const trackingId = nanoid(21);
    const phone = buildPhone(input);
    const inserted = await insertTicket(db, {
      bankId: ctx.bankId,
      ctx,
      input,
      number,
      displayNumber,
      trackingId,
      phone,
    });
    // API-004 : position utilise l'ordre prioritaire (VIP>PMR>SENIOR>PRIORITY>STANDARD)
    const position = await computePositionPriority(inserted.id, db);
    const estimate = await estimateWaitMinutes(position, input.serviceId, db);
    await db.query("COMMIT");
    await emitCreated(bus, redis, db, {
      inserted,
      ctx,
      input,
      number,
      position,
      estimate,
    });
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
function buildPhone(input: IssueTicketInput): { encrypted: string | null; hash: string | null; consent: boolean } {
  if (!input.phoneNumber) return { encrypted: null, hash: null, consent: false };
  return {
    encrypted: encryptPhone(input.phoneNumber),
    hash: hashPhone(input.phoneNumber),
    consent: input.smsConsent ?? false,
  };
}

/**
 * Résout la file (queue) + code service pour l'agence fournie (JWT ou borne).
 * Vérifie que la file est ouverte (API-004 : 422 QUEUE_PAUSED si PAUSED/CLOSED).
 *
 * Quand `at.bankId` est fourni (chemin agent), il borne la requête ; sinon
 * (chemin public) le bankId est DÉRIVÉ de la file résolue via l'agence — jamais
 * accepté depuis le client. L'appariement `agency_id = $2` garantit qu'un service
 * d'une autre agence/banque ne peut être ciblé (isolation tenant).
 */
async function resolveServiceQueue(
  db: Client,
  at: IssueTenant,
  serviceId: string
): Promise<{ queueId: string; agencyId: string; code: string; bankId: string }> {
  const agencyId = at.agencyId;
  const res = await db.query(
    `SELECT q.id AS queue_id, q.agency_id, q.bank_id, q.status, s.code
       FROM queues q JOIN services s ON s.id = q.service_id
      WHERE q.service_id = $1 AND q.agency_id = $2
        AND ($3::uuid IS NULL OR q.bank_id = $3)`,
    [serviceId, agencyId, at.bankId]
  );
  const row = res.rows[0] as
    | { queue_id: string; agency_id: string; bank_id: string; status: string; code: string }
    | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "File introuvable pour ce service.", 404);
  // API-004 : file en pause → 422 QUEUE_PAUSED (tickets existants servables)
  if (row.status === "PAUSED" || row.status === "CLOSED") {
    throw new SigfaError("QUEUE_PAUSED", "La file est actuellement fermée.", 422, {
      queueId: row.queue_id,
      status: row.status,
    });
  }
  return { queueId: row.queue_id, agencyId: row.agency_id, code: row.code, bankId: row.bank_id };
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
    bankId: string;
    ctx: { queueId: string; agencyId: string };
    input: IssueTicketInput;
    number: number;
    displayNumber: string;
    trackingId: string;
    phone: { encrypted: string | null; hash: string | null; consent: boolean };
  }
): Promise<{ id: string; issued_at: Date }> {
  const res = await db.query(
    `INSERT INTO tickets
       (bank_id, agency_id, queue_id, service_id, number, display_number,
        tracking_id, channel, status, priority, phone_encrypted, phone_hash, sms_consent,
        required_language)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'WAITING',$9,$10,$11,$12,$13)
     RETURNING id, issued_at`,
    [
      args.bankId,
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
      args.input.requiredLanguage ?? null,
    ]
  );
  return res.rows[0] as { id: string; issued_at: Date };
}

/** Émet ticket:created (forme CONTRAT) + queue:updated après commit. */
async function emitCreated(
  bus: RealtimeBus,
  redis: Redis,
  db: Client,
  args: {
    inserted: { id: string; issued_at: Date };
    ctx: { queueId: string; agencyId: string };
    input: IssueTicketInput;
    number: number;
    position: number;
    estimate: number;
  }
): Promise<void> {
  const agencyId = args.ctx.agencyId;
  // Forme CONTRAT ticket:created : { ticket: {…}, position, estimate }.
  // Tous les champs sont DÉJÀ en scope de la transaction (aucun lookup ajouté).
  bus.emit("ticket:created", agencyId, {
    ticket: {
      id: args.inserted.id,
      number: `A${String(args.number).padStart(3, "0")}`,
      status: "WAITING",
      serviceId: args.input.serviceId,
      agencyId,
      channel: args.input.channel,
      createdAt: args.inserted.issued_at.toISOString(),
    },
    position: args.position,
    estimate: args.estimate,
  });
  await emitQueueUpdated(bus, redis, db, agencyId, args.ctx.queueId);
}

/** Recalcule et émet queue:updated {length, estimate}, invalide le cache. */
async function emitQueueUpdated(
  bus: RealtimeBus,
  redis: Redis,
  db: Tx,
  agencyId: string,
  queueId: string
): Promise<void> {
  await invalidateEstimate(redis, queueId);
  const length = await queueLength(queueId, db);
  const serviceRes = await db.query(`SELECT service_id FROM queues WHERE id = $1`, [queueId]);
  const serviceId = (serviceRes.rows[0] as { service_id: string } | undefined)?.service_id;
  const estimate = serviceId ? await estimateWaitMinutes(length, serviceId, db) : 0;
  bus.emit("queue:updated", agencyId, { queueId, length, estimate });
}

// ── GET /tickets/:id ─────────────────────────────────────────────────────────

/** Enregistre la route de détail + position (API-004 : position prioritaire). */
function registerGet(router: Hono<TicketEnv>): void {
  router.get("/tickets/:id", async (c) => {
    const tenant = c.get("tenant");
    const db = c.get("db");
    try {
      const row = await loadTicket(db, tenant, paramUuid(c, "id"));
      // API-004 : position reflète l'ordre VIP>PMR>SENIOR>PRIORITY>STANDARD
      const position = await computePositionPriority(row.id, db);
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

/** Enregistre la route call-next (sélection prioritaire API-004). */
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

/** Sélectionne le prochain WAITING prioritaire d'un guichet et le passe CALLED. */
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
    const { queueId, serviceId, bankId, agencyId } = await counterQueueFull(db, tenant, counterId);
    const selected = await selector(queueId, counterId, db);
    if (!selected) throw new SigfaError("QUEUE_EMPTY", "Aucun ticket éligible dans la file.", 404);
    const now = new Date();
    await db.query(
      `UPDATE tickets SET status = 'CALLED', counter_id = $1, called_at = $2, updated_at = NOW() WHERE id = $3`,
      [counterId, now, selected.id]
    );
    await db.query("COMMIT");
    await afterCall(bus, redis, db, { ticketId: selected.id, queueId, counterId });
    // API-004 : vérification débordement après chaque appel
    await checkAndEmitOverflow(db, redis, bus, { queueId, serviceId, bankId, agencyId });
    return callView(selected.id, selected.serviceId, counterId, now);
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

/**
 * Vérifie le seuil critique et émet `alert:manager` QUEUE_CRITICAL si nécessaire.
 * Une seule alerte par franchissement (flag Redis). Services compatibles inclus.
 */
async function checkAndEmitOverflow(
  db: Client,
  redis: Redis,
  bus: RealtimeBus,
  ctx: { queueId: string; serviceId: string; bankId: string; agencyId: string }
): Promise<void> {
  const { queueId, serviceId, bankId, agencyId } = ctx;
  const length = await queueLength(queueId, db);
  const doAlert = await shouldAlertOverflow(queueId, length, bankId, db, redis);
  if (!doAlert) return;
  const overflowQueues = await findOverflowQueues(serviceId, bankId, db);
  // API-007 : forme CONTRACTUELLE unique `{ type, payload }` (union supprimée).
  bus.emit("alert:manager", agencyId, {
    type: "QUEUE_CRITICAL",
    payload: {
      queueId,
      serviceId,
      length,
      overflowQueueIds: overflowQueues.map((q) => q.queueId),
    },
  });
}

/** Résout la file + serviceId + bankId + agencyId desservis par un guichet. */
async function counterQueueFull(
  db: Client,
  tenant: TenantContext,
  counterId: string
): Promise<{ queueId: string; serviceId: string; bankId: string; agencyId: string }> {
  const res = await db.query(
    `SELECT q.id AS queue_id, q.service_id, q.bank_id, c.agency_id
       FROM counters c
       JOIN queues q ON q.agency_id = c.agency_id
      WHERE c.id = $1 AND c.bank_id = $2
      ORDER BY q.created_at ASC
      LIMIT 1`,
    [counterId, tenant.bankId]
  );
  const row = res.rows[0] as
    | { queue_id: string; service_id: string; bank_id: string; agency_id: string }
    | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Guichet ou file introuvable.", 404);
  return {
    queueId: row.queue_id,
    serviceId: row.service_id,
    bankId: row.bank_id,
    agencyId: row.agency_id,
  };
}

/**
 * Émet ticket:called (forme CONTRAT) + queue:updated après un appel.
 *
 * RT-001a : le payload contrat exige le résumé complet du ticket + le libellé du
 * guichet. On charge ces champs en UNE requête (JOIN counters) — elle REMPLACE
 * l'ancienne requête `display_number` : AUCUN aller-retour DB ajouté sur ce
 * chemin d'émission latence-sensible (`ticket:called`).
 */
async function afterCall(
  bus: RealtimeBus,
  redis: Redis,
  db: Client,
  args: { ticketId: string; queueId: string; counterId: string }
): Promise<void> {
  const res = await db.query(
    `SELECT t.agency_id, t.number, t.service_id, t.channel, t.issued_at,
            c.label AS counter_label
       FROM tickets t
       LEFT JOIN counters c ON c.id = $2
      WHERE t.id = $1`,
    [args.ticketId, args.counterId]
  );
  const row = res.rows[0] as {
    agency_id: string;
    number: number;
    service_id: string;
    channel: "KIOSK" | "QR" | "MOBILE" | "WHATSAPP";
    issued_at: Date;
    counter_label: string | null;
  };
  bus.emit("ticket:called", row.agency_id, {
    ticket: {
      id: args.ticketId,
      number: `A${String(row.number).padStart(3, "0")}`,
      status: "CALLED",
      serviceId: row.service_id,
      agencyId: row.agency_id,
      channel: row.channel,
      createdAt: row.issued_at.toISOString(),
    },
    counter: { id: args.counterId, label: row.counter_label ?? "Guichet" },
  });
  await emitQueueUpdated(bus, redis, db, row.agency_id, args.queueId);
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

/**
 * Appel ciblé d'un ticket précis avec verrou Redis durci (API-006).
 *
 * Protocole :
 * 1. Charger le ticket (404 si introuvable)
 * 2. Vérifier la transition légale via nextStatus (ILLEGAL_TRANSITION si illégale)
 * 3. Acquérir le verrou Redis SET NX PX 5000
 *    - Si échec : 409 TICKET_ALREADY_CLAIMED (autre agent)
 * 4. Re-vérification transactionnelle : FOR UPDATE → si déjà CALLED → 409
 * 5. UPDATE + COMMIT + émettre les événements
 */
async function callTargeted(
  db: Client,
  redis: Redis,
  tenant: TenantContext,
  id: string,
  counterId: string,
  bus: RealtimeBus
): Promise<Record<string, unknown>> {
  // Étape 1 : charger le ticket pour la vérification de transition
  const row = await loadTicket(db, tenant, id);

  // Étape 2 : vérifier la transition (lève ILLEGAL_TRANSITION si status non légal)
  nextStatus(row.status, "call");

  // Étape 3 : verrou Redis durci SET NX PX 5000
  const lockKey = `ticket-lock:${id}`;
  const locked = await redis.set(lockKey, counterId, "PX", 5000, "NX");
  if (locked === null) {
    // Un autre agent tient le verrou → TICKET_ALREADY_CLAIMED
    const owner = await redis.get(lockKey);
    throw new SigfaError("TICKET_ALREADY_CLAIMED", "Ce ticket a déjà été pris.", 409, {
      claimedByCounterId: owner ?? "unknown",
    });
  }

  // Étape 4 : re-vérification transactionnelle (FOR UPDATE)
  await db.query("BEGIN");
  const checkRes = await db.query(
    `SELECT id, status, queue_id, service_id, counter_id, called_at
       FROM tickets WHERE id = $1 AND bank_id = $2 FOR UPDATE`,
    [id, tenant.bankId]
  );
  const freshRow = checkRes.rows[0] as {
    id: string; status: string; queue_id: string; service_id: string;
    counter_id: string | null; called_at: Date | null;
  } | undefined;

  if (!freshRow) {
    await db.query("ROLLBACK");
    await redis.del(lockKey);
    throw new SigfaError("NOT_FOUND", "Ticket introuvable.", 404);
  }

  // Re-vérification : si entre-temps le ticket a été pris → 409 TICKET_ALREADY_CLAIMED
  if (freshRow.status !== "WAITING") {
    await db.query("ROLLBACK");
    await redis.del(lockKey);
    throw new SigfaError("TICKET_ALREADY_CLAIMED", "Ce ticket a déjà été pris.", 409, {
      currentStatus: freshRow.status,
    });
  }

  // Étape 5 : UPDATE + COMMIT
  const now = new Date();
  await db.query(
    `UPDATE tickets SET status = 'CALLED', counter_id = $1, called_at = COALESCE(called_at, $2), updated_at = NOW() WHERE id = $3`,
    [counterId, now, id]
  );
  await db.query("COMMIT");

  // Post-commit: libérer le verrou et émettre les événements
  await redis.del(lockKey);
  await afterCall(bus, redis, db, { ticketId: id, queueId: freshRow.queue_id, counterId });
  return callView(id, freshRow.service_id, counterId, freshRow.called_at ?? now);
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
      // API-007 : le cycle ticket PILOTE le statut agent (AVAILABLE → SERVING).
      await driveAgentCycle(db, getBus(c), tenant, row.counter_id, "SERVING");
      return c.json({ id: row.id, status: target, counterId: row.counter_id ?? undefined }, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/**
 * Pilote le statut de l'agent du guichet via le cycle ticket (API-007).
 * Tolérant : sans guichet, sans agent affecté, ou si la transition n'est plus
 * légale (statut déjà à la cible), l'appel est sans effet — jamais d'erreur 5xx.
 *
 * @param db        - Connexion PG
 * @param bus       - Bus temps réel
 * @param tenant    - Contexte tenant
 * @param counterId - Guichet du ticket (peut être null)
 * @param target    - Statut cible piloté (SERVING au serve, AVAILABLE au close)
 */
async function driveAgentCycle(
  db: Client,
  bus: RealtimeBus,
  tenant: TenantContext,
  counterId: string | null,
  target: "SERVING" | "AVAILABLE"
): Promise<void> {
  if (!counterId || !tenant.bankId) return;
  const res = await db.query(
    `SELECT agent_id FROM counters WHERE id = $1 AND bank_id = $2`,
    [counterId, tenant.bankId]
  );
  const agentId = (res.rows[0] as { agent_id: string | null } | undefined)?.agent_id;
  if (!agentId) return;
  const from = await getCurrentStatus(db, agentId);
  if (from === target) return;
  try {
    await changeAgentStatus({
      db,
      bus,
      bankId: tenant.bankId,
      agentId,
      target,
      cycle: true,
    });
  } catch {
    // Transition non légale dans l'état courant (ex: agent PAUSED) → ignorée.
  }
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
      // API-007 : clôture → l'agent repasse AVAILABLE (piloté par le cycle).
      await driveAgentCycle(db, getBus(c), tenant, row.counter_id, "AVAILABLE");
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
  // Forme CONTRAT ticket:closed : { ticketId, waitTime, serviceTime }.
  bus.emit("ticket:closed", row.agency_id, {
    ticketId: row.id,
    waitTime,
    serviceTime,
  });
  await emitQueueUpdated(bus, redis, db, row.agency_id, row.queue_id);
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
      await emitQueueUpdated(getBus(c), c.get("redis"), db, row.agency_id, row.queue_id);
      // API-007 : no-show → l'agent repasse AVAILABLE (piloté par le cycle).
      await driveAgentCycle(db, getBus(c), tenant, row.counter_id, "AVAILABLE");
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
    // La réinsertion cible copie l'agency_id source → même agence pour les deux files.
    await emitQueueUpdated(bus, redis, db, row.agency_id, row.queue_id);
    await emitQueueUpdated(bus, redis, db, row.agency_id, target.queueId);
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
  const agencyId = tenant.agencyIds[0];
  if (!agencyId) throw new SigfaError("FORBIDDEN", "Aucune agence dans le scope du JWT.", 403);
  const ctx = await resolveServiceQueue(db, { bankId: tenant.bankId, agencyId }, targetServiceId);
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
      await emitQueueUpdated(getBus(c), c.get("redis"), db, row.agency_id, row.queue_id);
      return c.json({ id: row.id, status: "ABANDONED" }, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}
