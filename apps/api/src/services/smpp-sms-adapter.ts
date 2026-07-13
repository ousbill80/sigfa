/**
 * smpp-sms-adapter — adaptateur SMS RÉEL (fournisseur IAM via SMPP, sender ZENAPI)
 * implémentant l'interface `SmsAdapter` de NOTIF-002. Le MOCK reste le défaut de
 * dev/CI ; ce module est activé UNIQUEMENT quand `SMS_PROVIDER=smpp` + config.
 *
 * LA LOI (SMS-SMPP, derrière l'interface existante) :
 *  - **bind transceiver** persistant (une session réutilisée entre les envois),
 *    **keepalive `enquire_link`** (via `auto_enquire_link_period` de node-smpp),
 *    **reconnexion auto** avec backoff sur perte de session.
 *  - `submit_sm` : `source_addr` = `SMS_SENDER_ID` (ZENAPI) + TON/NPI de config ;
 *    `registered_delivery=1` si DLR activé.
 *  - **messages longs** : node-smpp segmente/concatène automatiquement un
 *    `short_message` string dépassant la limite (UDH), en GSM7 ou UCS2 selon le
 *    contenu — aucun découpage manuel côté application.
 *  - **DLR** : `deliver_sm` entrant → `parseDeliveryReceipt` → statut NOTIF-002
 *    (`DELIVERED`/`FAILED`) transmis à `onDelivery` (câblé à `applyDeliveryAck`),
 *    puis `deliver_sm_resp` accuse le PDU.
 *  - **Erreurs SMPP** → `NotificationSendError` avec `reason` ÉNUMÉRÉE (retryable
 *    vs définitif) : le worker NOTIF-001 route retry/backoff vs DLQ.
 *
 * SÉCURITÉ : aucun secret en dur (tout vient de `SmppConfig`, lue depuis `env`).
 * Ni le mot de passe ni le contenu/numéro (PII) ne sont journalisés.
 *
 * TESTABILITÉ : la session SMPP est INJECTÉE via `SmppDeps.connect` → tests avec
 * session simulée, ZÉRO connexion réseau réelle.
 *
 * @module
 */

import type { EventEmitter } from "node:events";
import smpp from "smpp";
import type { SmppConfig } from "src/config/sms.js";
import {
  NotificationSendError,
  type NotificationFailureReason,
} from "src/services/notification-jobs.js";
import type {
  SmsAdapter,
  SmsSendRequest,
  SmsSendResult,
} from "src/services/sms-adapter.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types de session injectable (sous-ensemble de node-smpp consommé)
// ─────────────────────────────────────────────────────────────────────────────

/** PDU de réponse minimal lu par l'adaptateur (submit_sm_resp / bind resp). */
export interface SubmitResponse {
  /** Statut SMPP (0 = ESME_ROK ; non nul = erreur). */
  command_status: number;
  /** Id message attribué par le SMSC (submit_sm_resp). */
  message_id?: string;
}

/** PDU `deliver_sm` entrant (DLR ou message MO). */
export interface DeliverSmPdu {
  command: string;
  command_status: number;
  sequence_number: number;
  short_message?: string | { message?: string };
  message_state?: number;
  receipted_message_id?: string;
}

/**
 * Surface d'une session SMPP consommée par l'adaptateur (implémentée par la vraie
 * `smpp.Session` ou par un double de test). EventEmitter : `connect`/`close`/
 * `error`/`deliver_sm`.
 */
export interface SmppSessionLike extends EventEmitter {
  /** Bind transceiver (auth). */
  bind_transceiver: (
    options: Record<string, unknown>,
    cb: (pdu: SubmitResponse) => void
  ) => void;
  /** Soumet un SMS. */
  submit_sm: (
    options: Record<string, unknown>,
    cb: (pdu: SubmitResponse) => void
  ) => void;
  /** Accuse un `deliver_sm` entrant. */
  deliver_sm_resp: (options: {
    sequence_number: number;
    command_status?: number;
  }) => void;
  /** Ferme la session. */
  close: (callback?: () => void) => void;
  /** Détruit la socket. */
  destroy: (callback?: () => void) => void;
}

