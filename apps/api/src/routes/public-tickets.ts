/**
 * Routes PUBLIQUES de suivi & feedback client (API-010) — SANS JWT.
 *
 * - `GET  /public/tickets/:trackingId`          suivi public (statut/position/estimation)
 * - `POST /public/tickets/:trackingId/feedback` feedback client (note 1–5 + commentaire)
 *
 * ## Sécurité (LA LOI)
 * - Aucune PII ni uuid interne exposés : le suivi projette un DTO public strict.
 * - Anti-énumération : trackingId inconnu OU malformé → **404 OPAQUE identique**.
 * - Fenêtre feedback : `NOW() - closed_at > INTERVAL '24 hours'` en UTC strict.
 * - Anti-spam : sliding-window Redis (feedback 5/min par IP ET par trackingId ;
 *   suivi 30/min par IP) → 429 LA LOI + `Retry-After`.
 *
 * @module
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Redis } from "ioredis";
import type { Client } from "pg";
import { SigfaError, buildError } from "src/lib/errors.js";
import { checkRateLimit, clientIp } from "src/lib/rate-limit.js";
import { sanitizeComment, CommentTooLongError, CommentControlCharError } from "src/lib/comment-sanitize.js";
import { incrementDailyNps } from "src/services/feedback-nps.js";
import {
  requireIdempotencyKey,
  acquireIdempotency,
  storeReplay,
  releaseIdempotencyLock,
} from "src/services/idempotency.js";
import { createNoopBus, type RealtimeBus } from "src/services/realtime.js";
import { issueTicketFor, type IssueTicketInput } from "src/routes/tickets.js";

/** Variables de contexte Hono (injectées par app.ts). */
interface PublicEnv {
  Variables: { db: Client; redis: Redis; bus: RealtimeBus };
}

/** Contexte Hono typé pour ce routeur. */
type PublicCtx = Context<PublicEnv>;

/** Pattern nanoid(21) — LA LOI `^[A-Za-z0-9_-]{21}$`. */
const TRACKING_RE = /^[A-Za-z0-9_-]{21}$/;

/** Format E.164 LA LOI des sous-schémas canal (`^\+[1-9]\d{7,14}$`). */
const phoneE164 = z.string().regex(/^\+[1-9]\d{7,14}$/);
/** Priorité contractuelle (TicketPriority). */
const priorityEnum = z.enum(["STANDARD", "PRIORITY", "VIP", "PMR", "SENIOR"]);

/**
 * Corps `POST /public/tickets` — oneOf discriminé par `channel` (LA LOI).
 * - KIOSK/QR : téléphone FACULTATIF (mais `smsConsent` requis si téléphone).
 * - MOBILE/WHATSAPP : téléphone + `smsConsent` OBLIGATOIRES.
 * `agencyId`/`serviceId` proviennent du CORPS (création publique sans JWT).
 */
const publicCreateSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("KIOSK"),
    serviceId: z.string().uuid(),
    operationId: z.string().uuid().optional(),
    targetManagerId: z.string().uuid().optional(),
    agencyId: z.string().uuid(),
    priority: priorityEnum.optional(),
    phoneNumber: phoneE164.nullish(),
    smsConsent: z.boolean().optional(),
  }),
  z.object({
    channel: z.literal("QR"),
    serviceId: z.string().uuid(),
    operationId: z.string().uuid().optional(),
    targetManagerId: z.string().uuid().optional(),
    agencyId: z.string().uuid(),
    priority: priorityEnum.optional(),
    phoneNumber: phoneE164.nullish(),
    smsConsent: z.boolean().optional(),
  }),
  z.object({
    channel: z.literal("MOBILE"),
    serviceId: z.string().uuid(),
    operationId: z.string().uuid().optional(),
    targetManagerId: z.string().uuid().optional(),
    agencyId: z.string().uuid(),
    priority: priorityEnum.optional(),
    phoneNumber: phoneE164,
    smsConsent: z.boolean(),
  }),
  z.object({
    channel: z.literal("WHATSAPP"),
    serviceId: z.string().uuid(),
    operationId: z.string().uuid().optional(),
    targetManagerId: z.string().uuid().optional(),
    agencyId: z.string().uuid(),
    priority: priorityEnum.optional(),
    phoneNumber: phoneE164,
    smsConsent: z.boolean(),
  }),
]);

