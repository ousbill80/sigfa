/**
 * email-adapter — interface d'adaptateur email + adaptateur MOCK Resend (NOTIF-004).
 *
 * LA LOI (NOTIF-004) :
 *  - Le canal email est branché derrière une INTERFACE `EmailAdapter`. Le vrai
 *    Resend se substituera plus tard SANS refonte (même signature `send`).
 *  - AUCUN envoi réseau réel ici : `MockResendAdapter` simule les issues d'un
 *    fournisseur email — succès (2xx → `providerMessageId`), erreur transitoire
 *    (429/5xx → retry NOTIF-001), bounce dur (adresse invalide → FAILED définitif,
 *    pas de retry infini), et plafond de pièce jointe (repli lien signé).
 *  - Les échecs sont énumérés (`NotificationFailureReason` / `EMAIL_BOUNCED`),
 *    jamais une chaîne libre — le worker NOTIF-001 sait router retry vs DLQ.
 *
 * @module
 */

import {
  NotificationSendError,
  type NotificationFailureReason,
} from "src/services/notification-jobs.js";

/**
 * Message email prêt à transmettre au fournisseur (rendu + destinataires résolus).
 * `html` est produit par les gabarits React Email ; `attachments` sont déjà passées
 * par le contrôle de plafond (le repli lien signé a déjà eu lieu en amont).
 */
export interface EmailMessage {
  /** Adresses internes destinataires (staff — jamais un client final). */
  to: readonly string[];
  /** Adresse d'expédition (domaine banque configuré SPF/DKIM en prod). */
  from: string;
  /** Sujet de l'email. */
  subject: string;
  /** Corps HTML rendu (React Email). */
  html: string;
  /**
   * Pièces jointes en ligne conservées (sous le plafond fournisseur). Les pièces
   * hors limite ont déjà été remplacées par un lien signé dans le corps `html`.
   */
  attachments?: readonly EmailAttachment[];
}

/** Pièce jointe email (contenu binaire encodé base64 + nom + type MIME). */
export interface EmailAttachment {
  /** Nom de fichier affiché (ex. `rapport-2026-07.pdf`). */
  filename: string;
  /** Contenu encodé base64. */
  contentBase64: string;
  /** Type MIME (ex. `application/pdf`). */
  contentType: string;
}

/** Issue d'un envoi accepté par le fournisseur (2xx). */
export interface EmailSendSuccess {
  /** Statut d'acceptation. */
  status: "ACCEPTED";
  /** Référence externe du message (accusé DELIVERED via webhook plus tard). */
  providerMessageId: string;
}

/**
 * Erreur d'envoi email portant une raison énumérée + un drapeau `retryable`.
 *
 * Sous-classe de `NotificationSendError` (NOTIF-001) : `toFailureReason` du worker
 * lit donc `reason` directement — la DLQ porte une raison ÉNUMÉRÉE, jamais `UNKNOWN`.
 *
 * - `retryable = true` : erreur transitoire (429 / 5xx) → le worker NOTIF-001
 *   applique son backoff. Raison `PROVIDER_UNREACHABLE` ou `QUOTA_EXCEEDED`.
 * - `retryable = false` : faute définitive (bounce dur = adresse invalide) → le
 *   worker route en DLQ SANS réessayer indéfiniment (raison énumérée `INVALID_NUMBER`
 *   = adresse invalide ; conceptuellement l'état `EMAIL_BOUNCED` du PRD).
 */
export class EmailSendError extends NotificationSendError {
  /** `true` si l'erreur est transitoire (retry NOTIF-001), `false` si définitive. */
  readonly retryable: boolean;
  constructor(
    reason: NotificationFailureReason,
    retryable: boolean,
    message?: string
  ) {
    super(reason, message);
    this.name = "EmailSendError";
    this.retryable = retryable;
  }
}

/**
 * Interface d'adaptateur email. Le worker email injecte une implémentation ;
 * `MockResendAdapter` en NOTIF-004, adaptateur Resend réel plus tard (même contrat).
 */
export interface EmailAdapter {
  /**
   * Transmet un message au fournisseur.
   *
   * @param message - Email rendu + destinataires internes résolus
   * @returns Accusé d'acceptation (2xx) avec `providerMessageId`
   * @throws {EmailSendError} Erreur transitoire (retryable) ou bounce dur (définitif)
   */
  send: (message: EmailMessage) => Promise<EmailSendSuccess>;
}

