/**
 * resend-email-adapter — adaptateur email RÉEL Resend derrière l'interface
 * `EmailAdapter` (NOTIF-004) + factory `createEmailAdapter` sélectionnée par config.
 *
 * LA LOI (RESEND-EMAIL) :
 *  - Le mock `MockResendAdapter` (NOTIF-004) reste le DÉFAUT (tests/dev/CI). Le vrai
 *    Resend se substitue SANS refonte du worker : MÊME contrat `EmailAdapter.send`.
 *  - Config lue depuis `process.env` UNIQUEMENT — jamais de secret en dur :
 *    `EMAIL_PROVIDER` (`resend` | `mock`, défaut `mock`), `RESEND_API_KEY`, `RESEND_FROM`.
 *  - La factory ne renvoie l'adaptateur Resend que si `EMAIL_PROVIDER=resend` ET
 *    `RESEND_API_KEY` ET `RESEND_FROM` sont présents — sinon repli mock (jamais de
 *    crash au démarrage faute de secret).
 *  - Le client Resend est INJECTABLE (double de test) : AUCUN appel réseau réel en test.
 *  - Le SDK `resend` renvoie les erreurs fournisseur dans `{ data: null, error }`
 *    (il ne lève pas) ; on les MAPPE sur `NotificationFailureReason` énuméré + un
 *    drapeau `retryable`, comme le mock (retry NOTIF-001 vs DLQ définitive).
 *
 * @module
 */

import { Resend } from "resend";
import {
  EmailSendError,
  MockResendAdapter,
  type EmailAdapter,
  type EmailMessage,
  type EmailSendSuccess,
} from "src/services/email/email-adapter.js";
import type { NotificationFailureReason } from "src/services/notification-jobs.js";

/**
 * Forme minimale d'une pièce jointe transmise au SDK Resend. `content` = base64
 * (le SDK accepte une chaîne base64), `contentType` optionnel dérivé du nom sinon.
 */
export interface ResendAttachmentLike {
  /** Nom de fichier affiché. */
  filename: string;
  /** Contenu encodé base64. */
  content: string;
  /** Type MIME. */
  contentType: string;
}

/** Options d'envoi transmises à `emails.send` (sous-ensemble utilisé ici). */
export interface ResendSendOptions {
  /** Adresse d'expédition (RESEND_FROM). */
  from: string;
  /** Destinataires internes résolus. */
  to: readonly string[];
  /** Sujet. */
  subject: string;
  /** Corps HTML rendu (React Email). */
  html: string;
  /** Pièces jointes en ligne (sous le plafond fournisseur). */
  attachments?: readonly ResendAttachmentLike[];
}

/** Erreur telle que le SDK Resend la retourne dans `{ error }` (jamais levée). */
export interface ResendErrorLike {
  /** Code d'erreur énuméré du SDK (`RESEND_ERROR_CODE_KEY`). */
  name: string;
  /** Code HTTP (peut être `null`). */
  statusCode: number | null;
  /** Message lisible. */
  message: string;
}

/** Réponse de `emails.send` : succès (`data.id`) OU erreur (`error`), jamais levée. */
export type ResendSendResponse =
  | { data: { id: string }; error: null }
  | { data: null; error: ResendErrorLike };

/**
 * Sous-ensemble injectable du client Resend réellement utilisé par l'adaptateur.
 * Permet un double de test SANS réseau et sans dépendre de toute la surface du SDK.
 */
export interface ResendClientLike {
  /** API email du SDK Resend. */
  emails: {
    /** Envoie un email ; retourne succès ou erreur (ne lève pas sur erreur API). */
    send: (options: ResendSendOptions) => Promise<ResendSendResponse>;
  };
}

/** Options de construction de `ResendEmailAdapter`. */
export interface ResendEmailAdapterOptions {
  /** Client Resend (réel ou injecté en test). */
  client: ResendClientLike;
  /** Adresse d'expédition autoritaire (RESEND_FROM). */
  from: string;
}

