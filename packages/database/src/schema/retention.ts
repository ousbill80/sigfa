import { sql } from "drizzle-orm";
import { pgTable, uuid, integer, timestamp, index, unique, check } from "drizzle-orm/pg-core";
import { banks } from "./banks.js";

/**
 * `retention_policies` — politique de rétention des téléphones par banque (DB-008).
 *
 * - `phone_retention_months` : durée en mois avant anonymisation d'un ticket clos ou
 *   d'un consentement révoqué. Défaut 13 (droit à l'oubli UEMOA), borné 1..60 (CHECK).
 * - `bank_id` UNIQUE : une seule politique par banque.
 * - Consommée par `purgeExpiredPhones()` (src/crypto/purge.ts) — anonymisation,
 *   PAS suppression : le ticket agrégé demeure.
 *
 * RLS : policy `tenant_isolation` (bank_id = app.current_bank_id).
 */
export const retentionPolicies = pgTable(
  "retention_policies",
  {
    /** Identifiant unique de la politique. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT), UNIQUE (une politique par banque). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /**
     * Nombre de mois de rétention des téléphones avant anonymisation.
     * Défaut 13 (UEMOA), borné 1..60 par CHECK.
     */
    phoneRetentionMonths: integer("phone_retention_months").notNull().default(13),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** Index bank_id-first (convention F2). */
    index("retention_policies_bank_id_idx").on(table.bankId),
    /** Unicité : une seule politique de rétention par banque. */
    unique("retention_policies_bank_id_key").on(table.bankId),
    /** Borne 1..60 mois (défaut 13). */
    check(
      "retention_policies_months_range",
      sql`${table.phoneRetentionMonths} >= 1 AND ${table.phoneRetentionMonths} <= 60`
    ),
  ]
);
