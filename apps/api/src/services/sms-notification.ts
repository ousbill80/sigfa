/**
 * sms-notification — logique métier SMS derrière interface (NOTIF-002).
 *
 * Consomme la file `notifications:sms` (NOTIF-001) et applique LA LOI SMS :
 *  - **Opt-in STRICT revérifié AU TRAITEMENT** (pas seulement à l'enfilement) :
 *    consentement absent ⇒ `CONSENT_MISSING` ; révoqué après enfilement ⇒
 *    `CONSENT_REVOKED`. Dans les deux cas : non-envoi tracé, ZÉRO appel adaptateur.
 *  - **Un seul envoi par `(ticket, type)` à vie** : un log déjà `SENT`/`DELIVERED`
 *    pour ce couple ⇒ pas de renvoi (D3), même sur re-franchissement de seuil.
 *  - **PII** : le numéro n'est déchiffré qu'en mémoire, juste avant l'appel
 *    adaptateur ; JAMAIS journalisé (seul le masqué peut sortir).
 *  - **Garde tenant D5** : `withTenant(bank_id)` + filtre `bank_id` EXPLICITE.
 *  - **Résolution du statut de livraison** : webhook `DELIVERED` ; `SENT` sans
 *    accusé ⇒ `DELIVERY_UNKNOWN` à TTL 24 h (horloge injectée).
 *
 * Le mapping vers l'enum DB `notification_failure_reason` (6 valeurs) : les raisons
 * fines SMS (`CONSENT_MISSING`/`CONSENT_REVOKED`/`TEMPLATE_RENDER_ERROR`) sont
 * persistées comme `OPT_OUT`/`OPT_OUT`/`TEMPLATE_REJECTED` (valeurs légales de LA LOI)
 * et RETOURNÉES en clair pour l'observabilité/tests (jamais perdues).
 *
 * @module
 */

import { withTenant, type QueryFn } from "@sigfa/database";
import { maskPhone } from "src/lib/phone-mask.js";
import {
  renderSmsTemplate,
  TemplateRenderError,
  type RenderContext,
  type SmsLang,
  type TemplateSource,
} from "src/services/sms-templates-render.js";
import type { SmsAdapter } from "src/services/sms-adapter.js";
import {
  NotificationSendError,
  type NotificationFailureReason,
} from "src/services/notification-jobs.js";

// ─────────────────────────────────────────────────────────────────────────────
// Raisons de non-envoi SMS (surface fine, mappée vers l'enum DB)
// ─────────────────────────────────────────────────────────────────────────────

/** Raison fine de non-envoi SMS (LA LOI NOTIF-002, plus large que l'enum DB). */
export type SmsSkipReason =
  | "CONSENT_MISSING"
  | "CONSENT_REVOKED"
  | "TEMPLATE_RENDER_ERROR";

/**
 * Mappe une raison fine SMS vers l'enum DB `notification_failure_reason` (LA LOI, 6
 * valeurs). CONSENT_* ⇒ `OPT_OUT` (sémantiquement : pas de consentement valide) ;
 * TEMPLATE_RENDER_ERROR ⇒ `TEMPLATE_REJECTED`. La raison fine reste RETOURNÉE en clair.
 *
 * @param reason - Raison fine SMS
 * @returns Valeur légale de l'enum DB
 */
