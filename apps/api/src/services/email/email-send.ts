/**
 * email-send — orchestration transport email NOTIF-004 (producteur + SendFn worker).
 *
 * LA LOI (NOTIF-004) :
 *  - PRODUCTEUR (`prepareEmailJob`) : résout les destinataires INTERNES par
 *    rôle/agence (D5 `withTenant`), valide+rend le gabarit React Email (FR/EN),
 *    externalise les pièces hors limite en lien signé TTL 24 h (`attachmentSignedUrl`),
 *    et prépare le job pour la queue `notifications:email` (NOTIF-001).
 *  - GARDE « internes uniquement » : toute adresse hors du domaine interne autorisé
 *    est REFUSÉE (`ClientEmailRefusedError`) — un email client ne part jamais.
 *  - WORKER (`makeEmailSendFn`) : adapte `EmailAdapter` en `SendFn` NOTIF-001. Les
 *    erreurs transitoires (429/5xx) propagent → retry/backoff. Le bounce dur est
 *    `UnrecoverableError` → DLQ + log FAILED (INVALID_NUMBER), pas de retry infini.
 *  - Transport pur : aucun calcul de KPI (contenu = F7/REP-002).
 *
 * @module
 */

import { UnrecoverableError } from "bullmq";
import type { QueryFn } from "@sigfa/database";
import type {
  EmailNotificationType,
  EmailLang,
} from "src/services/email/email-types.js";
import { renderEmail } from "src/services/email/render.js";
import {
  requireInternalRecipients,
  MANAGER_ALERT_ROLES,
  REPORT_ROLES,
} from "src/services/email/recipients.js";
import {
  storeAndSign,
  exceedsAttachmentLimit,
  DEFAULT_ATTACHMENT_LIMIT_BYTES,
  type ObjectStore,
  type SignedLinkDeps,
  type CandidateAttachment,
  type ObjectKeyFn,
} from "src/services/email/attachment-storage.js";
import type {
  EmailAdapter,
  EmailMessage,
  EmailAttachment,
} from "src/services/email/email-adapter.js";
import type {
  NotificationJobData,
  SendFn,
  SendOutcome,
} from "src/services/notification-jobs.js";

/** Erreur : une adresse destinataire n'appartient pas au périmètre interne. */
export class ClientEmailRefusedError extends Error {
  /** Adresse refusée (jamais un client final ne doit recevoir d'email). */
  readonly address: string;
  constructor(address: string) {
    super(`Email refusé : ${address} n'est pas une adresse interne autorisée.`);
    this.name = "ClientEmailRefusedError";
    this.address = address;
  }
}

/**
 * Vérifie que toutes les adresses appartiennent aux domaines internes autorisés.
 * Un domaine interne = domaine email du staff de la banque (allow-list). Toute
 * autre adresse (client final) est REFUSÉE.
 *
 * @param addresses      - Adresses à contrôler
 * @param internalDomains- Domaines internes autorisés (ex. `["banque.example"]`)
 * @throws {ClientEmailRefusedError} Dès qu'une adresse est hors périmètre interne
 */
export function assertInternalOnly(
  addresses: readonly string[],
  internalDomains: readonly string[]
): void {
  const allowed = new Set(internalDomains.map((d) => d.toLowerCase()));
  for (const addr of addresses) {
    const at = addr.lastIndexOf("@");
    const domain = at >= 0 ? addr.slice(at + 1).toLowerCase() : "";
    if (!allowed.has(domain)) {
      throw new ClientEmailRefusedError(addr);
    }
  }
}

