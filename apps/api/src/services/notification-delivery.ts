/**
 * notification-delivery — traitement des accusés de livraison fournisseur (NOTIF-002).
 *
 * LA LOI (CONTRACT-007) : `POST /webhooks/notifications/{provider}/delivery` reçoit
 * un accusé, vérifie la SIGNATURE fournisseur (HMAC-SHA256), puis met à jour le
 * journal PAR CORRÉLATION `provider_message_id` :
 *  - `DELIVERED` ⇒ `status = DELIVERED`, `delivered_at = accusé`.
 *  - `FAILED` ⇒ `status = FAILED`, `failure_reason` énuméré.
 *
 * La mise à jour est faite sous garde tenant D5 : le `bank_id` du log corrélé est
 * la source de vérité (le webhook est public, sans JWT ⇒ pas de tenant de session).
 *
 * @module
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { withTenant, type QueryFn } from "@sigfa/database";
import type { NotificationFailureReason } from "src/services/notification-jobs.js";

/** Fournisseurs de webhook de livraison (LA LOI). */
export type DeliveryProvider = "africastalking" | "whatsapp" | "resend";

/** En-tête de signature attendu par fournisseur. */
export const PROVIDER_SIGNATURE_HEADER: Record<DeliveryProvider, string> = {
  africastalking: "x-at-signature",
  whatsapp: "x-hub-signature-256",
  resend: "x-resend-signature",
};

/**
 * Vérifie une signature HMAC-SHA256 en temps constant.
 *
 * @param rawBody   - Corps brut (bytes exacts reçus, avant parse JSON)
 * @param signature - Signature hex fournie dans l'en-tête (peut être `undefined`)
 * @param secret    - Secret partagé fournisseur
 * @returns `true` si la signature correspond, `false` sinon (absente/incorrecte)
 */
export function verifyDeliverySignature(
  rawBody: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature || signature.trim() === "") return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = signature.trim().toLowerCase();
  const expectedBuf = Buffer.from(expected, "utf8");
  const givenBuf = Buffer.from(given, "utf8");
  // Longueurs différentes ⇒ jamais égal (timingSafeEqual exige l'égalité de taille).
  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}

/** Accusé de livraison normalisé (extrait du payload fournisseur). */
export interface DeliveryAck {
  /** Id fournisseur (corrélation `provider_message_id`). */
  messageId: string;
  /**
   * Statut terminal rapporté (sous-ensemble de LA LOI `NotificationStatus`).
   * Seuls `DELIVERED`/`FAILED` sont des accusés actionnables ; `QUEUED`/`SENT`
   * sont rejetés en amont (400) par le webhook.
   */
  status: "DELIVERED" | "FAILED";
  /** Horodatage de livraison (si DELIVERED). */
  deliveredAt?: string;
  /** Raison d'échec fournisseur (mappée vers l'enum si FAILED). */
  failureReason?: NotificationFailureReason;
}

/** Résultat de l'application d'un accusé. */
export type ApplyDeliveryResult =
  | { updated: true; status: "DELIVERED" | "FAILED" }
  | { updated: false; reason: "NOT_FOUND" };

/** Escape minimal d'une valeur SQL littérale. */
function sqlLit(value: string): string {
  return value.replace(/'/g, "''");
}

/** Mappe une raison fournisseur (texte libre) vers l'enum DB (défaut UNKNOWN). */
export function normalizeFailureReason(
  raw: string | undefined
): NotificationFailureReason {
  const known: NotificationFailureReason[] = [
    "PROVIDER_UNREACHABLE",
    "INVALID_NUMBER",
    "OPT_OUT",
    "TEMPLATE_REJECTED",
    "QUOTA_EXCEEDED",
    "UNKNOWN",
  ];
  if (raw && (known as string[]).includes(raw)) {
    return raw as NotificationFailureReason;
  }
  return "UNKNOWN";
}

/**
 * Applique un accusé de livraison au journal par corrélation `provider_message_id`,
 * sous garde tenant D5 (le `bank_id` du log corrélé est la source de vérité).
 *
 * @param ack     - Accusé normalisé
 * @param queryFn - Requête SQL applicative
 * @returns `{ updated: true, status }` ou `{ updated: false, reason: 'NOT_FOUND' }`
 */
export async function applyDeliveryAck(
  ack: DeliveryAck,
  queryFn: QueryFn
): Promise<ApplyDeliveryResult> {
  // Corrélation par provider_message_id. La lecture hors tenant sert UNIQUEMENT à
  // résoudre le bank_id du log (le webhook est public) ; la mutation est ensuite
  // faite SOUS withTenant(bank_id) + filtre bank_id explicite (D5).
  const found = await queryFn(
    `SELECT id, bank_id, status FROM notification_log
      WHERE provider_message_id = '${sqlLit(ack.messageId)}'
      LIMIT 1`
  );
  const row = found.rows[0] as
    | { id: string; bank_id: string; status: string }
    | undefined;
  if (!row) {
    return { updated: false, reason: "NOT_FOUND" };
  }

  const bankId = row.bank_id;
  const logId = row.id;

  return withTenant(queryFn, bankId, async (query) => {
    if (ack.status === "DELIVERED") {
      const when = ack.deliveredAt ?? new Date().toISOString();
      await query(
        `UPDATE notification_log
            SET status = 'DELIVERED', delivered_at = '${sqlLit(when)}'
          WHERE id = '${sqlLit(logId)}' AND bank_id = '${sqlLit(bankId)}'
            AND status NOT IN ('FAILED')`
      );
      return { updated: true, status: "DELIVERED" };
    }
    // ack.status === "FAILED" (seul autre cas actionnable).
    const reason = normalizeFailureReason(ack.failureReason);
    await query(
      `UPDATE notification_log
          SET status = 'FAILED', failure_reason = '${reason}'::notification_failure_reason
        WHERE id = '${sqlLit(logId)}' AND bank_id = '${sqlLit(bankId)}'
          AND status NOT IN ('DELIVERED')`
    );
    return { updated: true, status: "FAILED" };
  });
}
