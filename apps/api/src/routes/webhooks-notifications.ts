/**
 * Routes webhook d'accusé de livraison des notifications (NOTIF-002 / CONTRACT-007).
 *
 * `POST /webhooks/notifications/:provider/delivery` — PUBLIC (pas de JWT) mais
 * SIGNATURE fournisseur OBLIGATOIRE :
 *  - Signature absente/invalide → 401 `INVALID_WEBHOOK_SIGNATURE`.
 *  - Payload invalide → 400 `BAD_REQUEST`.
 *  - Message introuvable → 404 `NOTIFICATION_NOT_FOUND`.
 *  - Sinon met à jour le journal par corrélation `provider_message_id`
 *    (`DELIVERED`/`FAILED`) sous garde tenant D5.
 *
 * La route est isolée dans son propre routeur pour minimiser le risque de conflit
 * d'intégration sur `app.ts` (un seul `app.route(...)` ajouté).
 *
 * @module
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Client } from "pg";
import type { QueryFn } from "@sigfa/database";
import { buildError } from "src/lib/errors.js";
import {
  applyDeliveryAck,
  verifyDeliverySignature,
  PROVIDER_SIGNATURE_HEADER,
  type DeliveryProvider,
} from "src/services/notification-delivery.js";

/** Variables de contexte Hono (injectées par app.ts). */
interface WebhookEnv {
  Variables: { db: Client };
}

/** Providers valides du webhook de livraison (LA LOI). */
const PROVIDERS = ["africastalking", "whatsapp", "resend"] as const;

/** Schéma du payload d'accusé (WebhookDeliveryPayload, LA LOI). */
const payloadSchema = z
  .object({
    messageId: z.string().min(1),
    status: z.enum(["QUEUED", "SENT", "DELIVERED", "FAILED"]),
    deliveredAt: z.string().datetime().optional(),
    failureReason: z.string().optional(),
  })
  .strict();

/** Résout le secret HMAC d'un provider depuis l'environnement. */
function providerSecret(provider: DeliveryProvider): string {
  const key = `NOTIF_WEBHOOK_SECRET_${provider.toUpperCase()}`;
  return process.env[key] ?? "";
}

/** Construit un `QueryFn` applicatif au-dessus du client pg injecté. */
function queryFnFrom(db: Client): QueryFn {
  return async (sql: string) => {
    const res = await db.query(sql);
    return { rows: res.rows as Record<string, unknown>[] };
  };
}

/**
 * Crée le routeur webhook de livraison des notifications (monté sous /api/v1).
 *
 * @returns Routeur Hono du webhook de livraison
 */
export function createNotificationWebhookRouter(): Hono<WebhookEnv> {
  const router = new Hono<WebhookEnv>();
  router.post("/webhooks/notifications/:provider/delivery", handleDelivery);
  return router;
}

/** Handler du webhook de livraison. */
async function handleDelivery(c: Context<WebhookEnv>): Promise<Response> {
  const provider = c.req.param("provider") ?? "";
  if (!(PROVIDERS as readonly string[]).includes(provider)) {
    return c.json(buildError("NOT_FOUND", "Fournisseur de webhook inconnu."), 404);
  }
  const typedProvider = provider as DeliveryProvider;

  // 1. Corps brut EXACT (bytes reçus) pour la vérification de signature.
  const rawBody = await c.req.text();
  const header = PROVIDER_SIGNATURE_HEADER[typedProvider];
  const signature = c.req.header(header);
  if (!verifyDeliverySignature(rawBody, signature, providerSecret(typedProvider))) {
    return c.json(
      buildError(
        "INVALID_WEBHOOK_SIGNATURE",
        `La signature du webhook ${provider} est invalide.`,
        { provider, expectedHeader: header }
      ),
      401
    );
  }

  // 2. Parse + validation du payload.
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return c.json(buildError("BAD_REQUEST", "Corps JSON invalide."), 400);
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    return c.json(
      buildError("BAD_REQUEST", "Payload d'accusé invalide."),
      400
    );
  }
  const { messageId, status, deliveredAt, failureReason } = parsed.data;

  // Seuls DELIVERED/FAILED sont des accusés terminaux actionnables.
  if (status !== "DELIVERED" && status !== "FAILED") {
    return c.json(
      buildError("BAD_REQUEST", `Statut d'accusé non actionnable : ${status}.`),
      400
    );
  }

  // 3. Application au journal par corrélation provider_message_id (garde tenant D5).
  const db = c.get("db");
  const result = await applyDeliveryAck(
    {
      messageId,
      status,
      ...(deliveredAt !== undefined ? { deliveredAt } : {}),
      ...(failureReason !== undefined
        ? { failureReason: normalizeReason(failureReason) }
        : {}),
    },
    queryFnFrom(db)
  );
  if (!result.updated) {
    return c.json(
      buildError(
        "NOTIFICATION_NOT_FOUND",
        `Aucune notification avec l'id '${messageId}' n'a été trouvée.`
      ),
      404
    );
  }
  return c.json({ acknowledged: true }, 200);
}

/** Normalise un failureReason fournisseur (texte libre) vers l'enum, sinon UNKNOWN. */
function normalizeReason(
  raw: string
):
  | "PROVIDER_UNREACHABLE"
  | "INVALID_NUMBER"
  | "OPT_OUT"
  | "TEMPLATE_REJECTED"
  | "QUOTA_EXCEEDED"
  | "UNKNOWN" {
  const known = [
    "PROVIDER_UNREACHABLE",
    "INVALID_NUMBER",
    "OPT_OUT",
    "TEMPLATE_REJECTED",
    "QUOTA_EXCEEDED",
    "UNKNOWN",
  ] as const;
  return (known as readonly string[]).includes(raw)
    ? (raw as (typeof known)[number])
    : "UNKNOWN";
}