/** Requête de préparation d'un email interne (producteur). */
export interface PrepareEmailInput {
  /** Tenant — banque (source de vérité D5). */
  bankId: string;
  /** Type d'email interne. */
  type: EmailNotificationType;
  /** Langue de rendu (FR/EN). */
  lang: EmailLang;
  /** Props du gabarit (validées par Zod au rendu) — transport pur (F7 calcule). */
  props: unknown;
  /** Agence de contexte (MANAGER_ALERT) — null pour un rapport au niveau banque. */
  agencyId?: string | null;
  /** Adresse d'expédition (domaine banque configuré SPF/DKIM en prod). */
  from: string;
  /**
   * Pièces jointes candidates (rapports F7). Chaque pièce hors limite bascule en
   * lien signé TTL 24 h ; les autres restent jointes en ligne.
   */
  attachments?: readonly CandidateAttachment[];
}

/** Dépendances du producteur d'email. */
export interface PrepareEmailDeps {
  /** Requête SQL applicative (résolution des destinataires, D5). */
  queryFn: QueryFn;
  /** Domaines internes autorisés (allow-list « internes uniquement »). */
  internalDomains: readonly string[];
  /** Stockage objet (mock) pour les pièces jointes externalisées. */
  objectStore: ObjectStore;
  /** Config du lien signé (secret, base d'URL, horloge, TTL 24 h). */
  signedLink: SignedLinkDeps;
  /** Plafond de pièce jointe (octets) — défaut Resend documenté. */
  attachmentLimitBytes?: number;
  /** Génère la clé d'objet d'une pièce jointe (déterminisme). */
  objectKeyFn: ObjectKeyFn;
}

/** Job email prêt à enfiler + le message rendu (pour le worker/tests). */
export interface PreparedEmail {
  /** Destinataires internes résolus (jamais un client). */
  recipients: string[];
  /** Message email rendu (HTML + sujet + pièces en ligne restantes). */
  message: EmailMessage;
  /**
   * Lien signé de la pièce jointe externalisée (repli hors limite). `null` si
   * aucune pièce n'a dû être externalisée (à journaliser dans `attachmentSignedUrl`).
   */
  attachmentSignedUrl: string | null;
}

/** Résout les rôles destinataires par défaut selon le type d'email. */
export function defaultRolesFor(type: EmailNotificationType): readonly string[] {
  return type === "MANAGER_ALERT" ? MANAGER_ALERT_ROLES : REPORT_ROLES;
}

/**
 * Prépare un email interne : destinataires (D5) + rendu React Email + repli pièce
 * jointe (lien signé 24 h). Le rendu se fait avec le lien signé injecté dans les
 * props (`attachmentSignedUrl`) pour afficher le bouton de téléchargement.
 *
 * @param input - Description de l'email à préparer
 * @param deps  - queryFn, allow-list interne, stockage, config lien signé
 * @returns Email préparé (destinataires + message rendu + lien signé éventuel)
 * @throws {NoRecipientError} Si aucun destinataire interne (aucun envoi)
 * @throws {ClientEmailRefusedError} Si une adresse résolue est hors périmètre interne
 * @throws {EmailPropsInvalidError} Si les props ne valident pas (aucun HTML cassé)
 */
export async function prepareEmailJob(
  input: PrepareEmailInput,
  deps: PrepareEmailDeps
): Promise<PreparedEmail> {
  // 1. Destinataires internes par rôle/agence, SOUS garde tenant D5.
  const recipients = await requireInternalRecipients(deps.queryFn, {
    bankId: input.bankId,
    roles: defaultRolesFor(input.type),
    agencyId: input.agencyId ?? null,
  });

  // 2. Garde « internes uniquement » : jamais un client final.
  assertInternalOnly(recipients, deps.internalDomains);
  assertInternalOnly([input.from], deps.internalDomains);

  // 3. Repli pièce jointe hors limite → lien signé TTL 24 h. Les pièces sous le
  //    plafond restent jointes en ligne.
  const limit = deps.attachmentLimitBytes ?? DEFAULT_ATTACHMENT_LIMIT_BYTES;
  const inlineAttachments: EmailAttachment[] = [];
  let attachmentSignedUrl: string | null = null;
  for (const att of input.attachments ?? []) {
    if (exceedsAttachmentLimit(att, limit)) {
      const link = await storeAndSign(
        deps.objectStore,
        deps.signedLink,
        att,
        deps.objectKeyFn
      );
      // Un seul lien signé porté au log (première pièce externalisée).
      attachmentSignedUrl ??= link.url;
    } else {
      inlineAttachments.push({
        filename: att.filename,
        contentBase64: att.contentBase64,
        contentType: att.contentType,
      });
    }
  }

  // 4. Rendu React Email (Zod valide les props AVANT rendu). Le lien signé est
  //    injecté dans les props pour afficher le bouton (rapports uniquement).
  const propsForRender = injectSignedUrl(input.type, input.props, attachmentSignedUrl);
  const rendered = await renderEmail(input.type, input.lang, propsForRender);

  const message: EmailMessage = {
    to: recipients,
    from: input.from,
    subject: rendered.subject,
    html: rendered.html,
    ...(inlineAttachments.length > 0 ? { attachments: inlineAttachments } : {}),
  };

  return { recipients, message, attachmentSignedUrl };
}