/** Accusé de livraison normalisé issu d'un DLR SMPP. */
export interface SmppDeliveryAck {
  /** Id fournisseur (corrélation `provider_message_id`). */
  messageId: string;
  /** Statut terminal. */
  status: "DELIVERED" | "FAILED";
}

/** Dépendances injectables de l'adaptateur (session + horloges + hooks). */
export interface SmppDeps {
  /** Ouvre une nouvelle session (défaut : `smpp.connect` réel). */
  connect?: (config: SmppConfig) => SmppSessionLike;
  /** Délai de base de reconnexion (ms) — défaut 2 s. */
  reconnectDelayMs?: number;
  /** Hook DLR : reçoit chaque accusé normalisé (câblé à `applyDeliveryAck`). */
  onDelivery?: (ack: SmppDeliveryAck) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fonctions PURES : mapping d'erreurs SMPP + parsing DLR + build submit_sm
// ─────────────────────────────────────────────────────────────────────────────

/** Résultat du mapping d'un statut d'erreur SMPP. */
export interface MappedError {
  /** Raison énumérée NOTIF-001. */
  reason: NotificationFailureReason;
  /** `true` si transitoire (retry BullMQ), `false` si définitif (DLQ). */
  retryable: boolean;
}

const E = smpp.errors;

/**
 * Mappe un `command_status` SMPP vers la raison énumérée NOTIF-001 + retryable.
 * Les erreurs transitoires (throttling, file pleine, erreur système, bind refusé)
 * sont retryables ; les fautes définitives (adresse/source invalide) ne le sont pas.
 * Tout code inconnu ⇒ `UNKNOWN` définitif (jamais de retry infini).
 *
 * @param status - `command_status` SMPP (non nul)
 * @returns Raison énumérée + drapeau retryable
 */
export function mapSmppErrorToReason(status: number): MappedError {
  switch (status) {
    // Throttling / file pleine → transitoire (quota).
    case E["ESME_RTHROTTLED"]:
    case E["ESME_RMSGQFUL"]:
      return { reason: "QUOTA_EXCEEDED", retryable: true };
    // Erreur système / bind (auth, statut, déjà bindé) → transitoire (indispo).
    case E["ESME_RSYSERR"]:
    case E["ESME_RBINDFAIL"]:
    case E["ESME_RINVPASWD"]:
    case E["ESME_RINVSYSID"]:
    case E["ESME_RINVBNDSTS"]:
    case E["ESME_RSUBMITFAIL"]:
      return { reason: "PROVIDER_UNREACHABLE", retryable: true };
    // Adresse destinataire / source invalide → définitif.
    case E["ESME_RINVDSTADR"]:
    case E["ESME_RINVSRCADR"]:
    case E["ESME_RINVDSTTON"]:
    case E["ESME_RINVDSTNPI"]:
      return { reason: "INVALID_NUMBER", retryable: false };
    default:
      return { reason: "UNKNOWN", retryable: false };
  }
}

/** Extrait le texte brut d'un `short_message` (string ou `{ message }`). */
function shortMessageText(
  sm: string | { message?: string } | undefined
): string {
  if (sm === undefined) return "";
  if (typeof sm === "string") return sm;
  return sm.message ?? "";
}

/** Statuts DLR textuels considérés comme livraison réussie. */
const DELIVERED_STATES = new Set(["DELIVRD", "ACCEPTD"]);

/**
 * Parse un PDU `deliver_sm` : si c'est un DLR (accusé), renvoie l'accusé normalisé
 * (`messageId` + `DELIVERED`/`FAILED`) ; si c'est un message entrant (MO) sans
 * receipt, renvoie `null`. Reconnaît le format texte (`id:.. stat:..`) ET les TLV
 * (`message_state` + `receipted_message_id`).
 *
 * @param pdu - PDU `deliver_sm` entrant
 * @returns Accusé normalisé, ou `null` si ce n'est pas un DLR
 */
export function parseDeliveryReceipt(pdu: DeliverSmPdu): SmppDeliveryAck | null {
  // 1. Voie TLV : message_state + receipted_message_id (SMPP 3.4+).
  if (pdu.message_state !== undefined && pdu.receipted_message_id) {
    const delivered = pdu.message_state === smpp.consts["MESSAGE_STATE"]["DELIVERED"];
    return {
      messageId: pdu.receipted_message_id,
      status: delivered ? "DELIVERED" : "FAILED",
    };
  }
  // 2. Voie texte : « id:<mid> ... stat:<STATE> ... ».
  const text = shortMessageText(pdu.short_message);
  const idMatch = /id:([^ ]+)/i.exec(text);
  const statMatch = /stat:([A-Z]+)/i.exec(text);
  if (!idMatch || !statMatch) {
    // Ni TLV ni receipt texte ⇒ message entrant ordinaire (pas un DLR).
    return null;
  }
  const messageId = idMatch[1] ?? "";
  const state = (statMatch[1] ?? "").toUpperCase();
  return {
    messageId,
    status: DELIVERED_STATES.has(state) ? "DELIVERED" : "FAILED",
  };
}

/** PDU `submit_sm` construit (options passées à node-smpp). */
export interface SubmitSmPdu {
  source_addr_ton: number;
  source_addr_npi: number;
  source_addr: string;
  dest_addr_ton: number;
  dest_addr_npi: number;
  destination_addr: string;
  registered_delivery: number;
  short_message: string;
  /** Compatibilité avec la signature `submit_sm(options)` de node-smpp. */
  [key: string]: string | number;
}

/**
 * Construit les options `submit_sm` : `source_addr` = sender (ZENAPI) + TON/NPI de
 * config, destinataire, DLR selon config. Le `short_message` est transmis ENTIER
 * (string) : node-smpp choisit l'encodage (GSM7/UCS2) et segmente/concatène en
 * UDH automatiquement pour les messages longs (> 160 GSM7 / > 70 UCS2).
 *
 * @param config - Config SMPP résolue (sender/TON/NPI/DLR)
 * @param req    - Requête d'envoi (numéro en clair + corps)
 * @returns Options `submit_sm`
 */
export function buildSubmitSm(
  config: SmppConfig,
  req: SmsSendRequest
): SubmitSmPdu {
  return {
    source_addr_ton: config.sourceTon,
    source_addr_npi: config.sourceNpi,
    source_addr: config.senderId,
    dest_addr_ton: config.destTon,
    dest_addr_npi: config.destNpi,
    destination_addr: req.to,
    registered_delivery: config.enableDlr ? 1 : 0,
    short_message: req.body,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Adaptateur SMPP
// ─────────────────────────────────────────────────────────────────────────────

/** Connecteur réel : ouvre une session node-smpp avec keepalive enquire_link. */
function realConnect(config: SmppConfig): SmppSessionLike {
  const session = smpp.connect({
    host: config.host,
    port: config.port,
    // Keepalive : enquire_link automatique toutes les 30 s (session vivante).
    auto_enquire_link_period: 30_000,
  });
  return session as unknown as SmppSessionLike;
}

/**
 * Adaptateur SMS SMPP : implémente `SmsAdapter` avec une session transceiver
 * persistante, keepalive, reconnexion auto et traitement des DLR. AUCUNE connexion
 * réseau tant que `send` (ou `bind`) n'est pas appelé (session lazy).
 */
export class SmppSmsAdapter implements SmsAdapter {
  private readonly config: SmppConfig;
  private readonly connectFn: (config: SmppConfig) => SmppSessionLike;
  private readonly reconnectDelayMs: number;
  private readonly onDelivery?: (ack: SmppDeliveryAck) => Promise<void>;

  /** Session courante (null tant que non bindée / après fermeture). */
  private session: SmppSessionLike | null = null;
  /** Promesse de bind en cours (une seule à la fois). */
  private binding: Promise<SmppSessionLike> | null = null;
  /** Fermeture explicite demandée (stoppe la reconnexion auto). */
  private closed = false;
  /** Timer de reconnexion programmée (annulable à la fermeture). */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: SmppConfig, deps: SmppDeps = {}) {
    this.config = config;
    this.connectFn = deps.connect ?? realConnect;
    this.reconnectDelayMs = deps.reconnectDelayMs ?? 2_000;
    this.onDelivery = deps.onDelivery;
  }

  /**
   * Envoie un SMS via `submit_sm` sur la session bindée (établie à la demande).
   * Un `command_status` non nul est mappé en `NotificationSendError` (retryable
   * ou définitif). Le numéro/corps ne sont jamais journalisés.
   *
   * @param req - Numéro en clair + corps rendu
   * @returns `providerMessageId` (id SMSC) si accepté
   * @throws {NotificationSendError} Sur erreur SMPP (raison énumérée)
   */
  async send(req: SmsSendRequest): Promise<SmsSendResult> {
    const session = await this.ensureBound();
    const pdu = buildSubmitSm(this.config, req);
    return new Promise<SmsSendResult>((resolve, reject) => {
      session.submit_sm(pdu, (resp: SubmitResponse) => {
        if (resp.command_status !== 0) {
          const mapped = mapSmppErrorToReason(resp.command_status);
          reject(
            new NotificationSendError(
              mapped.reason,
              `SMPP submit_sm status=0x${resp.command_status.toString(16)}`
            )
          );
          return;
        }
        resolve({ providerMessageId: resp.message_id ?? "" });
      });
    });
  }

  /** Ferme proprement la session et stoppe la reconnexion. */
  close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const session = this.session;
    this.session = null;
    this.binding = null;
    if (session === null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      session.close(() => resolve());
    });
  }

