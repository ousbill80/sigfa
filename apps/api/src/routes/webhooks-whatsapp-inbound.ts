/**
 * Route webhook WhatsApp ENTRANT signé par banque (NOTIF-003 / CONTRACT-003).
 *
 * `POST /webhooks/whatsapp/inbound/:bankSlug` — PUBLIC (pas de JWT) mais SIGNATURE
 * HMAC-SHA256 PROPRE À LA BANQUE obligatoire :
 *  - Routage tenant par `bankSlug` → résolution de la config WhatsApp (secret,
 *    agence par défaut, mapping menu C4).
 *  - `bankSlug` inconnu / agence non résolue → **erreur OPAQUE** (pas de fuite de
 *    tenants existants), AUCUN ticket créé.
 *  - Signature `x-hub-signature-256` absente/invalide → **401**, aucun traitement.
 *  - Sinon : extraction du message + traitement (NLU règles, idempotence par
 *    `provider_message_id`, opt-in `INBOUND_WHATSAPP`, ticket API-003) sous garde
 *    tenant D5.
 *
 * Routeur isolé pour minimiser le risque de conflit d'intégration sur `app.ts`
 * (un seul `app.route(...)` ajouté).
 *
 * ## Armement RLS (SEC-002-CUTOVER-LOT8)
 * Webhook PUBLIC : le tenant (bankId) n'est PAS porté par une auth. Il est RÉSOLU
 * depuis le `bankSlug` via la config WhatsApp (`resolveWhatsAppConfig`). Cette
 * résolution de config par `bankSlug` PRÉCÈDE légitimement l'armement (chicken-and-egg :
 * on ne connaît le tenant QU'APRÈS avoir lu sa config — c'est la résolution du tenant
 * elle-même) et reste donc hors armement, documentée. UNE FOIS le `bankId` dérivé ET
 * la signature banque vérifiée, TOUT le traitement tenant (idempotence entrante,
 * opt-in, lecture de statut, émission de ticket) est routé DANS une transaction ARMÉE
 * `withArmedTenant(bankId)` (`app.current_bank_id` posé, RLS contraignante sur
 * `whatsapp_inbound_messages` / `notification_consents` / `tickets`). L'émission
 * (`issueTicketFor`, déjà transaction-aware depuis le lot 4) compose par SAVEPOINT
 * (`inTransaction:true`) dans cette transaction armée. Cette route est classée `ARMED`.
 *
 * @module
 */

import { Hono, type Context } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import type { QueryFn } from "@sigfa/database";
import { buildError } from "src/lib/errors.js";
import { asArmable, withArmedTenant, type ArmableConnection } from "src/lib/armed-tenant.js";
import {
  hashPhone,
  encryptPhone,
  normalizePhone,
} from "src/lib/phone-cipher.js";
import { createNoopBus, type RealtimeBus } from "src/services/realtime.js";
import { issueTicketFor } from "src/routes/tickets.js";
import {
  processInboundMessage,
  extractInboundMessage,
  type ResolvedWhatsAppConfig,
  type PhoneCryptoPort,
  type IssueTicketPort,
} from "src/services/whatsapp/whatsapp-inbound.js";

/** Variables de contexte Hono (injectées par app.ts). */
interface WebhookEnv {
  Variables: { db: Client; redis: Redis; bus: RealtimeBus };
}

/** En-tête de signature WhatsApp (Meta). */
const SIGNATURE_HEADER = "x-hub-signature-256";

/** Détecte un ordre transactionnel que la transaction ARMÉE englobante possède déjà. */
function isEnvelopeTxnStatement(sql: string): boolean {
  const s = sql.trim().toUpperCase();
  return (
    s === "BEGIN" ||
    s === "COMMIT" ||
    s === "ROLLBACK" ||
    s.startsWith("SET LOCAL APP.CURRENT_BANK_ID")
  );
}

/**
 * Construit un `QueryFn` ARMÉ pour le service entrant : les vraies requêtes passent
 * à la connexion déjà armée par `withArmedTenant`, mais les ordres transactionnels
 * enveloppants (`BEGIN`/`COMMIT`/`ROLLBACK` et le `SET LOCAL app.current_bank_id`
 * émis par le `withTenant` interne du service) sont NEUTRALISÉS : la transaction
 * armée UNIQUE de la route les possède déjà. Le service conserve ainsi son code
 * (garde tenant D5 inchangée) tout en exécutant ses écritures SOUS `app.current_bank_id`.
 *
 * @param conn - Connexion armée (transaction ouverte, `app.current_bank_id` posé)
 * @returns `QueryFn` armé neutralisant les ordres d'enveloppe transactionnelle
 */
function armedQueryFnFrom(conn: ArmableConnection): QueryFn {
  return async (sql: string) => {
    if (isEnvelopeTxnStatement(sql)) return { rows: [] };
    const res = await conn.query(sql);
    return { rows: res.rows as Record<string, unknown>[] };
  };
}

/** Port crypto réel (DB-008). */
const phoneCrypto: PhoneCryptoPort = { hashPhone, encryptPhone, normalizePhone };

/**
 * Résout la config WhatsApp d'une banque par `bankSlug`. Renvoie `null` si le slug
 * est inconnu, si la config WhatsApp est absente, ou si l'agence par défaut n'est
 * pas résolue — le caller émet alors une erreur OPAQUE (anti-énumération tenant).
 *
 * @param db       - Connexion PG
 * @param bankSlug - Slug de la banque (routage tenant)
 * @returns Config résolue, ou `null`
 */
