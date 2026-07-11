import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { banks } from "./banks.js";
import { agencies } from "./agencies.js";

/**
 * `services` — service proposé par une agence (LA LOI `Service`).
 *
 * - `code` varchar(4) `^[A-Z]{2,4}$`, unique PAR AGENCE (post CONTRACT-011).
 *   Préfixe du `displayNumber` du ticket (ex. `OC-047`).
 * - `display_order` (aligné `order` du contrat — PAS de colonne `priority`).
 * - `bank_id` NOT NULL, index bank_id-first.
 */
export const services = pgTable(
  "services",
  {
    /** Identifiant unique du service. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Agence propriétaire (FK RESTRICT). */
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "restrict" }),
    /** Code mnémotechnique 2–4 lettres majuscules, unique par agence. */
    code: varchar("code", { length: 4 }).notNull(),
    /** Libellé du service. */
    name: text("name").notNull(),
    /** SLA cible en minutes (≥1). */
    slaMinutes: integer("sla_minutes").notNull().default(10),
    /** Ordre d'affichage (aligné `order`). */
    displayOrder: integer("display_order").notNull().default(0),
    /** Service actif. */
    isActive: boolean("is_active").notNull().default(true),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Suppression logique (entité auditable). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("services_bank_id_agency_id_idx").on(table.bankId, table.agencyId),
    unique("services_agency_id_code_key").on(table.agencyId, table.code),
    check("services_code_format", sql`${table.code} ~ '^[A-Z]{2,4}$'`),
    check("services_sla_minutes_positive", sql`${table.slaMinutes} >= 1`),
  ]
);