/** Données validées d'émission publique. */
type PublicCreateInput = z.infer<typeof publicCreateSchema>;

/** Schéma du corps de feedback (LA LOI `FeedbackRequest`) — note 1–5 entière. */
const feedbackSchema = z.object({
  note: z.number().int().min(1).max(5),
  comment: z.string().max(500).nullish(),
});

/** Ligne ticket brute nécessaire au suivi/feedback. */
interface TicketRow {
  id: string;
  agency_id: string;
  service_id: string;
  operation_id: string | null;
  number: number;
  display_number: string | null;
  tracking_id: string;
  channel: string;
  status: string;
  priority: string;
  closed_at: Date | null;
  feedback_score: number | null;
  issued_at: Date;
}

/**
 * Crée le routeur public (API-010). Montable sous /api/v1 comme les autres.
 *
 * @returns Routeur Hono
 */
export function createPublicTicketRouter(): Hono<PublicEnv> {
  const router = new Hono<PublicEnv>();
  registerCreate(router);
  registerPublicOperations(router);
  registerPublicRelationshipManagers(router);
  registerTrack(router);
  registerFeedback(router);
  return router;
}

/**
 * GET /public/agencies/:agencyId/relationship-managers (role NONE) — liste
 * publique NOMINATIVE des conseillers (MODEL-API-B/D5).
 *
 * Retourne UNIQUEMENT `{ id, displayName, photoUrl? }` des users conseillers
 * ACTIFS de l'agence (`is_relationship_manager AND is_active AND deleted_at IS
 * NULL`). **ZÉRO PII** : jamais email/rôle/téléphone/phone_hash — liste blanche
 * stricte de colonnes (la requête ne SELECTionne que id/display_name/photo_url).
 * `agencyId` malformé → 400 VALIDATION_ERROR. Scope agence (aucune fuite tenant :
 * filtre `au.agency_id`). Un conseiller sans `display_name` est exclu (nominatif).
 * Rate-limit IP anti-énumération (60/min) appliqué en amont par
 * `mountGlobalRateLimits` sur le préfixe `/public/agencies` (config/rate-limits.ts,
 * source IP via `TRUST_PROXY`) : au-delà → 429 TOO_MANY_REQUESTS.
 */
function registerPublicRelationshipManagers(router: Hono<PublicEnv>): void {
  router.get("/public/agencies/:agencyId/relationship-managers", async (c) => {
    const agencyId = c.req.param("agencyId");
    if (!PUBLIC_UUID_RE.test(agencyId)) {
      return c.json(buildError("VALIDATION_ERROR", "agencyId requis (UUID)."), 400);
    }
    const db = c.get("db");
    const res = await db.query(
      `SELECT u.id, u.display_name, u.photo_url
         FROM users u
         JOIN agency_users au ON au.user_id = u.id AND au.agency_id = $1
        WHERE u.is_relationship_manager = true
          AND u.is_active = true
          AND u.deleted_at IS NULL
          AND u.display_name IS NOT NULL
        ORDER BY u.display_name ASC, u.id ASC`,
      [agencyId]
    );
    const data = (res.rows as PublicRelationshipManagerRow[]).map(publicRelationshipManagerDto);
    return c.json({ data }, 200);
  });
}

/** Ligne brute d'un conseiller public (liste blanche stricte — zéro PII). */
interface PublicRelationshipManagerRow {
  id: string;
  display_name: string;
  photo_url: string | null;
}

/** Projette le DTO public d'un conseiller (LA LOI `PublicRelationshipManager`). */
function publicRelationshipManagerDto(row: PublicRelationshipManagerRow): Record<string, unknown> {
  return {
    id: row.id,
    displayName: row.display_name,
    ...(row.photo_url !== null ? { photoUrl: row.photo_url } : {}),
  };
}

