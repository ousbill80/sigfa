/**
 * DB-009 — Schéma Drizzle `public_holidays` (source de vérité unique).
 *
 * Aligné sur la migration `0002_public_holidays.sql`.
 * Table hors-tenant : pas de `bank_id`. Référentiel national des jours fériés
 * ivoiriens, géré par la plateforme (GRANT SELECT only pour sigfa_app).
 *
 * ## Mise à jour annuelle
 * Les fêtes mobiles islamiques (`is_approximate = true`) doivent être mises à jour
 * chaque année. Voir `src/seed/public-holidays-sources.md` pour le processus.
 *
 * @module
 */
import { pgTable, uuid, date, text, boolean, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * `public_holidays` — Référentiel national des jours fériés ivoiriens.
 *
 * - Hors tenant (pas de `bank_id`) : référentiel national.
 * - `is_approximate = true` pour les fêtes islamiques (croissant de lune).
 * - Contrainte UNIQUE sur (`date`, `name`) pour idempotence du seed.
 * - GRANT SELECT uniquement pour `sigfa_app` (REVOKE INSERT/UPDATE/DELETE).
 */
export const publicHolidays = pgTable(
  "public_holidays",
  {
    /** Identifiant unique du jour férié. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Date du jour férié (format ISO 8601 `YYYY-MM-DD`). */
    date: date("date").notNull(),
    /** Nom officiel du jour férié. */
    name: text("name").notNull(),
    /**
     * Description optionnelle (source, notes calendrier, etc.).
     * `null` pour les fêtes fixes sans note particulière.
     */
    description: text("description"),
    /**
     * `true` pour les fêtes mobiles islamiques dont la date exacte dépend du
     * croissant de lune (Korité, Tabaski, Maouloud).
     * `false` pour les fêtes fixes (Noël, Fête Nationale, etc.).
     */
    isApproximate: boolean("is_approximate").notNull().default(false),
    /** Horodatage d'insertion (UTC). */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("public_holidays_date_name_key").on(table.date, table.name),
  ]
);
