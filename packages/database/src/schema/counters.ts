import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { banks } from "./banks.js";
import { agencies } from "./agencies.js";
import { services } from "./services.js";
import { users } from "./users.js";
import { counterStatusEnum } from "./enums.js";

/**
 * `counters` — guichet physique d'une agence (LA LOI `Counter`).
 *
 * - `status` enum, `agent_id?` affecté, `current_ticket_id?` en cours.
 * - `current_ticket_id` est un uuid nu (pas de FK Drizzle) pour éviter la
 *   dépendance circulaire counters↔tickets ; l'intégrité applicative est
 *   assurée par l'API (le ticket porte déjà `counter_id`).
 * - `bank_id` NOT NULL, index bank_id-first.
 */
export const counters = pgTable(
  "counters",
  {
    /** Identifiant unique du guichet. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Agence propriétaire (FK RESTRICT). */
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "restrict" }),
    /** Numéro du guichet. */
    number: integer("number").notNull(),
    /** Libellé affiché. */
    label: text("label").notNull(),
    /** Statut du guichet (LA LOI `CounterStatus`). */
    status: counterStatusEnum("status").notNull().default("CLOSED"),
    /** Agent affecté (FK RESTRICT, optionnel). */
    agentId: uuid("agent_id").references(() => users.id, { onDelete: "restrict" }),
    /** Ticket en cours de traitement (uuid nu — voir note d'entête). */
    currentTicketId: uuid("current_ticket_id"),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("counters_bank_id_agency_id_idx").on(table.bankId, table.agencyId),
    unique("counters_agency_id_number_key").on(table.agencyId, table.number),
  ]
);

/**
 * `counter_services` — services couverts par un guichet (n-n, unique).
 * Support du routage API-004. `bank_id` NOT NULL, index bank_id-first.
 */
export const counterServices = pgTable(
  "counter_services",
  {
    /** Identifiant unique du lien. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Guichet (FK RESTRICT). */
    counterId: uuid("counter_id")
      .notNull()
      .references(() => counters.id, { onDelete: "restrict" }),
    /** Service couvert (FK RESTRICT). */
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("counter_services_bank_id_counter_id_idx").on(table.bankId, table.counterId),
    unique("counter_services_counter_id_service_id_key").on(table.counterId, table.serviceId),
  ]
);
