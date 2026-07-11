import {
  pgTable,
  uuid,
  text,
  boolean,
  jsonb,
  date,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { banks } from "./banks.js";

/** Plage horaire d'un jour (aligné `DaySchedule` de LA LOI : HH:MM). */
export interface DaySchedule {
  /** Heure de début (HH:MM). */
  start: string;
  /** Heure de fin (HH:MM). */
  end: string;
}

/**
 * Horaire hebdomadaire d'une agence (7 jours optionnels).
 * Les fermetures exceptionnelles (`agency_exceptional_closures`) n'écrasent JAMAIS
 * cet hebdomadaire — elles s'y ajoutent.
 */
export type WeeklySchedule = Partial<Record<
  "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday",
  DaySchedule
>>;

/**
 * `agencies` — agence physique d'une banque.
 *
 * - `bank_id` NOT NULL (tenant), index bank_id-first.
 * - `timezone` défaut `Africa/Abidjan` (calcul de `issued_day` local des tickets).
 * - `weekly_schedule` jsonb (7 jours), `is_template` pour cloner une config type.
 */
export const agencies = pgTable(
  "agencies",
  {
    /** Identifiant unique de l'agence. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Nom de l'agence. */
    name: text("name").notNull(),
    /** Ville. */
    city: text("city"),
    /** Adresse postale. */
    address: text("address"),
    /** Téléphone de contact. */
    phone: text("phone"),
    /** Fuseau horaire IANA (défaut Africa/Abidjan). */
    timezone: text("timezone").notNull().default("Africa/Abidjan"),
    /** Horaire hebdomadaire (7 jours {start,end}). */
    weeklySchedule: jsonb("weekly_schedule").$type<WeeklySchedule>().notNull().default({}),
    /** Agence modèle réutilisable pour clonage. */
    isTemplate: boolean("is_template").notNull().default(false),
    /** Agence active. */
    isActive: boolean("is_active").notNull().default(true),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Suppression logique (entité auditable). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("agencies_bank_id_idx").on(table.bankId)]
);

/**
 * `agency_exceptional_closures` — fermetures ponctuelles d'une agence
 * (jour férié local, événement). N'écrase jamais `agencies.weekly_schedule`.
 */
export const agencyExceptionalClosures = pgTable(
  "agency_exceptional_closures",
  {
    /** Identifiant unique de la fermeture. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Agence concernée (FK RESTRICT). */
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "restrict" }),
    /** Date de fermeture (jour local). */
    date: date("date").notNull(),
    /** Motif de la fermeture. */
    reason: text("reason"),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agency_exceptional_closures_bank_id_agency_id_date_idx").on(
      table.bankId,
      table.agencyId,
      table.date
    ),
  ]
);
