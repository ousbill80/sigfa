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
 * ## Armement RLS (SEC-002-CUTOVER-LOT8)
 * Le webhook est PUBLIC : le tenant n'est JAMAIS porté par une auth. La résolution
 * du `bank_id` se fait par CORRÉLATION `provider_message_id` — étape INTRINSÈQUEMENT
 * PRÉ-TENANT (on ignore encore la banque tant que le log corrélé n'est pas lu), donc
 * hors armement (`resolveDeliveryLog`). UNE FOIS le `bank_id` dérivé, la mutation du
 * journal (`applyDeliveryAckArmed`) est REJOUÉE sous `withArmedTenant`
 * (`app.current_bank_id` posé, connexion `sigfa_app` NOBYPASSRLS, RLS
 * `tenant_isolation` de `notification_log` contraignante) : un accusé corrélé à A ne
 * peut mettre à jour QUE le journal de A. Le filtre `bank_id` applicatif subsiste en
 * défense-en-profondeur ; l'armement le double par la RLS.
 *
 * @module
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { QueryFn } from "@sigfa/database";
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

/** Journal corrélé résolu (PRÉ-TENANT) — porte le `bank_id` à armer en aval. */
export interface ResolvedDeliveryLog {
  /** UUID interne du journal `notification_log`. */
  logId: string;
  /** Tenant propriétaire (source de vérité D5) à armer pour la mutation. */
  bankId: string;
  /** Statut courant du journal (pour la garde de transition). */
  status: string;
}

/**
 * Exécute une mutation sous armement RLS (`app.current_bank_id = bankId`). Le
 * webhook étant public, cette fabrique est fournie par la route (elle referme
 * `withArmedTenant` sur la connexion `sigfa_app`), ce qui sépare la résolution
 * pré-tenant de la mutation tenant-scopée sans coupler ce service à `pg`.
 */
export type ArmedRunner = <T>(
  bankId: string,
  fn: (query: QueryFn) => Promise<T>
) => Promise<T>;

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
 * Résout le journal corrélé par `provider_message_id` — étape PRÉ-TENANT.
 *
 * Le webhook est public : tant que le log corrélé n'est pas lu, on ignore la banque
 * à armer. Cette lecture par corrélation SERT justement à dériver le `bank_id`
 * (source de vérité D5) — elle précède donc légitimement l'armement RLS. Renvoie
 * `null` si aucun journal ne correspond (le caller émet alors 404 NOTIFICATION_NOT_FOUND).
 *
 * @param messageId - Id fournisseur corrélé (`provider_message_id`)
 * @param queryFn   - Requête SQL applicative (résolution pré-tenant)
 * @returns Journal résolu (logId + bankId + statut), ou `null`
 */
export async function resolveDeliveryLog(
  messageId: string,
  queryFn: QueryFn
): Promise<ResolvedDeliveryLog | null> {
  const found = await queryFn(
    `SELECT id, bank_id, status FROM notification_log
      WHERE provider_message_id = '${sqlLit(messageId)}'
      LIMIT 1`
  );
  const row = found.rows[0] as
    | { id: string; bank_id: string; status: string }
    | undefined;
  if (!row) return null;
  return { logId: row.id, bankId: row.bank_id, status: row.status };
}

/**
 * Applique un accusé de livraison au journal par corrélation `provider_message_id`.
 *
 * SEC-002-CUTOVER-LOT8 : résout d'abord le `bank_id` (PRÉ-TENANT, `resolveDeliveryLog`),
 * puis exécute la mutation SOUS ARMEMENT via `armedRun` (fabrique
 * `withArmedTenant(bankId, …)` fournie par la route) : `app.current_bank_id` est posé,
 * la RLS `tenant_isolation` de `notification_log` devient contraignante et le filtre
 * `bank_id` applicatif subsiste en défense-en-profondeur. Un accusé corrélé à A ne
 * peut donc mettre à jour QUE le journal de A.
 *
 * @param ack      - Accusé normalisé
 * @param queryFn  - Requête SQL applicative (résolution pré-tenant)
 * @param armedRun - Exécuteur armé (`withArmedTenant`) fourni par la route
 * @returns `{ updated: true, status }` ou `{ updated: false, reason: 'NOT_FOUND' }`
 */
export async function applyDeliveryAck(
  ack: DeliveryAck,
  queryFn: QueryFn,
  armedRun: ArmedRunner
): Promise<ApplyDeliveryResult> {
  const resolved = await resolveDeliveryLog(ack.messageId, queryFn);
  if (!resolved) {
    return { updated: false, reason: "NOT_FOUND" };
  }
  const { bankId, logId } = resolved;

  return armedRun(bankId, async (query) => {
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