/** Regex UUID canonique pour valider `agencyId`/`serviceId`. */
const PUBLIC_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /public/agencies/:agencyId/operations?serviceId= (role NONE) — affichage borne.
 *
 * Retourne les opérations ACTIVES d'un service, avec `slaMinutes` **RÉSOLU**
 * (`operation.sla_minutes ?? service.sla_minutes` — D4) pour l'estimation d'attente.
 * Aucune donnée sensible : id/code/name/slaMinutes(résolu)/iconKey uniquement.
 * `agencyId`/`serviceId` malformés → 400 VALIDATION_ERROR.
 * Rate-limit IP anti-énumération (60/min) appliqué en amont par
 * `mountGlobalRateLimits` sur le préfixe `/public/agencies` (config/rate-limits.ts,
 * source IP via `TRUST_PROXY`) : au-delà → 429 TOO_MANY_REQUESTS.
 */
function registerPublicOperations(router: Hono<PublicEnv>): void {
  router.get("/public/agencies/:agencyId/operations", async (c) => {
    const agencyId = c.req.param("agencyId");
    const serviceId = c.req.query("serviceId");
    if (!PUBLIC_UUID_RE.test(agencyId) || !serviceId || !PUBLIC_UUID_RE.test(serviceId)) {
      return c.json(buildError("VALIDATION_ERROR", "agencyId/serviceId requis (UUID)."), 400);
    }
    const db = c.get("db");
    const res = await db.query(
      `SELECT o.id, o.code, o.name,
              COALESCE(o.sla_minutes, s.sla_minutes) AS sla_minutes, o.icon_key
         FROM operations o JOIN services s ON s.id = o.service_id
        WHERE o.agency_id = $1 AND o.service_id = $2 AND o.is_active = true
        ORDER BY o.display_order ASC, o.created_at ASC`,
      [agencyId, serviceId]
    );
    const data = (res.rows as PublicOperationRow[]).map(publicOperationDto);
    return c.json({ data }, 200);
  });
}

/** Ligne brute d'opération publique (SLA déjà résolu par la requête). */
interface PublicOperationRow {
  id: string;
  code: string;
  name: string;
  sla_minutes: number | null;
  icon_key: string | null;
}

/** Projette le DTO public d'une opération (LA LOI `PublicOperation`). */
function publicOperationDto(row: PublicOperationRow): Record<string, unknown> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    slaMinutes: row.sla_minutes,
    ...(row.icon_key !== null ? { iconKey: row.icon_key } : {}),
  };
}

/** Résout le bus depuis le contexte, ou fournit un no-op validant. */
function getBus(c: PublicCtx): RealtimeBus {
  return (c.get("bus") as RealtimeBus | undefined) ?? createNoopBus();
}

// ── POST /public/tickets ─────────────────────────────────────────────────────

/**
 * Enregistre l'émission de ticket PUBLIQUE (borne/QR/mobile/WhatsApp), SANS JWT.
 *
 * Mutation critique → `X-Idempotency-Key` OBLIGATOIRE (verrou SET NX atomique).
 * L'agence/le service viennent du CORPS (validés existants/actifs) ; le `bank_id`
 * du ticket est DÉRIVÉ de la file résolue — jamais accepté du client (anti-fuite).
 * Le rate-limit IP (60/min) du préfixe `/public/tickets` est déjà appliqué en amont
 * par `mountGlobalRateLimits` (config/rate-limits.ts, source IP via `TRUST_PROXY`).
 * Fenêtre indépendante de celle de `/public/agencies` (dimension `public-tickets`).
 */
