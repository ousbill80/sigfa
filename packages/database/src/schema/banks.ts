import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  check,
} from "drizzle-orm/pg-core";

/**
 * Thème d'habillage d'une banque, aligné `BankTheme` de LA LOI.
 * Colonne `theme` jsonb UNIQUE (pas de colonne `colors` séparée) : `requestedColors`,
 * `appliedColors`, `welcomeMessages`, `logoUrl`. Le theming est de l'habillage,
 * jamais de la structure (CLAUDE.md §8).
 */
export interface BankTheme {
  /** Couleurs demandées par la banque (avant contrôle contraste). */
  requestedColors?: Record<string, string>;
  /** Couleurs effectivement appliquées (après conformité contraste ≥7:1). */
  appliedColors?: Record<string, string>;
  /** Messages d'accueil localisés (FR/EN). */
  welcomeMessages?: Record<string, string>;
  /** URL du logo de la banque. */
  logoUrl?: string;
}

/**
 * `banks` — tenant racine SIGFA (une banque = un locataire).
 *
 * - `slug` unique (sous-domaine / login futur multi-banque).
 * - `theme` jsonb unique aligné `BankTheme` de LA LOI.
 * - Seuils opérationnels bornés par CHECK (défenses en base, jamais dépendre de l'app) :
 *   `queue_critical_threshold` 1..500, `agent_inactivity_minutes` 1..60,
 *   `no_show_timeout_minutes` 1..30.
 *
 * Table racine du tenant : ne porte pas `bank_id` (elle EST la banque).
 */
export const banks = pgTable(
  "banks",
  {
    /** Identifiant unique de la banque. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Raison sociale. */
    name: text("name").notNull(),
    /** Slug unique (kebab-case) — sous-domaine / résolution du tenant. */
    slug: text("slug").notNull().unique(),
    /** Thème d'habillage (BankTheme de LA LOI). */
    theme: jsonb("theme").$type<BankTheme>().notNull().default({}),
    /** Seuil de file critique (nb tickets en attente) — borné 1..500. */
    queueCriticalThreshold: integer("queue_critical_threshold").notNull().default(50),
    /** Délai d'inactivité agent avant alerte (minutes) — borné 1..60. */
    agentInactivityMinutes: integer("agent_inactivity_minutes").notNull().default(15),
    /** Délai de non-présentation avant NO_SHOW (minutes) — borné 1..30. */
    noShowTimeoutMinutes: integer("no_show_timeout_minutes").notNull().default(3),
    /** Banque active (soft disable). */
    isActive: boolean("is_active").notNull().default(true),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Suppression logique (entité auditable). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "banks_queue_critical_threshold_bounds",
      sql`${table.queueCriticalThreshold} >= 1 AND ${table.queueCriticalThreshold} <= 500`
    ),
    check(
      "banks_agent_inactivity_minutes_bounds",
      sql`${table.agentInactivityMinutes} >= 1 AND ${table.agentInactivityMinutes} <= 60`
    ),
    check(
      "banks_no_show_timeout_minutes_bounds",
      sql`${table.noShowTimeoutMinutes} >= 1 AND ${table.noShowTimeoutMinutes} <= 30`
    ),
  ]
);