  /** Garantit une session bindée (idempotent : réutilise l'existante). */
  private ensureBound(): Promise<SmppSessionLike> {
    if (this.session !== null) return Promise.resolve(this.session);
    if (this.binding !== null) return this.binding;
    this.binding = this.openAndBind();
    return this.binding;
  }

  /** Ouvre une session, attend `connect`, puis bind transceiver. */
  private openAndBind(): Promise<SmppSessionLike> {
    return new Promise<SmppSessionLike>((resolve, reject) => {
      const session = this.connectFn(this.config);
      // Listener 'error' TOUJOURS présent : un EventEmitter sans listener 'error'
      // lève et tue le process. On ne journalise jamais de PII ici.
      session.on("error", () => {
        /* capturé : la reconnexion est pilotée par l'événement 'close'. */
      });
      // Reconnexion auto sur perte de session (sauf fermeture explicite).
      session.on("close", () => {
        this.handleClose(session);
      });
      // DLR entrants.
      session.on("deliver_sm", (pdu: DeliverSmPdu) => {
        this.handleDeliverSm(session, pdu);
      });

      session.on("connect", () => {
        session.bind_transceiver(
          {
            system_id: this.config.systemId,
            password: this.config.password,
          },
          (pdu: SubmitResponse) => {
            if (pdu.command_status !== 0) {
              const mapped = mapSmppErrorToReason(pdu.command_status);
              this.binding = null;
              reject(
                new NotificationSendError(
                  mapped.reason,
                  `SMPP bind status=0x${pdu.command_status.toString(16)}`
                )
              );
              return;
            }
            this.session = session;
            this.binding = null;
            resolve(session);
          }
        );
      });
    });
  }

  /** Traite un DLR entrant : normalise, notifie, accuse. */
  private handleDeliverSm(session: SmppSessionLike, pdu: DeliverSmPdu): void {
    const ack = parseDeliveryReceipt(pdu);
    if (ack !== null && this.onDelivery) {
      // On ne bloque pas la boucle SMPP : l'application persiste le statut à part.
      void this.onDelivery(ack).catch(() => {
        /* la persistance gère ses propres erreurs ; jamais de PII loggée ici. */
      });
    }
    // Accuse TOUJOURS le PDU (même MO) pour ne pas bloquer la fenêtre SMPP.
    session.deliver_sm_resp({
      sequence_number: pdu.sequence_number,
      command_status: 0,
    });
  }

  /** Gère la perte de session : programme une reconnexion avec backoff. */
  private handleClose(session: SmppSessionLike): void {
    if (this.session === session) this.session = null;
    if (this.closed) return;
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closed) return;
      // Relance un bind ; les erreurs de reconnexion sont réessayées au 'close'
      // suivant (la session émet 'close' si le bind/connexion échoue).
      this.binding = this.openAndBind();
      this.binding.catch(() => {
        this.binding = null;
      });
    }, this.reconnectDelayMs);
  }
}