/**
 * Codes d'erreur Resend transitoires côté quota/débit → `QUOTA_EXCEEDED` retryable.
 * Le worker NOTIF-001 applique son backoff.
 */
const QUOTA_CODES = new Set<string>([
  "rate_limit_exceeded",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
]);

/**
 * Codes d'erreur Resend transitoires côté fournisseur → `PROVIDER_UNREACHABLE`
 * retryable (5xx / indisponibilité).
 */
const PROVIDER_CODES = new Set<string>([
  "internal_server_error",
  "application_error",
]);

/**
 * Codes d'erreur Resend traduisant une adresse/entrée invalide (bounce dur
 * équivalent) → `INVALID_NUMBER` définitif (pas de retry infini, route DLQ).
 */
const INVALID_ADDRESS_CODES = new Set<string>([
  "validation_error",
  "invalid_from_address",
  "invalid_parameter",
  "missing_required_field",
  "invalid_attachment",
]);

/**
 * Mappe une erreur Resend sur une `EmailSendError` énumérée + drapeau `retryable`.
 *
 * Politique :
 *  - Quota/débit (`*_quota_exceeded`, `rate_limit_exceeded`) → `QUOTA_EXCEEDED`, retryable.
 *  - Fournisseur transitoire (`internal_server_error`, `application_error`) ou tout
 *    `statusCode` 5xx → `PROVIDER_UNREACHABLE`, retryable.
 *  - Adresse/entrée invalide (`validation_error`, `invalid_from_address`, …) → bounce
 *    dur → `INVALID_NUMBER`, définitif (non retryable).
 *  - Tout le reste (auth : clé manquante/invalide/restreinte, accès refusé, erreur
 *    inconnue) → définitif `UNKNOWN`, non retryable : la DLQ porte une raison
 *    énumérée et le worker ne réessaie pas indéfiniment une faute de configuration.
 *
 * @param error - Erreur telle que retournée par le SDK Resend
 * @returns `EmailSendError` prête à propager au worker NOTIF-001
 */
export function mapResendError(error: ResendErrorLike): EmailSendError {
  const code = error.name;
  const status = error.statusCode ?? 0;

  if (QUOTA_CODES.has(code) || status === 429) {
    return new EmailSendError(
      "QUOTA_EXCEEDED",
      true,
      `resend: quota/débit (${code}, ${status})`
    );
  }
  if (PROVIDER_CODES.has(code) || status >= 500) {
    return new EmailSendError(
      "PROVIDER_UNREACHABLE",
      true,
      `resend: fournisseur transitoire (${code}, ${status})`
    );
  }
  if (INVALID_ADDRESS_CODES.has(code)) {
    return new EmailSendError(
      "INVALID_NUMBER",
      false,
      `resend: adresse/entrée invalide — bounce dur (${code}, ${status})`
    );
  }
  // Auth (clé manquante/invalide/restreinte, accès refusé) et inconnu : définitif.
  const reason: NotificationFailureReason = "UNKNOWN";
  return new EmailSendError(
    reason,
    false,
    `resend: erreur définitive (${code}, ${status}) — DLQ, pas de retry`
  );
}

/**
 * Adaptateur Resend RÉEL : transmet le message rendu à l'API Resend via le SDK
 * (`emails.send`) et mappe les erreurs sur `NotificationFailureReason`. Implémente
 * la MÊME interface `EmailAdapter` que le mock — le worker NOTIF-004 ne change pas.
 */
export class ResendEmailAdapter implements EmailAdapter {
  private readonly client: ResendClientLike;
  private readonly from: string;

  constructor(options: ResendEmailAdapterOptions) {
    this.client = options.client;
    this.from = options.from;
  }

  /** @inheritdoc */
  async send(message: EmailMessage): Promise<EmailSendSuccess> {
    const options: ResendSendOptions = {
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.attachments && message.attachments.length > 0
        ? { attachments: message.attachments.map(toResendAttachment) }
        : {}),
    };