/**
 * Injecte `attachmentSignedUrl` dans les props d'un rapport (les gabarits rapport
 * l'attendent). Pour MANAGER_ALERT (pas de pièce jointe), retourne les props telles
 * quelles. Objet non-objet ⇒ inchangé (la validation Zod tranchera au rendu).
 *
 * @param type    - Type d'email
 * @param props   - Props d'origine
 * @param signedUrl- Lien signé (ou null)
 * @returns Props avec `attachmentSignedUrl` renseigné pour les rapports
 */
export function injectSignedUrl(
  type: EmailNotificationType,
  props: unknown,
  signedUrl: string | null
): unknown {
  if (type === "MANAGER_ALERT") return props;
  if (typeof props !== "object" || props === null) return props;
  return { ...(props as Record<string, unknown>), attachmentSignedUrl: signedUrl };
}

/**
 * Fabrique la `SendFn` NOTIF-001 du canal email : transmet le message rendu à
 * l'`EmailAdapter` (mock Resend en NOTIF-004). Le message est calculé par le
 * producteur et fourni au worker via un « resolver » indexé par `dedupeKey`.
 *
 * Politique d'échec (les erreurs de `send` se propagent telles quelles) :
 *  - Erreur transitoire (`EmailSendError.retryable = true`, un `NotificationSendError`)
 *    → retry/backoff NOTIF-001 ; à épuisement, DLQ avec la raison énumérée.
 *  - Bounce dur (`retryable = false`) → le worker NOTIF-001 (`isNonRetryable`) route
 *    en DLQ + log FAILED SANS retry infini, en préservant la raison énumérée.
 *
 * @param adapter        - Adaptateur email (mock Resend)
 * @param resolveMessage - Retourne le message rendu pour un job (par dedupeKey)
 * @returns `SendFn` compatible worker NOTIF-001
 */
export function makeEmailSendFn(
  adapter: EmailAdapter,
  resolveMessage: (job: NotificationJobData) => EmailMessage | undefined
): SendFn {
  return async (job: NotificationJobData): Promise<SendOutcome> => {
    const message = resolveMessage(job);
    /* v8 ignore next 3 — garde défensive : le producteur enregistre toujours le message. */
    if (!message) {
      throw new UnrecoverableError("Message email introuvable pour ce job.");
    }
    const res = await adapter.send(message);
    return { providerMessageId: res.providerMessageId };
    // Les erreurs de `send` se propagent telles quelles :
    //  - transitoire (`EmailSendError.retryable = true`) → retry/backoff NOTIF-001 ;
    //  - bounce dur (`retryable = false`) → le worker (`isNonRetryable`) route en DLQ
    //    SANS retry infini, en préservant la raison énumérée (`toFailureReason`).
    // `EmailSendError` étant un `NotificationSendError`, la DLQ porte toujours une
    // raison ÉNUMÉRÉE, jamais `UNKNOWN`.
  };
}
