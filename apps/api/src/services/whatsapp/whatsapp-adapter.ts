/**
 * whatsapp-adapter — interface fournisseur WhatsApp Business + adaptateur MOCK (NOTIF-003).
 *
 * LA LOI (NOTIF-003, arbitrage « tout en mock derrière interface ») :
 *  - `WhatsAppAdapter` est la SEULE surface qui manipule un numéro en clair. Le
 *    worker déchiffre le numéro juste avant l'appel, le passe à `send`/`reply`, et
 *    ne le journalise jamais (PII : seul le masqué peut sortir).
 *  - Le MOCK simule les issues Meta (2xx / 429 / timeout / template rejeté) SANS
 *    AUCUN appel réseau réel. Le vrai adaptateur `MetaWhatsAppAdapter` se branchera
 *    plus tard en implémentant `WhatsAppAdapter`, sans refonte du worker.
 *  - Les erreurs transitoires (`429`, timeout) lèvent `NotificationSendError` avec
 *    une raison énumérée → retry/backoff NOTIF-001. Le succès renvoie l'id fournisseur.
 *
 * ── LIMITE MOCK ⇄ RÉEL À DOCUMENTER (NOTIF-003) ──────────────────────────────
 *  Meta impose des **templates HSM pré-approuvés** pour tout message SORTANT initié
 *  par l'entreprise HORS de la fenêtre de service de 24 h (la fenêtre s'ouvre au
 *  dernier message ENTRANT du client). Dans cette fenêtre, le texte libre est
 *  autorisé ; en dehors, SEUL un template HSM approuvé (par langue) passe.
 *
 *  ⇒ Le fallback de rendu banque→FR global (repris de NOTIF-002) peut produire un
 *    corps qui, HORS fenêtre 24 h, serait **REFUSÉ par Meta** (template non approuvé).
 *    Ce refus est INVISIBLE sur le mock : un mock « vert » ne garantit PAS le
 *    comportement réel Meta. Le mock expose le cas via l'issue `template_rejected`
 *    (→ `TEMPLATE_REJECTED`) pour prouver la branche d'échec, mais l'approbation
 *    effective des templates HSM est HORS de la portée de ce mock.
 *
 * @module
 */

import { NotificationSendError } from "src/services/notification-jobs.js";

/**
 * Fenêtre de conversation applicable à un envoi sortant WhatsApp (Meta).
 *  - `SESSION` : dans la fenêtre de service 24 h (dernier message entrant < 24 h) —
 *    texte libre autorisé.
 *  - `HSM` : hors fenêtre — SEUL un template HSM pré-approuvé passerait en réel.
 * Le mock ne bloque pas selon la fenêtre (voir LIMITE ci-dessus) ; le champ est
 * transporté pour l'observabilité et pour permettre à un adaptateur réel de décider.
 */
export type WhatsAppWindow = "SESSION" | "HSM";

/** Requête d'envoi WhatsApp (le clair n'existe qu'ici, jamais journalisé). */
export interface WhatsAppSendRequest {
  /** Numéro destinataire en clair E.164 (déchiffré juste avant l'appel). */
  to: string;
  /** Corps du message rendu (templates FR/EN). */
  body: string;
  /**
   * Fenêtre de conversation au moment de l'envoi. `HSM` hors fenêtre 24 h : en
   * réel, Meta exigerait un template approuvé (voir LIMITE du module). Optionnel :
   * défaut `SESSION` (le worker sortant émet en réaction à la file, sans état de
   * fenêtre — la limite est documentée, pas simulée).
   */
  window?: WhatsAppWindow;
}

/** Résultat d'un envoi WhatsApp accepté (2xx) par Meta. */
export interface WhatsAppSendResult {
  /** Référence externe du message (corrélation webhook de livraison). */
  providerMessageId: string;
}

/**
 * Interface d'un fournisseur WhatsApp Business. Le vrai adaptateur Meta
 * l'implémentera à l'identique — le worker ne dépend QUE de cette surface.
 */