    let response: ResendSendResponse;
    try {
      response = await this.client.emails.send(options);
    } catch (cause) {
      // Le SDK ne lève pas sur erreur API, mais un échec réseau/DNS/timeout peut
      // rejeter : transitoire → retry/backoff NOTIF-001.
      throw new EmailSendError(
        "PROVIDER_UNREACHABLE",
        true,
        `resend: échec réseau du SDK (${cause instanceof Error ? cause.message : "inconnu"})`
      );
    }

    if (response.error !== null) {
      throw mapResendError(response.error);
    }
    if (response.data === null) {
      // Réponse dégénérée (ni data ni error) : traiter comme transitoire.
      throw new EmailSendError(
        "PROVIDER_UNREACHABLE",
        true,
        "resend: réponse sans data ni error"
      );
    }
    return { status: "ACCEPTED", providerMessageId: response.data.id };
  }
}

/**
 * Mappe une pièce jointe de l'interface `EmailAdapter` vers la forme attendue par
 * le SDK Resend (`content` = base64, `contentType` explicite).
 *
 * @param att - Pièce jointe (base64) de l'interface interne
 * @returns Pièce jointe au format Resend
 */
function toResendAttachment(att: {
  filename: string;
  contentBase64: string;
  contentType: string;
}): ResendAttachmentLike {
  return {
    filename: att.filename,
    content: att.contentBase64,
    contentType: att.contentType,
  };
}

/** Dépendances injectables de la factory (test : client Resend simulé). */
export interface CreateEmailAdapterDeps {
  /**
   * Fabrique le client Resend à partir de la clé API. Injectable en test pour
   * fournir un double SANS réseau ; en prod, instancie le vrai SDK `Resend`.
   */
  clientFactory?: (apiKey: string) => ResendClientLike;
}

/** Nom du fournisseur email sélectionné par `EMAIL_PROVIDER`. */
type EmailProvider = "resend" | "mock";

/**
 * Fabrique par défaut du client Resend réel : instancie le SDK `Resend`. Le SDK n'a
 * aucun effet de bord réseau à la construction (les appels ne partent qu'à `send`),
 * donc le simple chargement du module ne déclenche AUCUNE I/O.
 *
 * @param apiKey - Clé API Resend (depuis `process.env.RESEND_API_KEY`)
 * @returns Client Resend conforme à `ResendClientLike`
 */
function defaultResendClientFactory(apiKey: string): ResendClientLike {
  return new Resend(apiKey) as unknown as ResendClientLike;
}

/**
 * Factory de l'adaptateur email, sélectionnée par CONFIG (`process.env`) :
 *  - `EMAIL_PROVIDER=resend` ET `RESEND_API_KEY` ET `RESEND_FROM` présents →
 *    `ResendEmailAdapter` (envoi réel).
 *  - Sinon (défaut, clé absente, from absent, ou `EMAIL_PROVIDER=mock`) →
 *    `MockResendAdapter` : le mock reste le comportement par défaut de dev/CI.
 *
 * @param env  - Environnement (typiquement `process.env`) — secrets UNIQUEMENT ici.
 * @param deps - Dépendances injectables (client Resend simulé en test).
 * @returns Un `EmailAdapter` prêt pour le worker NOTIF-004
 */
export function createEmailAdapter(
  env: NodeJS.ProcessEnv,
  deps: CreateEmailAdapterDeps = {}
): EmailAdapter {
  const provider: EmailProvider = env.EMAIL_PROVIDER === "resend" ? "resend" : "mock";
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM?.trim();

  if (provider === "resend" && apiKey && from) {
    const clientFactory = deps.clientFactory ?? defaultResendClientFactory;
    return new ResendEmailAdapter({ client: clientFactory(apiKey), from });
  }
  // Repli sûr : mock par défaut (jamais de crash au démarrage faute de secret).
  return new MockResendAdapter();
}