export async function resolveWhatsAppConfig(
  db: Client,
  bankSlug: string
): Promise<ResolvedWhatsAppConfig | null> {
  const res = await db.query(
    `SELECT wc.bank_id, wc.default_agency_id, wc.webhook_secret
       FROM whatsapp_config wc
       JOIN banks b ON b.id = wc.bank_id
      WHERE b.slug = $1`,
    [bankSlug]
  );
  const row = res.rows[0] as
    | { bank_id: string; default_agency_id: string | null; webhook_secret: string | null }
    | undefined;
  if (!row || row.default_agency_id === null || !row.webhook_secret) return null;

  const mapRes = await db.query(
    `SELECT keyword, service_id FROM whatsapp_menu_mapping WHERE bank_id = $1 ORDER BY keyword ASC`,
    [row.bank_id]
  );
  const menuMapping = (mapRes.rows as { keyword: string; service_id: string }[]).map(
    (m) => ({ keyword: m.keyword, serviceId: m.service_id })
  );
  return {
    bankId: row.bank_id,
    agencyId: row.default_agency_id,
    webhookSecret: row.webhook_secret,
    menuMapping,
  };
}

/**
 * Vérifie la signature `x-hub-signature-256` (format `sha256=<hex>`) en temps
 * constant, avec le secret propre à la banque. Absente/mal formée/incorrecte ⇒ false.
 *
 * @param rawBody   - Corps brut EXACT reçu (avant parse)
 * @param signature - En-tête `x-hub-signature-256` (peut être `undefined`)
 * @param secret    - Secret HMAC propre à la banque
 * @returns `true` si la signature correspond
 */
export function verifyInboundSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  const trimmed = signature.trim().toLowerCase();
  const prefix = "sha256=";
  if (!trimmed.startsWith(prefix)) return false;
  const given = trimmed.slice(prefix.length);
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const givenBuf = Buffer.from(given, "utf8");
  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}

/**
 * Crée le routeur webhook WhatsApp entrant (monté sous /api/v1).
 *
 * @returns Routeur Hono du webhook entrant
 */
export function createWhatsAppInboundRouter(): Hono<WebhookEnv> {
  const router = new Hono<WebhookEnv>();
  router.post("/webhooks/whatsapp/inbound/:bankSlug", handleInbound);
  return router;
}

/** Émet une erreur OPAQUE 404 (anti-énumération tenant — identique inconnu/mal résolu). */
function opaque(c: Context<WebhookEnv>): Response {
  return c.json(buildError("BANK_NOT_FOUND", "Banque introuvable pour ce slug."), 404);
}

/** Handler du webhook WhatsApp entrant. */
async function handleInbound(c: Context<WebhookEnv>): Promise<Response> {
  const bankSlug = c.req.param("bankSlug") ?? "";
  const db = c.get("db");

  // 1. Résolution tenant par bankSlug (opaque si inconnu / non résolu).
  const config = await resolveWhatsAppConfig(db, bankSlug);
  if (!config) return opaque(c);

  // 2. Corps brut EXACT pour la vérification de signature banque.
  const rawBody = await c.req.text();
  const signature = c.req.header(SIGNATURE_HEADER);
  if (!verifyInboundSignature(rawBody, signature, config.webhookSecret)) {
    return c.json(
      buildError(
        "WEBHOOK_SIGNATURE_INVALID",
        "La signature HMAC-SHA256 est invalide ou absente."
      ),
      401
    );
  }

  // 3. Parse + extraction du message texte (payload de statut/autre type ⇒ ignoré).
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return c.json(buildError("BAD_REQUEST", "Corps JSON invalide."), 400);
  }
  const message = extractInboundMessage(json);
  if (!message) {
    // Aucun message texte exploitable : accusé neutre (Meta attend 200).
    return c.json({ success: true }, 200);
  }

  const redis = c.get("redis");
  const bus = (c.get("bus") as RealtimeBus | undefined) ?? createNoopBus();

  // 4-5. SEC-002 : TOUT le traitement tenant est routé DANS une transaction ARMÉE
  //      (`app.current_bank_id = config.bankId`). Le port d'émission réutilise
  //      `issueTicketFor` en mode transaction-aware (SAVEPOINT) sur la connexion armée.
  await withArmedTenant(asArmable(db), config.bankId, async (conn) => {
    const armedDb = conn as unknown as Client;
    const issueTicket: IssueTicketPort = {
      issue: async (args) => {
        const result = await issueTicketFor(
          armedDb,
          redis,
          { bankId: args.bankId, agencyId: args.agencyId },
          {
            serviceId: args.serviceId,
            channel: "WHATSAPP",
            phoneNumber: args.phoneNumber,
            smsConsent: true,
          },
          bus,
          undefined,
          // Transaction armée englobante ouverte → composition par SAVEPOINT.
          true
        );
        return {
          number: String(result["number"]),
          position: Number(result["position"]),
          estimatedWaitMinutes: Number(result["estimatedWaitMinutes"]),
        };
      },
    };

    // Le service garde son `withTenant` interne ; l'`armedQueryFn` neutralise ses
    // ordres d'enveloppe transactionnelle (la transaction armée UNIQUE les possède).
    await processInboundMessage(message, {
      queryFn: armedQueryFnFrom(conn),
      config,
      crypto: phoneCrypto,
      issueTicket,
    });
  });

  return c.json({ success: true }, 200);
}
