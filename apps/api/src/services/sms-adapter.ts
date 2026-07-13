/**
 * sms-adapter — interface fournisseur SMS + adaptateur MOCK (NOTIF-002).
 *
 * LA LOI (NOTIF-002, arbitrage « tout en mock derrière interface ») :
 *  - `SmsAdapter` est la SEULE surface qui manipule un numéro en clair. Le worker
 *    déchiffre le numéro juste avant l'appel, le passe à `send`, et ne le journalise
 *    jamais (PII : seul le masqué peut sortir).
 *  - Le MOCK simule les issues fournisseur Africa's Talking (2xx / 429 / timeout)
 *    SANS AUCUN appel réseau réel. Le vrai adaptateur `AfricasTalkingSmsAdapter`
 *    se branchera plus tard en implémentant `SmsAdapter`, sans refonte du worker.
 *  - Les erreurs transitoires (`429`, timeout) lèvent `NotificationSendError` avec
 *    une raison énumérée → retry/backoff NOTIF-001. Le succès renvoie l'id fournisseur.
 *
 * @module
 */

import { NotificationSendError } from "src/services/notification-jobs.js";

/** Requête d'envoi SMS (le clair n'existe qu'ici, jamais journalisé). */
export interface SmsSendRequest {
  /** Numéro destinataire en clair E.164 (déchiffré juste avant l'appel). */
  to: string;
  /** Corps du message rendu (templates FR/EN). */
  body: string;
}

/** Résultat d'un envoi SMS accepté (2xx) par le fournisseur. */
export interface SmsSendResult {
  /** Référence externe du message (corrélation webhook de livraison). */
  providerMessageId: string;
}

/**
 * Interface d'un fournisseur SMS. Le vrai adaptateur Africa's Talking
 * l'implémentera à l'identique — le worker ne dépend QUE de cette surface.
 */
export interface SmsAdapter {
  /**
   * Envoie un SMS. Succès (2xx) ⇒ `SmsSendResult` avec l'id fournisseur.
   * Échec transitoire (429 / timeout) ⇒ `NotificationSendError` (retry BullMQ).
   *
   * @param req - Numéro en clair + corps rendu
   * @returns Référence fournisseur si accepté
   * @throws {NotificationSendError} Sur 429 (`QUOTA_EXCEEDED`) ou timeout (`PROVIDER_UNREACHABLE`)
   */
  send: (req: SmsSendRequest) => Promise<SmsSendResult>;
}

/** Issue simulée par le MOCK pour un numéro/scénario donné. */
export type MockSmsOutcome =
  | { kind: "accepted"; providerMessageId: string }
  | { kind: "rate_limited" }
  | { kind: "timeout" }
  | { kind: "invalid_number" };

/** Options de l'adaptateur MOCK. */
export interface MockSmsAdapterOptions {
  /**
   * Décide l'issue simulée pour une requête. Déterministe (injecté en test) —
   * défaut : tout accepté avec un id dérivé du numéro masqué (jamais du clair).
   */
  outcomeFor?: (req: SmsSendRequest) => MockSmsOutcome;
  /** Générateur d'id fournisseur (injecté pour le déterminisme). */
  idFactory?: () => string;
}

/** Compteur monotone d'ids MOCK (déterministe, jamais dérivé du clair). */
let mockSeq = 0;

/** Id fournisseur MOCK par défaut : `mock-sms-<n>` (aucune PII). */
function defaultId(): string {
  mockSeq += 1;
  return `mock-sms-${mockSeq}`;
}

/**
 * Crée un adaptateur SMS MOCK : AUCUN appel Africa's Talking réel. Simule les
 * issues fournisseur pour prouver le cycle de vie du worker (SENT / retry / DLQ)
 * de façon déterministe et sans réseau.
 *
 * @param options - Décision d'issue + fabrique d'id (injectables en test)
 * @returns Un `SmsAdapter` conforme, purement en mémoire
 */
export function createMockSmsAdapter(
  options: MockSmsAdapterOptions = {}
): SmsAdapter {
  const idFactory = options.idFactory ?? defaultId;
  const outcomeFor =
    options.outcomeFor ??
    ((): MockSmsOutcome => ({ kind: "accepted", providerMessageId: idFactory() }));

  return {
    send: (req: SmsSendRequest): Promise<SmsSendResult> => {
      const outcome = outcomeFor(req);
      switch (outcome.kind) {
        case "accepted":
          return Promise.resolve({ providerMessageId: outcome.providerMessageId });
        case "rate_limited":
          // 429 Africa's Talking → transitoire, retry/backoff NOTIF-001.
          return Promise.reject(
            new NotificationSendError("QUOTA_EXCEEDED", "MOCK 429 rate limited")
          );
        case "timeout":
          // Timeout réseau simulé → transitoire.
          return Promise.reject(
            new NotificationSendError("PROVIDER_UNREACHABLE", "MOCK provider timeout")
          );
        case "invalid_number":
          // Numéro invalide → définitif (pas de retry utile).
          return Promise.reject(
            new NotificationSendError("INVALID_NUMBER", "MOCK invalid number")
          );
        /* v8 ignore next 2 — exhaustif : tous les kinds sont couverts ci-dessus. */
        default:
          return Promise.reject(new NotificationSendError("UNKNOWN", "MOCK unknown"));
      }
    },
  };
}
