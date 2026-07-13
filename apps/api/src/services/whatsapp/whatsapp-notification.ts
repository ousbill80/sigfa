/**
 * whatsapp-notification — logique métier WhatsApp SORTANT derrière interface (NOTIF-003).
 *
 * Consomme la file `notifications:whatsapp` (NOTIF-001) et applique LA LOI, MÊMES
 * garanties que NOTIF-002 (SMS) mais sur le canal `WHATSAPP` :
 *  - **Opt-in STRICT PAR CANAL revérifié AU TRAITEMENT** : le consentement est lu
 *    pour `(bank_id, phone_hash, WHATSAPP)` — un opt-in SMS ne vaut PAS opt-in
 *    WhatsApp (double consentement possible). Absent ⇒ `CONSENT_MISSING` ; révoqué
 *    ⇒ `CONSENT_REVOKED`. Dans les deux cas : non-envoi tracé, ZÉRO appel adaptateur.
 *  - **Un seul envoi par `(ticket, type)` à vie** (D3) : un log déjà `SENT`/`DELIVERED`
 *    pour ce couple ⇒ pas de renvoi, même sur re-franchissement de seuil.
 *  - **PII** : le numéro n'est déchiffré qu'en mémoire, juste avant l'appel
 *    adaptateur ; JAMAIS journalisé (seul le masqué peut sortir).
 *  - **Garde tenant D5** : `withTenant(bank_id)` + filtre `bank_id` EXPLICITE.
 *
 * ── LIMITE MOCK ⇄ RÉEL (rappel, voir whatsapp-adapter.ts) ────────────────────
 *  Le fallback de rendu banque→FR global peut, HORS fenêtre 24 h Meta, correspondre
 *  à un template HSM non approuvé et être REFUSÉ en réel. Un mock vert ne le prouve
 *  pas. La branche d'échec est couverte via l'adaptateur (`TEMPLATE_REJECTED`).
 *
 * @module
 */

import { withTenant, type QueryFn } from "@sigfa/database";
import {
  renderSmsTemplate,
  TemplateRenderError,
  type RenderContext,
  type SmsLang,
  type TemplateSource,
} from "src/services/sms-templates-render.js";
import type { WhatsAppAdapter } from "src/services/whatsapp/whatsapp-adapter.js";
import {
  NotificationSendError,
  type NotificationFailureReason,
} from "src/services/notification-jobs.js";

// ─────────────────────────────────────────────────────────────────────────────
// Raisons de non-envoi WhatsApp (surface fine, mappée vers l'enum DB)
// ─────────────────────────────────────────────────────────────────────────────

/** Raison fine de non-envoi WhatsApp (LA LOI NOTIF-003, plus large que l'enum DB). */
export type WhatsAppSkipReason =
  | "CONSENT_MISSING"
  | "CONSENT_REVOKED"
  | "TEMPLATE_RENDER_ERROR";

/**
 * Mappe une raison fine WhatsApp vers l'enum DB `notification_failure_reason` (LA LOI,
 * 6 valeurs). CONSENT_* ⇒ `OPT_OUT` ; TEMPLATE_RENDER_ERROR ⇒ `TEMPLATE_REJECTED`.
 * La raison fine reste RETOURNÉE en clair pour l'observabilité/tests.
 *
 * @param reason - Raison fine WhatsApp
 * @returns Valeur légale de l'enum DB
 */
