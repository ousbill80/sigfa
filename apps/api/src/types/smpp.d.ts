/**
 * Déclaration ambiante MINIMALE de la lib CJS `smpp` (node-smpp), non typée en
 * amont. On ne type QUE la surface consommée par `SmppSmsAdapter` (SMS-SMPP) :
 * `connect`, la `Session` (EventEmitter), `submit_sm`/`deliver_sm_resp`, et les
 * constantes (`consts`, `errors`). Zéro `any` côté application : le reste de la
 * lib n'est pas déclaré (donc inutilisable par mégarde).
 *
 * Note : `smpp` est CJS ; avec `esModuleInterop` on l'importe en default.
 */
declare module "smpp" {
  import type { EventEmitter } from "node:events";

  /** PDU générique (réponse ou message entrant) — champs dynamiques indexés. */
  export interface Pdu {
    /** Nom de la commande (`submit_sm_resp`, `deliver_sm`, …). */
    readonly command: string;
    /** Statut SMPP (0 = ESME_ROK ; non nul = erreur, cf. `errors`). */
    readonly command_status: number;
    /** Numéro de séquence PDU (corrélation requête/réponse). */
    readonly sequence_number: number;
    /** Id du message attribué par le SMSC (présent sur `submit_sm_resp`). */
    readonly message_id?: string;
    /** Corps du message (DLR receipt sur `deliver_sm`). */
    readonly short_message?: string | { message?: string };
    /** État du message (TLV DLR, cf. `consts.MESSAGE_STATE`). */
    readonly message_state?: number;
    /** Id du message référencé par le DLR (TLV `receipted_message_id`). */
    readonly receipted_message_id?: string;
    /** Champs additionnels non typés explicitement (jamais lus « au hasard »). */
    readonly [key: string]: unknown;
  }

  /** Options de `submit_sm` (sous-ensemble consommé). */
  export interface SubmitSmOptions {
    source_addr_ton?: number;
    source_addr_npi?: number;
    source_addr?: string;
    dest_addr_ton?: number;
    dest_addr_npi?: number;
    destination_addr: string;
    registered_delivery?: number;
    /** Corps : string → encodage/segmentation auto (GSM7/UCS2 + UDH concat). */
    short_message: string;
  }

  /** Callback de réponse d'une commande SMPP (le PDU réponse). */
  export type ResponseCallback = (pdu: Pdu) => void;

  /**
   * Session SMPP (client transceiver). EventEmitter : `connect`, `close`,
   * `error`, `pdu`, et un événement par commande entrante (`deliver_sm`).
   */
  export interface Session extends EventEmitter {
    /** Bind transceiver (auth SMSC). */
    bind_transceiver: (
      options: {
        system_id: string;
        password: string;
        system_type?: string;
        interface_version?: number;
        addr_ton?: number;
        addr_npi?: number;
      },
      callback: ResponseCallback
    ) => void;
    /** Soumet un message (SMS). */
    submit_sm: (options: SubmitSmOptions, callback: ResponseCallback) => void;
    /** Accuse réception d'un `deliver_sm` entrant (DLR). */
    deliver_sm_resp: (options: {
      sequence_number: number;
      command_status?: number;
    }) => void;
    /** Ferme proprement la session. */
    close: (callback?: () => void) => void;
    /** Détruit la socket (reconnexion). */
    destroy: (callback?: () => void) => void;
  }

  /** Options d'ouverture de session. */
  export interface ConnectOptions {
    url?: string;
    host?: string;
    port?: number;
    /** Keepalive : période (ms) d'émission automatique d'`enquire_link`. */
    auto_enquire_link_period?: number;
    connectTimeout?: number;
    tls?: boolean;
  }

  /** Ouvre une session cliente. `listener` est appelé sur `connect`. */
  export function connect(
    options: ConnectOptions,
    listener?: (session: Session) => void
  ): Session;

  /** Constantes SMPP (TON/NPI/ENCODING/MESSAGE_STATE/REGISTERED_DELIVERY). */
  export const consts: {
    readonly TON: Record<string, number>;
    readonly NPI: Record<string, number>;
    readonly ENCODING: Record<string, number>;
    readonly MESSAGE_STATE: Record<string, number>;
    readonly REGISTERED_DELIVERY: Record<string, number>;
    readonly ESM_CLASS: Record<string, number>;
  };

  /** Table des statuts d'erreur SMPP (`ESME_*` → code numérique). */
  export const errors: Record<string, number>;

  const smpp: {
    connect: typeof connect;
    consts: typeof consts;
    errors: typeof errors;
  };
  export default smpp;
}
