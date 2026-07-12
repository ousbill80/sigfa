import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { banks } from "./banks.js";
import { agencies } from "./agencies.js";
import { services } from "./services.js";
import { roleEnum, agentLanguageEnum, agentStatusEnum } from "./enums.js";
import type { WeeklySchedule } from "./agencies.js";

/**
 * `users` — compte utilisateur SIGFA (agents, managers, admins).
 *
 * Modèle v5 : chaque utilisateur est rattaché à sa banque via `bank_id` (FK banks RESTRICT).
 * Exception : le SUPER_ADMIN plateforme n'appartient à aucune banque (`bank_id NULL`).
 * Invariant garanti par CHECK : `(role = 'SUPER_ADMIN') = (bank_id IS NULL)`.
 *
 * - `email` UNIQUE **GLOBAL** (login sans ambiguïté de tenant).
 * - `password_hash` bcrypt cost 12 · `languages` enum-array (défaut `{FR}`).
 * - `failed_login_attempts` / `locked_until` : verrouillage API-001 (5 essais → +15 min).
 * - `phone_encrypted` text opaque (format DB-008 `v1:iv:tag:ct`) + `phone_hash`
 *   — types DÉFINITIFS dès création (aucune ALTER ultérieure).
 * - Index `(bank_id, email)` bank_id-first pour les requêtes par banque (RLS DB-002).
 */
export const users = pgTable(
  "users",
  {
    /** Identifiant unique de l'utilisateur. */
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Banque propriétaire — NULL uniquement pour le SUPER_ADMIN plateforme.
     * FK banks RESTRICT · index (bank_id, email) bank_id-first.
     */
    /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
    bankId: uuid("bank_id").references(() => banks.id, { onDelete: "restrict" }),
    /** Email de connexion — UNIQUE GLOBAL. */
    email: text("email").notNull().unique(),
    /** Empreinte bcrypt (cost 12) du mot de passe. */
    passwordHash: text("password_hash").notNull(),
    /** Prénom. */
    firstName: text("first_name").notNull(),
    /** Nom. */
    lastName: text("last_name").notNull(),
    /** Rôle RBAC (LA LOI `Role` \ {NONE}). */
    role: roleEnum("role").notNull(),
    /** Langues parlées (au moins FR par défaut) — données du routage API-004. */
    languages: agentLanguageEnum("languages").array().notNull().default(["FR"]),
    /** Horaire de travail hebdomadaire optionnel. */
    workSchedule: jsonb("work_schedule").$type<WeeklySchedule>(),
    /** Compteur d'échecs de connexion consécutifs (API-001). */
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    /** Verrouillage temporaire du compte (API-001 : +15 min après 5 échecs). */
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    /** Téléphone chiffré au repos (format DB-008 `v1:iv:tag:ct`) — type DÉFINITIF. */
    phoneEncrypted: text("phone_encrypted"),
    /** Empreinte déterministe du téléphone (recherche sans déchiffrer) — type DÉFINITIF. */
    phoneHash: text("phone_hash"),
    /** Compte actif. */
    isActive: boolean("is_active").notNull().default(true),
    /**
     * Conseiller « relationship manager » (MODEL-DB-B, D5).
     * Additif NOT NULL default false — un conseiller apparaît dans la liste
     * publique nominative `GET /public/agencies/{id}/relationship-managers`
     * (filtre `is_relationship_manager AND is_active AND deleted_at IS NULL`).
     * AUCUN lien client↔conseiller attitré (respecte le hors-scope CRM, CLAUDE.md §5).
     */
    isRelationshipManager: boolean("is_relationship_manager").notNull().default(false),
    /**
     * Nom d'affichage public du conseiller (liste publique — zéro PII).
     * NULLABLE : renseigné pour les conseillers ; NULL sinon.
     */
    displayName: text("display_name"),
    /**
     * URL de la photo publique du conseiller (optionnelle).
     * NULLABLE : la photo est facultative dans la liste publique.
     */
    photoUrl: text("photo_url"),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Suppression logique (entité auditable). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    /** Index (bank_id, email) bank_id-first — optimise les requêtes RLS par banque. */
    index("users_bank_id_email_idx").on(table.bankId, table.email),
    /** Email reste indexé séparément pour la connexion globale. */
    index("users_email_idx").on(table.email),
    /**
     * Invariant SUPER_ADMIN ↔ bank_id IS NULL :
     * seul le SUPER_ADMIN plateforme peut avoir bank_id NULL ;
     * tout autre rôle doit impérativement être rattaché à une banque.
     */
    check(
      "users_super_admin_bank_id_check",
      sql`(${table.role} = 'SUPER_ADMIN') = (${table.bankId} IS NULL)`
    ),
  ]
);

/**
 * `user_services` — compétences agent↔service (n-n, unique).
 * Donnée d'entrée du moteur de routage (API-004). `bank_id` NOT NULL, index bank_id-first.
 */
export const userServices = pgTable(
  "user_services",
  {
    /** Identifiant unique du lien. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Utilisateur (agent) (FK RESTRICT). */
    userId: uuid("user_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => users.id, { onDelete: "restrict" }),
    /** Service traitable (FK RESTRICT). */
    serviceId: uuid("service_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => services.id, { onDelete: "restrict" }),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("user_services_bank_id_user_id_idx").on(table.bankId, table.userId),
    unique("user_services_user_id_service_id_key").on(table.userId, table.serviceId),
  ]
);

/**
 * `agency_users` — affectation agent↔agence (n-n, unique).
 * `bank_id` NOT NULL, index bank_id-first.
 */
export const agencyUsers = pgTable(
  "agency_users",
  {
    /** Identifiant unique du lien. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Agence d'affectation (FK RESTRICT). */
    agencyId: uuid("agency_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => agencies.id, { onDelete: "restrict" }),
    /** Utilisateur affecté (FK RESTRICT). */
    userId: uuid("user_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => users.id, { onDelete: "restrict" }),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agency_users_bank_id_agency_id_idx").on(table.bankId, table.agencyId),
    unique("agency_users_agency_id_user_id_key").on(table.agencyId, table.userId),
  ]
);

/**
 * `agent_status_history` — journal des transitions de statut agent.
 * Source d'`agent_active_seconds` (DB-006) et des patterns d'anomalies (F10).
 * Index `(bank_id, agent_id, changed_at)`.
 */
export const agentStatusHistory = pgTable(
  "agent_status_history",
  {
    /** Identifiant unique de l'entrée. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Agence de contexte (FK RESTRICT). */
    agencyId: uuid("agency_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => agencies.id, { onDelete: "restrict" }),
    /** Agent concerné (FK RESTRICT). */
    agentId: uuid("agent_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => users.id, { onDelete: "restrict" }),
    /** Statut de départ (null au premier passage en ligne). */
    fromStatus: agentStatusEnum("from_status"),
    /** Statut d'arrivée. */
    toStatus: agentStatusEnum("to_status").notNull(),
    /** Horodatage de la transition. */
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agent_status_history_bank_id_agent_id_changed_at_idx").on(
      table.bankId,
      table.agentId,
      table.changedAt
    ),
  ]
);
