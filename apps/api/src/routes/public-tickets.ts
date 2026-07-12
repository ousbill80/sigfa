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

/** Variables de contexte Hono (injectées par app.ts). */
interface PublicEnv {
  Variables: { db: Client; redis: Redis };
}

/** Contexte Hono typé pour ce routeur. */
type PublicCtx = Context<PublicEnv>;

/** Pattern nanoid(21) — LA LOI `^[A-Za-z0-9_-]{21}$`. */
const TRACKING_RE = /^[A-Za-z0-9_-]{21}$/;

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
  registerTrack(router);
  registerFeedback(router);
  return router;
}

/** Émet le 404 OPAQUE unique (identique pour inconnu ET malformé). */
function opaqueNotFound(c: PublicCtx): Response {
  return c.json(buildError("TICKET_NOT_FOUND", "Ticket introuvable pour ce trackingId."), 404);
}

/** Émet une SigfaError au format LA LOI (sinon relance). */
function errorResponse(c: PublicCtx, err: unknown): Response {
  if (err instanceof SigfaError) {
    return c.json(buildError(err.code, err.message, err.details), err.httpStatus as 404 | 409 | 422);
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
    `SELECT id, agency_id, service_id, number, display_number, tracking_id,
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