export function toDbFailureReason(
  reason: WhatsAppSkipReason
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
// Opt-in STRICT PAR CANAL (revérifié au traitement)
// ─────────────────────────────────────────────────────────────────────────────

/** État de consentement chargé pour `(bank, phone_hash, WHATSAPP)`. */
export interface ConsentRow {
  /** `true` = opt-in actif. */
  optedIn: boolean;
  /** Horodatage de révocation (non null ⇒ opt-out). */
  revokedAt: string | null;
}

/**
 * Décide si un envoi WhatsApp est autorisé selon l'opt-in STRICT PAR CANAL (UEMOA).
 * Consentement ABSENT ⇒ `CONSENT_MISSING`. Présent mais `opted_in=false` ou
 * `revoked_at` posé ⇒ `CONSENT_REVOKED`. Sinon ⇒ autorisé. Le consentement est lu
 * pour le canal WHATSAPP : un opt-in SMS n'y donne PAS accès (par canal).
 *
 * @param consent - Ligne de consentement WHATSAPP (ou `null` si absente)
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
// Traitement d'un job WhatsApp sortant
// ─────────────────────────────────────────────────────────────────────────────

/** Payload d'un job WhatsApp (étend le payload NOTIF-001 avec le contexte de rendu). */
export interface WhatsAppJobData {
  /** Tenant — LA source de vérité hors RLS (D5). */
  bankId: string;
  /** Clé d'idempotence (= jobId BullMQ). */
  dedupeKey: string;
  /** Ligne `notification_log` (créée en QUEUED par le producteur). */
  logId: string;
  /** Ticket associé (obligatoire pour le parcours client). */
  ticketId: string;
  /** Type de notification (avancement). */
  type: "TICKET_CONFIRMATION" | "POSITION_NEAR" | "POSITION_NEXT";
  /** Empreinte du téléphone (recherche du consentement, jamais le clair). */
  phoneHash: string;
  /** Langue demandée (FR/EN). */
  lang: SmsLang;
  /** Variables de rendu du template. */
  context: RenderContext;
}

/** Ligne minimale du log chargée sous garde tenant. */
interface WhatsAppLogRow {
  id: string;
  bank_id: string;
  status: string;
}

/** Résultat du traitement d'un job WhatsApp. */
export type WhatsAppProcessResult =
  | { status: "SENT"; providerMessageId: string }
  | { status: "ALREADY_SENT" }
  | { status: "SKIPPED"; reason: WhatsAppSkipReason };

/** Dépendances du traitement d'un job WhatsApp. */
export interface WhatsAppProcessDeps {
  /** Requête SQL applicative (hors RLS de session). */
  queryFn: QueryFn;
  /** Adaptateur WhatsApp (MOCK en NOTIF-003). */
  adapter: WhatsAppAdapter;
  /** Source des templates (banque + FR global). */
  templates: TemplateSource;
  /** Déchiffre le `phone_encrypted` du consentement (DB-008). */
  decryptPhone: (phoneEncrypted: string) => string;
}

/** Escape minimal d'une valeur SQL littérale (apostrophes doublées). */
function sqlLit(value: string): string {
  return value.replace(/'/g, "''");
}

/** Erreur de garde tenant WhatsApp (job ≠ log). */
export class WhatsAppTenantMismatchError extends Error {
  constructor(bankId: string) {
    super(`Garde tenant (D5) : log invisible/hors tenant pour bank_id=${bankId}.`);
    this.name = "TenantMismatchError"; // aligné isNonRetryable() NOTIF-001
  }
}

/**
 * Traite un job WhatsApp SORTANT : garde tenant D5 → opt-in STRICT PAR CANAL
 * revérifié → un-seul-envoi → rendu template → appel adaptateur → SENT. Aucun
 * numéro en clair n'est journalisé.
 *
 * @param job  - Données du job WhatsApp (bankId = source de vérité)
 * @param deps - queryFn, adaptateur, templates, déchiffrement
 * @returns SENT / ALREADY_SENT / SKIPPED (avec raison fine)
 * @throws {WhatsAppTenantMismatchError} Log hors tenant (D5)
 * @throws {NotificationSendError} Échec transitoire/définitif adaptateur (retry/DLQ)
 * @throws {TemplateRenderError} Variable manquante / template absent (→ DLQ)
 */
export async function processWhatsAppJob(
  job: WhatsAppJobData,
  deps: WhatsAppProcessDeps
): Promise<WhatsAppProcessResult> {
  try {
    return await withTenant(deps.queryFn, job.bankId, async (query) => {
      // 1. Chargement du log sous garde tenant D5 (RLS + bank_id EXPLICITE).
      const logRes = await query(
        `SELECT id, bank_id, status FROM notification_log
          WHERE id = '${sqlLit(job.logId)}' AND bank_id = '${sqlLit(job.bankId)}'`
      );
      const log = logRes.rows[0] as WhatsAppLogRow | undefined;
      if (!log) {
        throw new WhatsAppTenantMismatchError(job.bankId);
      }

      // 2. Un seul envoi par (ticket, type) À VIE : ce log déjà envoyé ⇒ stop.
      if (log.status === "SENT" || log.status === "DELIVERED") {
        return { status: "ALREADY_SENT" };
      }
      // Défense : un AUTRE log SENT/DELIVERED pour le même (ticket,type,WHATSAPP) ⇒
      // ne pas renvoyer (D3). Le canal WHATSAPP est explicite (distinct du SMS).
      const priorRes = await query(
        `SELECT 1 FROM notification_log
          WHERE bank_id = '${sqlLit(job.bankId)}'
            AND ticket_id = '${sqlLit(job.ticketId)}'
            AND type = '${sqlLit(job.type)}'::notification_type
            AND channel = 'WHATSAPP'::notification_channel
            AND status IN ('SENT','DELIVERED')
          LIMIT 1`
      );
      if (priorRes.rows.length > 0) {
        return { status: "ALREADY_SENT" };
      }

      // 3. Opt-in STRICT PAR CANAL REVÉRIFIÉ AU TRAITEMENT (canal WHATSAPP).
      const consentRes = await query(
        `SELECT opted_in, revoked_at, phone_encrypted FROM notification_consents
          WHERE bank_id = '${sqlLit(job.bankId)}'
            AND phone_hash = '${sqlLit(job.phoneHash)}'
            AND channel = 'WHATSAPP'::notification_channel`
      );
      const consentRaw = consentRes.rows[0] as
        | { opted_in: boolean; revoked_at: string | null; phone_encrypted: string }
        | undefined;
      const consent: ConsentRow | null = consentRaw
        ? { optedIn: consentRaw.opted_in, revokedAt: consentRaw.revoked_at }
        : null;
      const decision = evaluateConsent(consent);
      if (!decision.allowed) {
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

      // 4. Rendu du template (fallback + variables strictes). Échec propagé (→ DLQ) ;
      // le marquage FAILED se fait hors transaction (voir catch).
      const rendered = await renderSmsTemplate(
        deps.templates,
        { bankId: job.bankId, type: job.type, lang: job.lang },
        job.context
      );
      const body = rendered.body;

      // 5. Déchiffrement du clair EN MÉMOIRE, appel adaptateur. PII jamais journalisée.
      const clearPhone = deps.decryptPhone(consentRaw!.phone_encrypted);
      const result = await deps.adapter.send({ to: clearPhone, body });

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
      await markWhatsAppFailed(deps.queryFn, job, "TEMPLATE_RENDER_ERROR");
    }
    throw err;
  }
}

/** Marque un log WhatsApp en FAILED (transaction propre, garde tenant D5 + bank_id explicite). */
async function markWhatsAppFailed(
  queryFn: QueryFn,
  job: WhatsAppJobData,
  reason: WhatsAppSkipReason
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

export { NotificationSendError };
