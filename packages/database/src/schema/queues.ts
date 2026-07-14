import { sql } from "drizzle-orm";
import { pgTable, uuid, integer, boolean, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { banks } from "./banks.js";
import { agencies } from "./agencies.js";
import { services } from "./services.js";
import { queueStatusEnum } from "./enums.js";

/**
 * `queues` — file d'attente d'un service dans une agence.
 *
 * - `current_ticket_number` : compteur séquentiel incrémenté par l'API en
 *   `UPDATE … RETURNING` (lock-then-increment, logique API-003) — jamais côté DB ici.
 *   CHECK `>= 0`.
 * - `bank_id` NOT NULL, index bank_id-first.
 */
export const queues = pgTable(
  "queues",
  {
    /** Identifiant unique de la file. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Agence propriétaire (FK RESTRICT). */
    agencyId: uuid("agency_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => agencies.id, { onDelete: "restrict" }),
    /** Service desservi par la file (FK RESTRICT). */
    serviceId: uuid("service_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => services.id, { onDelete: "restrict" }),
    /**
     * Compteur du dernier numéro émis. Incrémenté par l'API via
     * `UPDATE queues SET current_ticket_number = current_ticket_number + 1
     *  WHERE id = $1 RETURNING current_ticket_number` (lock-then-increment).
     */
    currentTicketNumber: integer("current_ticket_number").notNull().default(0),
    /** File ouverte aux nouvelles émissions. */
    isOpen: boolean("is_open").notNull().default(true),
    /** Statut de la file (LA LOI `QueueStatus`). */
    status: queueStatusEnum("status").notNull().default("OPEN"),
    /**
     * Heure d'ouverture de la file au format `HH:MM` (heure locale).
     * NULL = pas d'horaire défini. Contrat OpenAPI : `openAt`
     * (pattern `^[0-2][0-9]:[0-5][0-9]$`, ex. `08:00`).
     */
    openAt: text("open_at"),
    /**
     * Heure de fermeture de la file au format `HH:MM` (heure locale).
     * NULL = pas d'horaire défini. Contrat OpenAPI : `closeAt`
     * (pattern `^[0-2][0-9]:[0-5][0-9]$`, ex. `17:00`).
     */
    closeAt: text("close_at"),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("queues_bank_id_agency_id_idx").on(table.bankId, table.agencyId),
    check(
      "queues_current_ticket_number_non_negative",
      sql`${table.currentTicketNumber} >= 0`
    ),
  ]
);