function registerCreate(router: Hono<PublicEnv>): void {
  router.post("/public/tickets", async (c) => {
    const redis = c.get("redis");
    try {
      const key = requireIdempotencyKey(c.req.header("X-Idempotency-Key"));
      const parsed = publicCreateSchema.safeParse(await parseJson(c));
      if (!parsed.success) {
        return c.json(buildError("VALIDATION_ERROR", "Corps invalide.", { issues: parsed.error.issues }), 400);
      }
      // Scope idempotence indépendant du tenant (création publique multi-banque).
      const scope = "public-tickets";
      const outcome = await acquireIdempotency(redis, scope, key, parsed.data);
      if (outcome.kind === "replay") return replayResponse(c, outcome.result);
      let bodyStr: string;
      try {
        const dto = await issuePublicTicket(c, parsed.data);
        bodyStr = JSON.stringify(dto);
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

/**
 * Émet le ticket via le cœur RÉUTILISABLE `issueTicketFor` (tickets.ts) puis
 * projette la réponse PUBLIQUE (LA LOI `PublicTicketCreatedResponse`) — SANS
 * exposer l'uuid interne. Le `bankId` est dérivé côté file (null en entrée).
 *
 * @param c     - Contexte Hono
 * @param input - Corps validé (discriminé par canal)
 */
async function issuePublicTicket(c: PublicCtx, input: PublicCreateInput): Promise<Record<string, unknown>> {
  const issueInput: IssueTicketInput = {
    serviceId: input.serviceId,
    operationId: input.operationId,
    targetManagerId: input.targetManagerId,
    channel: input.channel,
    priority: input.priority,
    phoneNumber: input.phoneNumber ?? undefined,
    smsConsent: input.smsConsent,
  };
  const result = await issueTicketFor(
    c.get("db"),
    c.get("redis"),
    { bankId: null, agencyId: input.agencyId },
    issueInput,
    getBus(c)
  );
  return publicCreatedDto(result);
}

/**
 * Projette le DTO public de création — liste blanche stricte des champs LA LOI.
 * L'uuid interne (`id`) présent dans le résultat d'émission est ÉCARTÉ.
 *
 * @param r - Résultat brut de `issueTicketFor`
 */
function publicCreatedDto(r: Record<string, unknown>): Record<string, unknown> {
  return {
    trackingId: r["trackingId"],
    number: r["number"],
    displayNumber: r["displayNumber"],
    status: r["status"],
    priority: r["priority"],
    channel: r["channel"],
    position: r["position"],
    estimatedWaitMinutes: r["estimatedWaitMinutes"],
    serviceId: r["serviceId"],
    ...(r["operationId"] ? { operationId: r["operationId"] } : {}),
    ...(r["targetManagerId"] ? { targetManagerId: r["targetManagerId"] } : {}),
    agencyId: r["agencyId"],
    createdAt: r["createdAt"],
  };
}

/** Rejoue une réponse enregistrée byte-identique (JSON). */
function replayResponse(c: PublicCtx, replay: { status: number; body: string }): Response {
  return c.newResponse(replay.body, replay.status as 201, { "Content-Type": "application/json" });
}

/** Parse le corps JSON, `null` si malformé. */
async function parseJson(c: PublicCtx): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/** Émet le 404 OPAQUE unique (identique pour inconnu ET malformé). */
function opaqueNotFound(c: PublicCtx): Response {
  return c.json(buildError("TICKET_NOT_FOUND", "Ticket introuvable pour ce trackingId."), 404);
}

/** Émet une SigfaError au format LA LOI (sinon relance). */
function errorResponse(c: PublicCtx, err: unknown): Response {
  if (err instanceof SigfaError) {
    return c.json(buildError(err.code, err.message, err.details), err.httpStatus as 400 | 403 | 404 | 409 | 422);
  }
  throw err;
}

/**
 * Charge un ticket par trackingId (scope global public). Renvoie `null` si le
 * format est invalide OU si aucun ticket ne correspond — le caller émet alors un
 * 404 OPAQUE identique (aucun oracle d'énumération).
 *
 * @param db         - Connexion PG
 * @param trackingId - Identifiant public candidat
 */
async function loadByTracking(db: Client, trackingId: string): Promise<TicketRow | null> {
  if (!TRACKING_RE.test(trackingId)) return null;
  const res = await db.query(
    `SELECT id, agency_id, service_id, operation_id, number, display_number, tracking_id,
            channel, status, priority, closed_at, feedback_score, issued_at
       FROM tickets WHERE tracking_id = $1`,
    [trackingId]
  );
  return (res.rows[0] as TicketRow | undefined) ?? null;
}

// ── GET /public/tickets/:trackingId ──────────────────────────────────────────

/** Enregistre le suivi public (cache 30 s + ETag, DTO sans uuid interne). */
function registerTrack(router: Hono<PublicEnv>): void {
  router.get("/public/tickets/:trackingId", async (c) => {
    const redis = c.get("redis");
    const limited = await checkRateLimit(redis, `track:ip:${clientIp(c)}`, 30, 60);
    if (!limited.allowed) return tooMany(c, limited.retryAfterSeconds);
    const trackingId = c.req.param("trackingId");
    const row = await loadByTracking(c.get("db"), trackingId);
    if (!row) return opaqueNotFound(c);
    const dto = publicStatusDto(row);
    const etag = `"${row.id.slice(0, 8)}-${row.status}-${row.number}"`;
    c.header("Cache-Control", "max-age=30");
    c.header("ETag", etag);
    return c.json(dto, 200);
  });
}

/**
 * Projette le DTO public (LA LOI `PublicTicketStatus`) — SANS uuid interne.
 * Position/estimation ne sont pas recalculées ici (hors périmètre suivi léger) :
 * un WAITING expose `position`/`estimatedWaitMinutes` neutres, jamais d'uuid.
 *
 * @param row - Ligne ticket
 */
function publicStatusDto(row: TicketRow): Record<string, unknown> {
  return {
    trackingId: row.tracking_id,
    number: `A${String(row.number).padStart(3, "0")}`,
    displayNumber: row.display_number ?? `A${String(row.number).padStart(3, "0")}`,
    status: row.status,
    priority: row.priority,
    channel: row.channel,
    position: 0,
    estimatedWaitMinutes: 0,
    agencyId: row.agency_id,
    serviceId: row.service_id,
    ...(row.operation_id ? { operationId: row.operation_id } : {}),
    createdAt: row.issued_at.toISOString(),
  };
}

// ── POST /public/tickets/:trackingId/feedback ────────────────────────────────

/** Enregistre la soumission de feedback (rate-limit IP ET trackingId). */
function registerFeedback(router: Hono<PublicEnv>): void {
  router.post("/public/tickets/:trackingId/feedback", async (c) => {
    const redis = c.get("redis");
    const trackingId = c.req.param("trackingId");
    const rl = await enforceFeedbackRateLimit(c, redis, trackingId);
    if (rl) return rl;
    const parsed = await parseFeedbackBody(c);
    if ("response" in parsed) return parsed.response;
    try {
      return await submitFeedback(c, trackingId, parsed.note, parsed.comment);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Applique le rate-limit feedback : 5/min par IP ET 5/min par trackingId. */
async function enforceFeedbackRateLimit(c: PublicCtx, redis: Redis, trackingId: string): Promise<Response | null> {
  const byIp = await checkRateLimit(redis, `feedback:ip:${clientIp(c)}`, 5, 60);
  if (!byIp.allowed) return tooMany(c, byIp.retryAfterSeconds);
  const byTracking = await checkRateLimit(redis, `feedback:tid:${trackingId}`, 5, 60);
  if (!byTracking.allowed) return tooMany(c, byTracking.retryAfterSeconds);
  return null;
}

/** Résultat de parsing : soit les données validées, soit une réponse d'erreur. */
type ParseResult = { note: number; comment: string | null } | { response: Response };

/**
 * Parse et valide le corps : note 1–5 + commentaire nettoyé/rejeté.
 * Retourne une réponse 400 VALIDATION_ERROR sur échec de forme ou de sanitation.
 *
 * @param c - Contexte Hono
 */
async function parseFeedbackBody(c: PublicCtx): Promise<ParseResult> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { response: c.json(buildError("VALIDATION_ERROR", "Corps JSON invalide."), 400) };
  }
  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) {
    return { response: c.json(buildError("VALIDATION_ERROR", "Note invalide (entier 1–5 requis)."), 400) };
  }
  try {
    return { note: parsed.data.note, comment: sanitizeComment(parsed.data.comment) };
  } catch (err) {
    if (err instanceof CommentTooLongError || err instanceof CommentControlCharError) {
      return { response: c.json(buildError("VALIDATION_ERROR", err.message), 400) };
    }
    throw err;
  }
}

/**
 * Vérifie les règles métier, persiste le feedback (une seule fois par ticket)
 * et agrège le NPS du jour. 404 opaque si ticket inconnu/malformé.
 *
 * @param c          - Contexte Hono
 * @param trackingId - Identifiant public
 * @param note       - Note 1–5
 * @param comment    - Commentaire nettoyé (ou null)
 */
async function submitFeedback(c: PublicCtx, trackingId: string, note: number, comment: string | null): Promise<Response> {
  const db = c.get("db");
  const row = await loadByTracking(db, trackingId);
  if (!row) return opaqueNotFound(c);
  assertFeedbackAllowed(row);
  const applied = await persistFeedback(db, row.id, note, comment);
  if (!applied) throw new SigfaError("FEEDBACK_ALREADY_SUBMITTED", "Un feedback a déjà été soumis pour ce ticket.", 409);
  await incrementDailyNps(db, {
    bankId: await bankIdOf(db, row.id),
    agencyId: row.agency_id,
    serviceId: row.service_id,
    note,
    closedAt: row.closed_at ?? new Date(),
  });
  return c.json({ success: true, message: "Merci pour votre avis !" }, 201);
}

/**
 * Applique les gardes métier LA LOI (statut + doublon + fenêtre 24 h UTC strict).
 * La vérification de fenêtre est faite à partir de `closed_at` en UTC (les Date JS
 * sont en UTC epoch — aucun décalage timezone n'est appliqué).
 *
 * @param row - Ligne ticket chargée
 */
function assertFeedbackAllowed(row: TicketRow): void {
  if (row.status !== "DONE") {
    throw new SigfaError("TICKET_NOT_CLOSED", "Le feedback n'est autorisé que pour les tickets en état DONE.", 422, {
      currentStatus: row.status,
    });
  }
  if (row.feedback_score !== null) {
    throw new SigfaError("FEEDBACK_ALREADY_SUBMITTED", "Un feedback a déjà été soumis pour ce ticket.", 409);
  }
  const closedAt = row.closed_at;
  const elapsedMs = closedAt ? Date.now() - closedAt.getTime() : Number.POSITIVE_INFINITY;
  if (elapsedMs > 24 * 60 * 60 * 1000) {
    throw new SigfaError("FEEDBACK_WINDOW_EXPIRED", "La fenêtre de feedback de 24 h après clôture est expirée.", 422, {
      windowHours: 24,
    });
  }
}

/**
 * Persiste le feedback de façon atomique et idempotente PAR TICKET :
 * l'UPDATE ne s'applique qu'à un ticket DONE dont `feedback_score IS NULL`
 * et dont la fenêtre 24 h n'est pas expirée (garde SQL en UTC strict).
 *
 * @param db      - Connexion PG
 * @param id      - UUID interne du ticket
 * @param note    - Note 1–5
 * @param comment - Commentaire nettoyé
 * @returns `true` si la ligne a été mise à jour (première soumission), `false` sinon
 */
async function persistFeedback(db: Client, id: string, note: number, comment: string | null): Promise<boolean> {
  const res = await db.query(
    `UPDATE tickets
        SET feedback_score = $2, feedback_comment = $3, feedback_at = now(), updated_at = now()
      WHERE id = $1
        AND status = 'DONE'
        AND feedback_score IS NULL
        AND NOW() - closed_at <= INTERVAL '24 hours'
      RETURNING id`,
    [id, note, comment]
  );
  return (res.rowCount ?? 0) > 0;
}

/** Résout le bankId (tenant) du ticket pour l'agrégat NPS. */
async function bankIdOf(db: Client, id: string): Promise<string> {
  const res = await db.query(`SELECT bank_id FROM tickets WHERE id = $1`, [id]);
  return (res.rows[0] as { bank_id: string }).bank_id;
}

/** Réponse 429 LA LOI + en-tête Retry-After. */
function tooMany(c: PublicCtx, retryAfterSeconds: number): Response {
  c.header("Retry-After", String(retryAfterSeconds));
  return c.json(
    buildError("TOO_MANY_REQUESTS", "Limite de débit atteinte. Réessayez ultérieurement.", { retryAfterSeconds }),
    429
  );
}
