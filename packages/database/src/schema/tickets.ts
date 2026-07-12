import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  char,
  integer,
  boolean,
  date,
  timestamp,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { banks } from "./banks.js";
import { agencies } from "./agencies.js";
import { services } from "./services.js";
import { operations } from "./operations.js";
import { queues } from "./queues.js";
import { counters } from "./counters.js";
import { users } from "./users.js";
import { ticketStatusEnum, ticketPriorityEnum, ticketChannelEnum, agentLanguageEnum } from "./enums.js";

/**
 * `tickets` — ticket de file (LA LOI `Ticket`).
 *
 * - `number` int + `display_number` `{code}-{NNN}` (composé par l'API).
 * - `tracking_id` char(21) unique (nanoid) · `local_uuid` uuid unique? (idempotence sync).
 * - `priority` enum `TicketPriority` NOT NULL défaut `STANDARD`.
 * - `phone_encrypted`/`phone_hash` text opaques (DB-008) — types DÉFINITIFS.
 * - `issued_day` GENERATED ALWAYS ((issued_at AT TIME ZONE 'Africa/Abidjan')::date) STORED,
 *   + unique `(queue_id, number, issued_day)` : le reset quotidien du compteur est
 *   ancré sur la date LOCALE Abidjan, pas UTC.
 * - `bank_id` NOT NULL, index bank_id-first ; index `(bank_id, phone_hash)`.
 */
