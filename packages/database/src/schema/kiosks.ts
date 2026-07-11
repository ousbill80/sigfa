import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { banks } from "./banks.js";
import { agencies } from "./agencies.js";
import { printerStatusEnum } from "./enums.js";

/**
 * `kiosks` — borne d'émission de tickets d'une agence.
 *
 * - `credentials_hash` bcrypt cost 12 (authentification borne).
 * - `printer_status` enum (LA LOI `PrinterStatus`), `app_version`, `last_seen`.
 * - Session : `current_session_id?`, `session_expires_at?`, `session_revoked_at?`
 *   (révocation AUDITÉE en base ; le token vit en Redis).
 * - `bank_id` NOT NULL, index bank_id-first.
 */
export const kiosks = pgTable(
  "kiosks",
  {
    /** Identifiant unique de la borne. */
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
    /** Libellé de la borne. */
    label: text("label").notNull(),
    /** Empreinte bcrypt (cost 12) des identifiants de la borne. */
    credentialsHash: text("credentials_hash").notNull(),
    /** Dernier contact (heartbeat). */
    lastSeen: timestamp("last_seen", { withTimezone: true }),
    /** Statut de l'imprimante (LA LOI `PrinterStatus`). */
    printerStatus: printerStatusEnum("printer_status").notNull().default("OFFLINE"),
    /** Version applicative de la borne. */
    appVersion: text("app_version"),
    /** Session courante (token en Redis ; référence auditée ici). */
    currentSessionId: uuid("current_session_id"),
    /** Expiration de la session courante. */
    sessionExpiresAt: timestamp("session_expires_at", { withTimezone: true }),
    /** Révocation auditée de la session. */
    sessionRevokedAt: timestamp("session_revoked_at", { withTimezone: true }),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("kiosks_bank_id_agency_id_idx").on(table.bankId, table.agencyId)]
);
