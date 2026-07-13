/**
 * whatsapp-inbound — traitement d'un message WhatsApp ENTRANT (NOTIF-003).
 *
 * Implémente le webhook CONTRACT-003 `POST /webhooks/whatsapp/inbound/{bankSlug}` :
 *  - **Routage tenant** par `bankSlug` → résolution `bank_id` (source de vérité D5).
 *  - **NLU par règles** (`whatsapp-intent`, PAS d'IA) : « prendre un ticket » /
 *    « état » / ambiguë→aide, selon le mapping menu C4 (CONTRACT-013).
 *  - **Idempotence par `provider_message_id` entrant** : un message redélivré par
 *    Meta (retries fournisseur) ⇒ un SEUL ticket créé (dédoublonnage persistant).
 *  - **Opt-in `INBOUND_WHATSAPP` traçable** : le premier message entrant vaut opt-in
 *    explicite pour le canal WHATSAPP UNIQUEMENT (l'utilisateur a initié la
 *    conversation) — jamais de présomption sur les autres canaux.
 *  - **Garde tenant D5** : toutes les écritures sous `withTenant(bank_id)` + filtre
 *    `bank_id` explicite.
 *  - **PII** : le numéro entrant n'est utilisé qu'en mémoire (hash + chiffré) ; il
 *    n'est jamais journalisé en clair.
 *
 * La création de ticket réutilise le cycle de vie API-003 via un port injecté
 * (`IssueTicketPort`) — c'est une réutilisation, pas un nouvel endpoint métier.
 *
 * @module
 */

import { withTenant, type QueryFn } from "@sigfa/database";
import {
  classifyIntent,
  buildHelpMessage,
  type WhatsAppMenuMapping,
} from "src/services/whatsapp/whatsapp-intent.js";
import type { SmsLang } from "src/services/sms-templates-render.js";

// ─────────────────────────────────────────────────────────────────────────────
// Payload WhatsApp Business API entrant (sous-ensemble utile — LA LOI CONTRACT-003)
// ─────────────────────────────────────────────────────────────────────────────

/** Message extrait du payload entrant (numéro + texte). */
export interface InboundMessage {
  /** Numéro expéditeur E.164 (jamais journalisé en clair). */
  from: string;
  /** Corps texte du message. */
  text: string;
  /** Id fournisseur du message (clé d'idempotence entrante). */
  providerMessageId: string;
}

/**
 * Extrait le PREMIER message texte exploitable d'un payload WhatsApp Business.
 * Structure : `entry[].changes[].value.messages[]` (type `text`). Renvoie `null`
 * si aucun message texte n'est présent (payload de statut, autre type, etc.).
 *
 * @param payload - Corps JSON validé du webhook (structure Meta)
 * @returns Premier message texte, ou `null`
 */
