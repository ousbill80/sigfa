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
import { services } from "./services.js";

/**
 * `operations` — opération proposée sous un service (LA LOI `Operation`, MODEL-DB-A).
 *
 * Enfant de `services` (modèle à 2 niveaux : Service → Opération). Additif (D1/D3) :
 * les services RESTENT des services ; on ajoute une granularité optionnelle.
 *
 * - `code` varchar(6) `^[A-Z0-9]{2,6}$`, UNIQUE PAR SERVICE (`(service_id, code)`).
 * - `bank_id` + `agency_id` dénormalisés NOT NULL (RLS/scope, comme les tables existantes).
 * - `sla_minutes` NULLABLE : NULL → hérite du SLA du service (D4).
 *   Règle unique : `SLA_résolu = operation.sla_minutes ?? service.sla_minutes`.
 * - AUCUNE colonne `priority` (D4 — la priorité reste l'enum porteur sur le ticket).
 * - `display_order` (aligné `order` du contrat), `is_active`, `icon_key` optionnel (D10).
 * - `bank_id` NOT NULL, index bank_id-first (convention F2).
 */
export const operations = pgTable(
  "operations",
  {
    /** Identifiant unique de l'opération. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT, dénormalisé pour RLS). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Agence propriétaire (FK RESTRICT, dénormalisé pour scope). */
    agencyId: uuid("agency_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => agencies.id, { onDelete: "restrict" }),
    /** Service parent (FK RESTRICT). */
    serviceId: uuid("service_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => services.id, { onDelete: "restrict" }),
    /** Code mnémotechnique 2–6 alphanumériques majuscules, unique par service. */
    code: varchar("code", { length: 6 }).notNull(),
    /** Libellé de l'opération. */
    name: text("name").notNull(),
    /** SLA cible en minutes (≥1). NULL → hérite du service (D4). */
    slaMinutes: integer("sla_minutes"),
    /** Ordre d'affichage (aligné `order`). */
    displayOrder: integer("display_order").notNull().default(0),
    /** Opération active. */
    isActive: boolean("is_active").notNull().default(true),
    /** Clé d'icône optionnelle (mapping composant `ServiceIcon`, D10). */
    iconKey: text("icon_key"),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("operations_bank_id_agency_id_idx").on(table.bankId, table.agencyId),
    index("operations_service_id_idx").on(table.serviceId),
    unique("operations_service_id_code_key").on(table.serviceId, table.code),
    check("operations_code_format", sql`${table.code} ~ '^[A-Z0-9]{2,6}$'`),
    check(
      "operations_sla_minutes_positive",
      sql`${table.slaMinutes} IS NULL OR ${table.slaMinutes} >= 1`
    ),
  ]
);