export function toDbFailureReason(
  reason: SmsSkipReason
): NotificationFailureReason {
  switch (reason) {
    case "CONSENT_MISSING":
    case "CONSENT_REVOKED":
      return "OPT_OUT";
    /* v8 ignore next 2 — mappage exhaustif, unique branche restante. */
    case "TEMPLATE_RENDER_ERROR":
      return "TEMPLATE_REJECTED";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Opt-in STRICT (revérifié au traitement)
// ─────────────────────────────────────────────────────────────────────────────

/** État de consentement chargé pour `(bank, phone_hash, SMS)`. */
export interface ConsentRow {
  /** `true` = opt-in actif. */
  optedIn: boolean;
  /** Horodatage de révocation (non null ⇒ opt-out). */
  revokedAt: string | null;
}

/**
 * Décide si un envoi SMS est autorisé selon l'opt-in STRICT (UEMOA).
 * Consentement ABSENT ⇒ `CONSENT_MISSING`. Présent mais `opted_in=false` ou
 * `revoked_at` posé ⇒ `CONSENT_REVOKED`. Sinon ⇒ autorisé.
 *
 * @param consent - Ligne de consentement (ou `null` si absente)
 * @returns `{ allowed: true }` ou `{ allowed: false, reason }`
 */
export function evaluateConsent(
  consent: ConsentRow | null
):
  | { allowed: true }
  | { allowed: false; reason: "CONSENT_MISSING" | "CONSENT_REVOKED" } {
  if (consent === null) {
    return { allowed: false, reason: "CONSENT_MISSING" };
  }
  if (!consent.optedIn || consent.revokedAt !== null) {
    return { allowed: false, reason: "CONSENT_REVOKED" };
  }
  return { allowed: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Traitement d'un job SMS
// ─────────────────────────────────────────────────────────────────────────────

/** Payload d'un job SMS (étend le payload NOTIF-001 avec le contexte de rendu). */
export interface SmsJobData {
  /** Tenant — LA source de vérité hors RLS (D5). */
  bankId: string;
  /** Clé d'idempotence (= jobId BullMQ). */
  dedupeKey: string;
  /** Ligne `notification_log` (créée en QUEUED par le producteur). */
  logId: string;
  /** Ticket associé (obligatoire pour SMS parcours client). */
  ticketId: string;
  /** Type de notification SMS. */
  type: "TICKET_CONFIRMATION" | "POSITION_NEAR" | "POSITION_NEXT";
  /** Empreinte du téléphone (recherche du consentement, jamais le clair). */
  phoneHash: string;
  /** Langue demandée (FR/EN). */
  lang: SmsLang;
  /** Variables de rendu du template. */
  context: RenderContext;
}

/** Ligne minimale du log chargée sous garde tenant. */
interface SmsLogRow {
  id: string;
  bank_id: string;
  status: string;
}

/** Résultat du traitement d'un job SMS. */
export type SmsProcessResult =
  | { status: "SENT"; providerMessageId: string }
  | { status: "ALREADY_SENT" }
  | { status: "SKIPPED"; reason: SmsSkipReason };

/** Dépendances du traitement d'un job SMS. */
export interface SmsProcessDeps {
  /** Requête SQL applicative (hors RLS de session). */
  queryFn: QueryFn;
  /** Adaptateur SMS (MOCK en NOTIF-002). */
  adapter: SmsAdapter;
  /** Source des templates (banque + FR global). */
  templates: TemplateSource;
  /** Déchiffre le `phone_encrypted` du consentement (DB-008). */
  decryptPhone: (phoneEncrypted: string) => string;
}

/** Escape minimal d'une valeur SQL littérale (apostrophes doublées). */
function sqlLit(value: string): string {
  return value.replace(/'/g, "''");
}

/** Erreur de garde tenant SMS (job ≠ log). */
export class SmsTenantMismatchError extends Error {
  constructor(bankId: string) {
    super(`Garde tenant (D5) : log invisible/hors tenant pour bank_id=${bankId}.`);
    this.name = "TenantMismatchError"; // aligné isNonRetryable() NOTIF-001
  }
}

/**
 * Traite un job SMS : garde tenant D5 → opt-in STRICT revérifié → un-seul-envoi →
 * rendu template → appel adaptateur → SENT. Aucun numéro en clair n'est journalisé.
 *
 * @param job  - Données du job SMS (bankId = source de vérité)
 * @param deps - queryFn, adaptateur, templates, déchiffrement
 * @returns SENT / ALREADY_SENT / SKIPPED (avec raison fine)
 * @throws {SmsTenantMismatchError} Log hors tenant (D5)
 * @throws {NotificationSendError} Échec transitoire adaptateur (retry BullMQ)
 * @throws {TemplateRenderError} Variable manquante / template absent (→ DLQ)
 */
export async function processSmsJob(
  job: SmsJobData,
  deps: SmsProcessDeps
): Promise<SmsProcessResult> {
  try {
    return await withTenant(deps.queryFn, job.bankId, async (query) => {
    // 1. Chargement du log sous garde tenant D5 (RLS + bank_id EXPLICITE).
    const logRes = await query(
      `SELECT id, bank_id, status FROM notification_log
        WHERE id = '${sqlLit(job.logId)}' AND bank_id = '${sqlLit(job.bankId)}'`
    );
    const log = logRes.rows[0] as SmsLogRow | undefined;
    if (!log) {
      throw new SmsTenantMismatchError(job.bankId);
    }

    // 2. Un seul envoi par (ticket, type) À VIE : ce log déjà envoyé ⇒ stop (idempotence).
    if (log.status === "SENT" || log.status === "DELIVERED") {
      return { status: "ALREADY_SENT" };
    }
    // Défense supplémentaire : un AUTRE log SENT/DELIVERED pour le même (ticket,type)
    // (re-franchissement de seuil ⇒ nouveau log) ⇒ ne pas renvoyer (D3).
    const priorRes = await query(
      `SELECT 1 FROM notification_log
        WHERE bank_id = '${sqlLit(job.bankId)}'
          AND ticket_id = '${sqlLit(job.ticketId)}'
          AND type = '${sqlLit(job.type)}'::notification_type
          AND status IN ('SENT','DELIVERED')
        LIMIT 1`
    );
    if (priorRes.rows.length > 0) {
      return { status: "ALREADY_SENT" };
    }

    // 3. Opt-in STRICT REVÉRIFIÉ AU TRAITEMENT (pas seulement à l'enfilement).
    const consentRes = await query(
      `SELECT opted_in, revoked_at, phone_encrypted FROM notification_consents
        WHERE bank_id = '${sqlLit(job.bankId)}'
          AND phone_hash = '${sqlLit(job.phoneHash)}'
          AND channel = 'SMS'::notification_channel`
    );
    const consentRaw = consentRes.rows[0] as
      | { opted_in: boolean; revoked_at: string | null; phone_encrypted: string }
      | undefined;
    const consent: ConsentRow | null = consentRaw
      ? { optedIn: consentRaw.opted_in, revokedAt: consentRaw.revoked_at }
      : null;
    const decision = evaluateConsent(consent);
    if (!decision.allowed) {
      // Non-envoi tracé DANS la transaction courante (committée par le return).
      await query(
        `UPDATE notification_log
            SET status = 'FAILED',
                failure_reason = '${toDbFailureReason(decision.reason)}'::notification_failure_reason
          WHERE id = '${sqlLit(job.logId)}'
            AND bank_id = '${sqlLit(job.bankId)}'
            AND status NOT IN ('SENT','DELIVERED')`
      );
      return { status: "SKIPPED", reason: decision.reason };
    }

    // 4. Rendu du template (fallback + variables strictes). Un échec de rendu est
    // propagé (→ DLQ) ; le marquage FAILED se fait hors transaction (voir catch),
    // pour ne pas être annulé par le ROLLBACK de garde tenant.
    const rendered = await renderSmsTemplate(
      deps.templates,
      { bankId: job.bankId, type: job.type, lang: job.lang },
      job.context
    );
    const body = rendered.body;

    // 5. Déchiffrement du clair EN MÉMOIRE, appel adaptateur, PII masquée en trace.
    // `consentRaw` est garanti non-null ici (decision.allowed ⇒ consent présent).
    const clearPhone = deps.decryptPhone(consentRaw!.phone_encrypted);
    const result = await deps.adapter.send({ to: clearPhone, body });
    // Le clair sort de portée ; seul le masqué peut être journalisé par l'appelant.
    void maskPhone; // masquage disponible pour l'observabilité de l'appelant.

    // 6. Transition QUEUED → SENT (idempotente + garde tenant explicite).
    await query(
      `UPDATE notification_log
          SET status = 'SENT', sent_at = NOW(),
              provider_message_id = '${sqlLit(result.providerMessageId)}'
        WHERE id = '${sqlLit(job.logId)}'
          AND bank_id = '${sqlLit(job.bankId)}'
          AND status = 'QUEUED'`
    );
      return { status: "SENT", providerMessageId: result.providerMessageId };
    });
  } catch (err) {
    // Rendu cassé : la transaction principale a fait ROLLBACK ; on marque FAILED
    // dans une transaction PROPRE (committée) puis on propage vers la DLQ.
    if (err instanceof TemplateRenderError) {
      await markSmsFailed(deps.queryFn, job, "TEMPLATE_RENDER_ERROR");
    }
    throw err;
  }
}

/** Marque un log SMS en FAILED (transaction propre, garde tenant D5 + bank_id explicite). */
async function markSmsFailed(
  queryFn: QueryFn,
  job: SmsJobData,
  reason: SmsSkipReason
): Promise<void> {
  await withTenant(queryFn, job.bankId, async (query) => {
    await query(
      `UPDATE notification_log
          SET status = 'FAILED',
              failure_reason = '${toDbFailureReason(reason)}'::notification_failure_reason
        WHERE id = '${sqlLit(job.logId)}'
          AND bank_id = '${sqlLit(job.bankId)}'
          AND status NOT IN ('SENT','DELIVERED')`
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Résolution du statut de livraison (webhook + DELIVERY_UNKNOWN TTL 24 h)
// ─────────────────────────────────────────────────────────────────────────────

/** TTL par défaut au-delà duquel `SENT` sans accusé devient `DELIVERY_UNKNOWN` (D3). */
export const DELIVERY_UNKNOWN_TTL_MS = 24 * 60 * 60 * 1000;

/** Statut dérivé d'un log `SENT` en attente d'accusé. */
export type DerivedDeliveryStatus = "SENT" | "DELIVERY_UNKNOWN";

/**
 * Dérive le statut d'un log `SENT` sans accusé de livraison : reste `SENT` tant que
 * le TTL (défaut 24 h, D3) n'est pas dépassé depuis `sent_at`, puis bascule
 * `DELIVERY_UNKNOWN`. Horloge injectée pour le déterminisme (fake-timers, zéro sleep).
 *
 * @param sentAtMs - Instant d'envoi (ms epoch)
 * @param nowMs    - Instant courant injecté (ms epoch)
 * @param ttlMs    - TTL (défaut 24 h)
 * @returns `SENT` ou `DELIVERY_UNKNOWN`
 */
export function deriveDeliveryStatus(
  sentAtMs: number,
  nowMs: number,
  ttlMs: number = DELIVERY_UNKNOWN_TTL_MS
): DerivedDeliveryStatus {
  return nowMs - sentAtMs >= ttlMs ? "DELIVERY_UNKNOWN" : "SENT";
}

export { NotificationSendError };