/**
 * Issue simulée que `MockResendAdapter` doit produire pour une adresse donnée.
 * Le mot-clé (localpart de l'email) pilote le comportement en test/dev, sans jamais
 * toucher le réseau.
 */
export type MockOutcome = "ACCEPT" | "TRANSIENT" | "RATE_LIMIT" | "HARD_BOUNCE";

/** Options de construction de l'adaptateur mock. */
export interface MockResendAdapterOptions {
  /**
   * Décide l'issue pour un message donné (défaut : `ACCEPT`). Injectable pour
   * simuler de façon DÉTERMINISTE succès / transitoire / limite / bounce.
   */
  decide?: (message: EmailMessage) => MockOutcome;
  /**
   * Génère l'id de message provider (défaut : dérivé déterministe du sujet+dest).
   * Injectable pour des snapshots stables.
   */
  makeMessageId?: (message: EmailMessage) => string;
}

/** Préfixe des localparts reconnus comme déclencheurs d'issue (mock). */
const BOUNCE_LOCALPART = "bounce@";
const TRANSIENT_LOCALPART = "transient@";
const RATELIMIT_LOCALPART = "ratelimit@";

/**
 * Décideur d'issue par défaut : lit le localpart de la première adresse pour
 * simuler un comportement fournisseur SANS aucune I/O réseau. Tout ce qui n'est
 * pas un déclencheur connu est `ACCEPT`.
 *
 * @param message - Email à évaluer
 * @returns Issue simulée
 */
export function defaultMockDecider(message: EmailMessage): MockOutcome {
  const first = message.to[0] ?? "";
  if (first.startsWith(BOUNCE_LOCALPART)) return "HARD_BOUNCE";
  if (first.startsWith(TRANSIENT_LOCALPART)) return "TRANSIENT";
  if (first.startsWith(RATELIMIT_LOCALPART)) return "RATE_LIMIT";
  return "ACCEPT";
}

/**
 * Adaptateur MOCK Resend : simule les issues d'un fournisseur email sans jamais
 * émettre de requête réseau. Prouve que le worker email traite correctement le
 * succès, la limite de débit, l'erreur transitoire et le bounce dur.
 *
 * Le vrai adaptateur Resend implémentera la MÊME interface `EmailAdapter` : le
 * worker ne changera pas.
 */
export class MockResendAdapter implements EmailAdapter {
  /** Nombre d'appels `send` (observabilité de test). */
  public calls = 0;
  /** Dernier message transmis (observabilité de test). */
  public lastMessage: EmailMessage | undefined;

  private readonly decide: (message: EmailMessage) => MockOutcome;
  private readonly makeMessageId: (message: EmailMessage) => string;

  constructor(options: MockResendAdapterOptions = {}) {
    this.decide = options.decide ?? defaultMockDecider;
    this.makeMessageId =
      options.makeMessageId ??
      ((m): string => `mock-resend-${m.to.length}-${m.subject.length}`);
  }

  /** @inheritdoc */
  async send(message: EmailMessage): Promise<EmailSendSuccess> {
    this.calls += 1;
    this.lastMessage = message;
    const outcome = this.decide(message);
    switch (outcome) {
      case "ACCEPT":
        return {
          status: "ACCEPTED",
          providerMessageId: this.makeMessageId(message),
        };
      case "TRANSIENT":
        // 5xx fournisseur → transitoire, le worker NOTIF-001 réessaie.
        throw new EmailSendError(
          "PROVIDER_UNREACHABLE",
          true,
          "mock: erreur fournisseur transitoire (5xx)"
        );
      case "RATE_LIMIT":
        // 429 → transitoire, retry/backoff NOTIF-001.
        throw new EmailSendError(
          "QUOTA_EXCEEDED",
          true,
          "mock: limite de débit fournisseur (429)"
        );
      case "HARD_BOUNCE":
        // Adresse invalide → définitif, pas de retry infini → DLQ + alerte config.
        throw new EmailSendError(
          "INVALID_NUMBER",
          false,
          "mock: bounce dur (adresse invalide)"
        );
      /* v8 ignore next 3 — exhaustif : MockOutcome n'a pas d'autre valeur. */
      default:
        throw new EmailSendError("UNKNOWN", true, "mock: issue inconnue");
    }
  }
}
