import {
  pgTable,
  uuid,
  text,
  varchar,
  jsonb,
  timestamp,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { banks } from "./banks.js";
import { roleEnum } from "./enums.js";

/**
 * Type PostgreSQL `inet` (adresse IP) — non fourni nativement par drizzle-orm/pg-core.
 * Stocke l'adresse IPv4/IPv6 de l'acteur d'une entrée d'audit.
 */
const inet = customType<{ data: string; driverData: string }>({
  dataType() {
    return "inet";
  },
});

/**
 * `audit_log` — journal d'audit IMMUABLE de la plateforme (DB-004).
 *
 * Immuabilité au niveau base : UPDATE et DELETE sont IMPOSSIBLES, même pour le rôle
 * applicatif (triggers `BEFORE UPDATE/DELETE ... RAISE EXCEPTION` + REVOKE) —
 * la table n'accepte que des INSERT (append-only).
 *
 * Deux sources d'écriture :
 *  - Triggers d'audit en base sur les tables sensibles (banks, agencies, services,
 *    counters, users, kiosks) — INSERT/UPDATE/DELETE journalisés automatiquement.
 *  - Écriture applicative via `insertAuditEntry()` (SEC-001) — ex. transitions de ticket.
 *
 * `actor_email` est DÉNORMALISÉ (l'acteur peut être supprimé plus tard).
 * `occurred_at` est l'horloge serveur (`DEFAULT now()`, jamais fournie par le client).
 *
 * Mapping DB → API (documenté) :
 *  - `occurred_at`               → `timestamp`
 *  - `actor_id`/`actor_role`/`actor_email` → objet `actor` composé côté API
 *  - `entity_type`/`entity_id`   → objet `entity` composé côté API
 *
 * RLS : lecture scopée `bank_id = current_setting('app.current_bank_id')` (écran Auditor).
 * Index `(bank_id, occurred_at)` et `(bank_id, entity_type, entity_id)`.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    /** Identifiant unique de l'entrée d'audit. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK banks RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Acteur ayant provoqué la mutation (utilisateur), optionnel (job/système). */
    actorId: uuid("actor_id"),
    /** Rôle RBAC de l'acteur au moment de l'action (LA LOI `Role` \ {NONE}). */
    actorRole: roleEnum("actor_role"),
    /** Email de l'acteur — DÉNORMALISÉ (l'acteur peut être supprimé ultérieurement). */
    actorEmail: text("actor_email"),
    /** Action journalisée, libre — style « PATCH /banks/:id/theme ». */
    action: varchar("action", { length: 500 }).notNull(),
    /** Type d'entité affectée (ex. « bank », « ticket »). */
    entityType: text("entity_type").notNull(),
    /** Identifiant de l'entité affectée. */
    entityId: uuid("entity_id"),
    /** Horloge serveur — jamais fournie par le client. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    /** Adresse IP de l'acteur (inet). */
    ip: inet("ip"),
    /** Diff des valeurs (anciennes/nouvelles) — colonnes sensibles exclues par motif. */
    diff: jsonb("diff"),
  },
  (table) => [
    /** Index chronologique par banque (écran Auditor). */
    index("audit_log_bank_id_occurred_at_idx").on(table.bankId, table.occurredAt),
    /** Index de recherche par entité. */
    index("audit_log_bank_id_entity_idx").on(
      table.bankId,
      table.entityType,
      table.entityId
    ),
  ]
);