export interface WhatsAppAdapter {
  /**
   * Envoie un message WhatsApp. Succès (2xx) ⇒ `WhatsAppSendResult` avec l'id
   * fournisseur. Échec transitoire (429 / timeout) ⇒ `NotificationSendError`
   * (retry BullMQ). Refus template (HSM non approuvé, hors fenêtre) ⇒
   * `NotificationSendError('TEMPLATE_REJECTED')` (définitif → DLQ).
   *
   * @param req - Numéro en clair + corps rendu + fenêtre
   * @returns Référence fournisseur si accepté
   * @throws {NotificationSendError} Sur 429 (`QUOTA_EXCEEDED`), timeout
   *   (`PROVIDER_UNREACHABLE`) ou template refusé (`TEMPLATE_REJECTED`)
   */
  send: (req: WhatsAppSendRequest) => Promise<WhatsAppSendResult>;
}

/** Issue simulée par le MOCK pour un message/scénario donné. */
export type MockWhatsAppOutcome =
  | { kind: "accepted"; providerMessageId: string }
  | { kind: "rate_limited" }
  | { kind: "timeout" }
  | { kind: "invalid_number" }
  | { kind: "template_rejected" };

/** Options de l'adaptateur MOCK. */
export interface MockWhatsAppAdapterOptions {
  /**
   * Décide l'issue simulée pour une requête. Déterministe (injecté en test) —
   * défaut : tout accepté avec un id dérivé d'un compteur (jamais du clair).
   */
  outcomeFor?: (req: WhatsAppSendRequest) => MockWhatsAppOutcome;
  /** Générateur d'id fournisseur (injecté pour le déterminisme). */
  idFactory?: () => string;
}

/** Compteur monotone d'ids MOCK (déterministe, jamais dérivé du clair). */
let mockSeq = 0;

/** Id fournisseur MOCK par défaut : `mock-wa-<n>` (aucune PII). */
function defaultId(): string {
  mockSeq += 1;
  return `mock-wa-${mockSeq}`;
}

/**
 * Crée un adaptateur WhatsApp MOCK : AUCUN appel Meta réel. Simule les issues
 * fournisseur pour prouver le cycle de vie du worker (SENT / retry / DLQ) de façon
 * déterministe et sans réseau.
 *
 * ⚠️ Un mock vert ne prouve PAS l'approbation des templates HSM Meta (voir LIMITE
 * du module) : l'issue `template_rejected` existe pour couvrir la branche d'échec,
 * mais la conformité réelle HSM est hors portée.
 *
 * @param options - Décision d'issue + fabrique d'id (injectables en test)
 * @returns Un `WhatsAppAdapter` conforme, purement en mémoire
 */
export function createMockWhatsAppAdapter(
  options: MockWhatsAppAdapterOptions = {}
): WhatsAppAdapter {
  const idFactory = options.idFactory ?? defaultId;
  const outcomeFor =
    options.outcomeFor ??
    ((): MockWhatsAppOutcome => ({
      kind: "accepted",
      providerMessageId: idFactory(),
    }));

  return {
    send: (req: WhatsAppSendRequest): Promise<WhatsAppSendResult> => {
      const outcome = outcomeFor(req);
      switch (outcome.kind) {
        case "accepted":
          return Promise.resolve({ providerMessageId: outcome.providerMessageId });
        case "rate_limited":
          // 429 Meta → transitoire, retry/backoff NOTIF-001.
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
        case "template_rejected":
          // HSM non approuvé hors fenêtre 24 h → définitif (voir LIMITE du module).
          return Promise.reject(
            new NotificationSendError("TEMPLATE_REJECTED", "MOCK HSM template rejected")
          );
        /* v8 ignore next 2 — exhaustif : tous les kinds sont couverts ci-dessus. */
        default:
          return Promise.reject(new NotificationSendError("UNKNOWN", "MOCK unknown"));
      }
    },
  };
}