export function extractInboundMessage(payload: unknown): InboundMessage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const entry = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entry)) return null;
  for (const e of entry) {
    const changes = (e as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const ch of changes) {
      const value = (ch as { value?: unknown }).value;
      const messages = (value as { messages?: unknown } | undefined)?.messages;
      if (!Array.isArray(messages)) continue;
      for (const m of messages) {
        const msg = m as {
          from?: unknown;
          id?: unknown;
          type?: unknown;
          text?: { body?: unknown };
        };
        if (
          msg.type === "text" &&
          typeof msg.from === "string" &&
          typeof msg.id === "string" &&
          typeof msg.text?.body === "string"
        ) {
          return {
            from: msg.from,
            text: msg.text.body,
            providerMessageId: msg.id,
          };
        }
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ports injectés (crypto téléphone, résolution config, émission ticket)
// ─────────────────────────────────────────────────────────────────────────────

/** Config WhatsApp d'une banque résolue par `bankSlug` (C4, CONTRACT-013). */
export interface ResolvedWhatsAppConfig {
  /** Tenant — banque propriétaire (source de vérité D5). */
  bankId: string;
  /** Agence par défaut pour les tickets entrants (résolue par la config banque). */
  agencyId: string;
  /** Secret HMAC du webhook entrant, propre à la banque (vérif signature). */
  webhookSecret: string;
  /** Mapping menu/mot-clé → service (C4). */
  menuMapping: WhatsAppMenuMapping[];
}

/** Cryptographie du téléphone entrant (DB-008). */
export interface PhoneCryptoPort {
  /** Normalise + hash déterministe (colonne de recherche). */
  hashPhone: (raw: string) => string;
  /** Chiffre au repos (`v1:iv:tag:ct`). */
  encryptPhone: (raw: string) => string;
  /** Normalise vers E.164 (avant hash/chiffrement). */
  normalizePhone: (raw: string) => string;
}

/** Résultat d'émission d'un ticket (sous-ensemble utile à la réponse entrante). */
export interface IssuedTicket {
  /** Numéro d'affichage court (ex. `A012`). */
  number: string;
  /** Position dans la file. */
  position: number;
  /** Estimation d'attente (minutes). */
  estimatedWaitMinutes: number;
}

/** Port d'émission de ticket (réutilise le cycle de vie API-003). */
export interface IssueTicketPort {
  /**
   * Émet un ticket WhatsApp pour `(bankId, agencyId, serviceId)`.
   *
   * @param args - Tenant + service + numéro en clair (opt-in WHATSAPP déjà tracé)
   * @returns Ticket émis (numéro, position, estimation)
   */
  issue: (args: {
    bankId: string;
    agencyId: string;
    serviceId: string;
    phoneNumber: string;
  }) => Promise<IssuedTicket>;
}

/** Dépendances du traitement d'un message entrant. */
export interface InboundDeps {
  /** Requête SQL applicative (hors RLS de session). */
  queryFn: QueryFn;
  /** Config WhatsApp de la banque (résolue par bankSlug en amont). */
  config: ResolvedWhatsAppConfig;
  /** Cryptographie du téléphone (DB-008). */
  crypto: PhoneCryptoPort;
  /** Émission de ticket (API-003). */
  issueTicket: IssueTicketPort;
  /** Langue de réponse (FR/EN) — défaut FR. */
  lang?: SmsLang;
}

/** Résultat du traitement d'un message entrant (réponse à renvoyer + effet). */
export type InboundResult =
  | { kind: "TICKET_CREATED"; reply: string; ticket: IssuedTicket; deduped: false }
  | { kind: "DEDUPED"; reply: string; deduped: true }
  | { kind: "STATUS"; reply: string }
  | { kind: "HELP"; reply: string }
  | { kind: "IGNORED" };

/** Escape minimal d'une valeur SQL littérale. */
function sqlLit(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Trace l'opt-in `INBOUND_WHATSAPP` pour `(bank, phone_hash, WHATSAPP)` de façon
 * idempotente : le premier message entrant vaut opt-in explicite pour le canal
 * WHATSAPP UNIQUEMENT. Un consentement déjà présent n'est PAS écrasé (préserve un
 * opt-out volontaire → on ne réactive pas un consentement révoqué). Aucun autre
 * canal n'est touché.
 *
 * @param query          - Requête SQL sous garde tenant
 * @param bankId         - Tenant
 * @param phoneHash      - Empreinte du numéro entrant
 * @param phoneEncrypted - Numéro chiffré au repos
 */
async function traceInboundOptIn(
  query: QueryFn,
  bankId: string,
  phoneHash: string,
  phoneEncrypted: string
): Promise<void> {
  // ON CONFLICT DO NOTHING : ne réactive JAMAIS un opt-out existant, ne duplique pas.
  // `source` trace INBOUND_WHATSAPP (C3). Canal WHATSAPP strict (jamais SMS/autres).
  await query(
    `INSERT INTO notification_consents
        (bank_id, phone_encrypted, phone_hash, channel, opted_in, opted_at, source)
     VALUES ('${sqlLit(bankId)}', '${sqlLit(phoneEncrypted)}', '${sqlLit(phoneHash)}',
             'WHATSAPP'::notification_channel, true, NOW(), 'INBOUND_WHATSAPP')
     ON CONFLICT (bank_id, phone_hash, channel) DO NOTHING`
  );
}

/**
 * Marque un `provider_message_id` entrant comme traité (idempotence). Renvoie
 * `true` si c'est la PREMIÈRE fois (insertion effective), `false` si le message a
 * déjà été traité (redélivrance Meta). L'unicité `(bank_id, provider_message_id)`
 * garantit un seul traitement même en concurrence.
 *
 * @param query             - Requête SQL sous garde tenant
 * @param bankId            - Tenant
 * @param providerMessageId - Id fournisseur du message entrant
 * @returns `true` si première réception, `false` si déjà traité
 */
async function claimInboundMessage(
  query: QueryFn,
  bankId: string,
  providerMessageId: string
): Promise<boolean> {
  const res = await query(
    `INSERT INTO whatsapp_inbound_messages (bank_id, provider_message_id)
     VALUES ('${sqlLit(bankId)}', '${sqlLit(providerMessageId)}')
     ON CONFLICT (bank_id, provider_message_id) DO NOTHING
     RETURNING provider_message_id`
  );
  return res.rows.length > 0;
}

/** Rend la réponse « ticket créé » avec numéro/position/estimation (FR/EN). */
function ticketCreatedReply(lang: SmsLang, t: IssuedTicket): string {
  if (lang === "EN") {
    return `Ticket ${t.number}: you are number ${t.position}, about ${t.estimatedWaitMinutes} min.`;
  }
  return `Ticket ${t.number} : vous êtes ${t.position}e, environ ${t.estimatedWaitMinutes} min.`;
}

/** Rend la réponse « position temps réel » (FR/EN). */
function statusReply(
  lang: SmsLang,
  status: { number: string; position: number; estimatedWaitMinutes: number } | null
): string {
  if (status === null) {
    return lang === "EN"
      ? "You have no active ticket. Reply to take one."
      : "Vous n'avez aucun ticket actif. Répondez pour en prendre un.";
  }
  if (lang === "EN") {
    return `Ticket ${status.number}: you are number ${status.position}, about ${status.estimatedWaitMinutes} min.`;
  }
  return `Ticket ${status.number} : vous êtes ${status.position}e, environ ${status.estimatedWaitMinutes} min.`;
}

/**
 * Charge la position temps réel du DERNIER ticket actif (WAITING/CALLED) du
 * `phone_hash` dans la banque, sous garde tenant. Position = rang par
 * `issued_at` parmi les tickets actifs de la même file. `null` si aucun ticket actif.
 *
 * @param query     - Requête SQL sous garde tenant
 * @param bankId    - Tenant
 * @param phoneHash - Empreinte du numéro
 * @returns Position du dernier ticket actif, ou `null`
 */
async function loadActiveTicketStatus(
  query: QueryFn,
  bankId: string,
  phoneHash: string
): Promise<{ number: string; position: number; estimatedWaitMinutes: number } | null> {
  const res = await query(
    `SELECT t.id, t.number, t.display_number, t.queue_id, t.issued_at
       FROM tickets t
      WHERE t.bank_id = '${sqlLit(bankId)}'
        AND t.phone_hash = '${sqlLit(phoneHash)}'
        AND t.status IN ('WAITING','CALLED')
      ORDER BY t.issued_at DESC
      LIMIT 1`
  );
  const row = res.rows[0] as
    | { id: string; number: number; display_number: string | null; queue_id: string; issued_at: string | Date }
    | undefined;
  if (!row) return null;
  // `issued_at` peut être une `Date` (driver pg) ou une chaîne : normaliser en ISO.
  const issuedAtIso =
    row.issued_at instanceof Date ? row.issued_at.toISOString() : String(row.issued_at);
  const posRes = await query(
    `SELECT COUNT(*)::int AS ahead
       FROM tickets t2
      WHERE t2.bank_id = '${sqlLit(bankId)}'
        AND t2.queue_id = '${sqlLit(row.queue_id)}'
        AND t2.status IN ('WAITING','CALLED')
        AND t2.issued_at <= '${sqlLit(issuedAtIso)}'`
  );
  const ahead = Number((posRes.rows[0] as { ahead: number }).ahead);
  const displayNumber =
    row.display_number ?? `A${String(row.number).padStart(3, "0")}`;
  return { number: displayNumber, position: ahead, estimatedWaitMinutes: ahead * 5 };
}

/**
 * Traite un message WhatsApp ENTRANT valide (signature déjà vérifiée en amont).
 *
 * Flux :
 *  1. Idempotence : `claimInboundMessage` par `provider_message_id` — redélivrance
 *     ⇒ `DEDUPED` (aucun ticket, réponse neutre). PREMIÈRE réception ⇒ suite.
 *  2. Opt-in `INBOUND_WHATSAPP` tracé (canal WHATSAPP strict).
 *  3. NLU par règles → intention. `TAKE_TICKET` ⇒ émission ticket (API-003) +
 *     réponse position ; `CHECK_STATUS` ⇒ position du dernier ticket actif ;
 *     `HELP` ⇒ message d'aide (menu FR/EN), zéro ticket.
 *
 * Tout sous `withTenant(bank_id)` (D5). Le numéro entrant n'est jamais en clair
 * dans un journal (hash + chiffré).
 *
 * @param msg  - Message entrant extrait (numéro + texte + id fournisseur)
 * @param deps - queryFn, config banque, crypto, port d'émission, langue
 * @returns Résultat du traitement (réponse + effet)
 */
export async function processInboundMessage(
  msg: InboundMessage,
  deps: InboundDeps
): Promise<InboundResult> {
  const lang: SmsLang = deps.lang ?? "FR";
  const { bankId } = deps.config;
  const normalized = deps.crypto.normalizePhone(msg.from);
  const phoneHash = deps.crypto.hashPhone(normalized);
  const phoneEncrypted = deps.crypto.encryptPhone(normalized);

  return withTenant(deps.queryFn, bankId, async (query) => {
    // 1. Idempotence entrante par provider_message_id (garde tenant D5).
    const first = await claimInboundMessage(query, bankId, msg.providerMessageId);
    if (!first) {
      // Redélivrance Meta : aucun nouveau ticket, réponse neutre (déjà traité).
      const reply =
        lang === "EN"
          ? "Your previous message has already been processed."
          : "Votre message précédent a déjà été traité.";
      return { kind: "DEDUPED", reply, deduped: true };
    }

    // 2. Opt-in INBOUND_WHATSAPP tracé (canal WHATSAPP strict, jamais les autres).
    await traceInboundOptIn(query, bankId, phoneHash, phoneEncrypted);

    // 3. NLU par règles (pas d'IA).
    const intent = classifyIntent(msg.text, deps.config.menuMapping);

    if (intent.kind === "TAKE_TICKET") {
      const ticket = await deps.issueTicket.issue({
        bankId,
        agencyId: deps.config.agencyId,
        serviceId: intent.serviceId,
        phoneNumber: normalized,
      });
      return {
        kind: "TICKET_CREATED",
        reply: ticketCreatedReply(lang, ticket),
        ticket,
        deduped: false,
      };
    }

    if (intent.kind === "CHECK_STATUS") {
      const status = await loadActiveTicketStatus(query, bankId, phoneHash);
      return { kind: "STATUS", reply: statusReply(lang, status) };
    }

    // HELP : message d'aide (menu FR/EN), aucun ticket.
    return { kind: "HELP", reply: buildHelpMessage(lang, deps.config.menuMapping) };
  });
}