export const tickets = pgTable(
  "tickets",
  {
    /** Identifiant unique du ticket. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Agence d'émission (FK RESTRICT). */
    agencyId: uuid("agency_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => agencies.id, { onDelete: "restrict" }),
    /** File d'attente (FK RESTRICT). */
    queueId: uuid("queue_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => queues.id, { onDelete: "restrict" }),
    /** Service demandé (FK RESTRICT). */
    serviceId: uuid("service_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => services.id, { onDelete: "restrict" }),
    /**
     * Opération demandée (FK RESTRICT, NULLABLE — MODEL-DB-A, D1).
     * Additif : `service_id` reste NOT NULL (dérivé applicativement de
     * `operations.service_id` quand `operation_id` est fourni). NULL = F2/F3 inchangé.
     */
    /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
    operationId: uuid("operation_id").references(() => operations.id, { onDelete: "restrict" }),
    /** Guichet de traitement (FK RESTRICT, optionnel). */
    /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
    counterId: uuid("counter_id").references(() => counters.id, { onDelete: "restrict" }),
    /** Agent en charge (FK RESTRICT, optionnel). */
    /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
    agentId: uuid("agent_id").references(() => users.id, { onDelete: "restrict" }),
    /**
     * Conseiller ciblé par le ticket (MODEL-DB-B, D6).
     * NULLABLE (FK users RESTRICT) — quand fourni, le ticket rejoint la file
     * PERSONNELLE de ce conseiller (routage mono-agent, logique en API-B).
     * Additif : ne touche pas `service_id`/`operation_id`/`queue_id`.
     * Pas de nouvelle table file — la file conseiller = filtre `target_manager_id`.
     */
    /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
    targetManagerId: uuid("target_manager_id").references(() => users.id, { onDelete: "restrict" }),
    /** Numéro séquentiel brut dans la file. */
    number: integer("number").notNull(),
    /** Numéro d'affichage `{code}-{NNN}` (composé par l'API). */
    displayNumber: text("display_number"),
    /** Identifiant public de suivi (nanoid 21) — unique. */
    trackingId: char("tracking_id", { length: 21 }).notNull().unique(),
    /** UUID client pour l'idempotence de synchronisation offline — unique. */
    localUuid: uuid("local_uuid").unique(),
    /** Canal d'émission (LA LOI `TicketChannel`). */
    channel: ticketChannelEnum("channel").notNull(),
    /** État du ticket (LA LOI `TicketStatus`). */
    status: ticketStatusEnum("status").notNull().default("WAITING"),
    /** Priorité (LA LOI `TicketPriority`) — défaut STANDARD. */
    priority: ticketPriorityEnum("priority").notNull().default("STANDARD"),
    /** Téléphone chiffré au repos (DB-008) — type DÉFINITIF. */
    phoneEncrypted: text("phone_encrypted"),
    /** Empreinte déterministe du téléphone — type DÉFINITIF. */
    phoneHash: text("phone_hash"),
    /** Consentement SMS/WhatsApp du porteur. */
    smsConsent: boolean("sms_consent").notNull().default(false),
    /** Horodatage d'émission. */
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage d'appel (WAITING → CALLED). */
    calledAt: timestamp("called_at", { withTimezone: true }),
    /** Horodatage de début de service (CALLED → SERVING). */
    servedAt: timestamp("served_at", { withTimezone: true }),
    /** Horodatage de clôture (SERVING → DONE). */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Horodatage de non-présentation. */
    noShowAt: timestamp("no_show_at", { withTimezone: true }),
    /** Temps d'attente (secondes) — calculé par l'API. */
    waitTimeSeconds: integer("wait_time_seconds"),
    /** Temps de service (secondes) — calculé par l'API. */
    serviceTimeSeconds: integer("service_time_seconds"),
    /** Score de satisfaction (1–5). */
    feedbackScore: integer("feedback_score"),
    /** Commentaire de satisfaction (≤500). */
    feedbackComment: text("feedback_comment"),
    /**
     * Langue préférée du porteur du ticket pour le routage par l'API-004.
     * Nullable — la préférence est optionnelle ; NULL = aucune contrainte de langue.
     * Valeurs : `FR` | `DIOULA` | `BAOULE` | `EN` (LA LOI `AgentLanguage`).
     */
    requiredLanguage: agentLanguageEnum("required_language"),
    /** Horodatage du feedback. */
    feedbackAt: timestamp("feedback_at", { withTimezone: true }),
    /**
     * Jour d'émission LOCAL (Africa/Abidjan) — colonne générée STORED.
     * Ancre le reset quotidien du compteur sur la date locale, pas UTC.
     */
    issuedDay: date("issued_day").generatedAlwaysAs(
      sql`((issued_at AT TIME ZONE 'Africa/Abidjan')::date)`
    ),
    /** Horodatage de création (miroir technique de issued_at). */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tickets_bank_id_agency_id_idx").on(table.bankId, table.agencyId),
    index("tickets_bank_id_phone_hash_idx").on(table.bankId, table.phoneHash),
    index("tickets_operation_id_idx").on(table.operationId),
    /** Index file conseiller (MODEL-DB-B, D6) — filtre `target_manager_id`. */
    index("tickets_target_manager_id_idx").on(table.targetManagerId),
    unique("tickets_queue_id_number_issued_day_key").on(
      table.queueId,
      table.number,
      table.issuedDay
    ),
    check(
      "tickets_feedback_score_range",
      sql`${table.feedbackScore} IS NULL OR (${table.feedbackScore} >= 1 AND ${table.feedbackScore} <= 5)`
    ),
    check(
      "tickets_feedback_comment_length",
      sql`${table.feedbackComment} IS NULL OR char_length(${table.feedbackComment}) <= 500`
    ),
  ]
);

/**
 * `ticket_transfers` — historique des cascades de transfert d'un ticket.
 * Deux sauts successifs = deux lignes. `bank_id` NOT NULL, index bank_id-first.
 */
export const ticketTransfers = pgTable(
  "ticket_transfers",
  {
    /** Identifiant unique du transfert. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Ticket transféré (FK RESTRICT). */
    ticketId: uuid("ticket_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => tickets.id, { onDelete: "restrict" }),
    /** Guichet source (FK RESTRICT, optionnel). */
    /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
    fromCounterId: uuid("from_counter_id").references(() => counters.id, { onDelete: "restrict" }),
    /** Service source (FK RESTRICT). */
    fromServiceId: uuid("from_service_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => services.id, { onDelete: "restrict" }),
    /** Service cible (FK RESTRICT). */
    toServiceId: uuid("to_service_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => services.id, { onDelete: "restrict" }),
    /** Guichet cible (FK RESTRICT, optionnel). */
    /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
    toCounterId: uuid("to_counter_id").references(() => counters.id, { onDelete: "restrict" }),
    /** Motif du transfert. */
    reason: text("reason"),
    /** Agent ayant initié le transfert (FK RESTRICT). */
    transferredBy: uuid("transferred_by")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => users.id, { onDelete: "restrict" }),
    /** Horodatage du transfert. */
    transferredAt: timestamp("transferred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ticket_transfers_bank_id_ticket_id_idx").on(table.bankId, table.ticketId),
  ]
);
