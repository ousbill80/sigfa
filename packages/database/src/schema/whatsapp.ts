import { pgTable, uuid, text, boolean, timestamp, index, unique } from "drizzle-orm/pg-core";
import { banks } from "./banks.js";
import { agencies } from "./agencies.js";
import { services } from "./services.js";

// ─────────────────────────────────────────────────────────────────────────────
// DB-NOTIF (migration 0012) — WhatsApp Business par banque (F6 / NOTIF-002/003)
//
// Schéma RÉEL des éléments exercés par les DDL de harnais des tests API NOTIF
// (apps/api/src/services/whatsapp/*). Le schéma Drizzle est la vérité du modèle
// (conforme CONTRACT-013 déjà mergé). Toutes les tables portent `bank_id`,
// RLS FORCE + policy `tenant_isolation(bank_id)` + GRANT `sigfa_app` (migration 0012).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `whatsapp_config` — configuration WhatsApp Business d'une banque (DB-NOTIF, C4).
 *
 * Une seule config par banque : `bank_id` est la CLÉ PRIMAIRE (donc unique et NOT NULL).
 * Routage tenant du webhook entrant par `banks.slug` → cette config (secret, agence
 * par défaut, mapping menu). Colonnes lues par l'API :
 *   `bank_id`, `business_number`, `webhook_secret`, `default_agency_id`
 * (`apps/api/src/routes/webhooks-whatsapp-inbound.ts#resolveWhatsAppConfig`).
 *
 * `webhook_secret` : secret HMAC-SHA256 propre à la banque, servant à vérifier la
 * signature `x-hub-signature-256` des webhooks entrants. Stocké tel quel (référence
 * de secret) — jamais journalisé.
 *
 * RLS : policy `tenant_isolation` (bank_id = app.current_bank_id).
 */
export const whatsappConfig = pgTable(
  "whatsapp_config",
  {
    /**
     * Tenant — banque propriétaire. CLÉ PRIMAIRE (une seule config par banque).
     * FK RESTRICT vers `banks`.
     */
    bankId: uuid("bank_id")
      .primaryKey()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Numéro WhatsApp Business affiché de la banque (E.164, nullable tant que non configuré). */
    businessNumber: text("business_number"),
    /**
     * Secret HMAC-SHA256 du webhook entrant (propre à la banque).
     * Nullable tant que la config n'est pas finalisée — l'API refuse alors le routage.
     */
    webhookSecret: text("webhook_secret"),
    /**
     * Agence par défaut pour les tickets créés par message WhatsApp entrant.
     * Nullable — si NULL, l'API émet une erreur OPAQUE (aucun ticket créé).
     * FK RESTRICT vers `agencies`.
     */
    defaultAgencyId: uuid("default_agency_id")
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => agencies.id, { onDelete: "restrict" }),
    /** Intégration WhatsApp activée pour la banque (soft disable). */
    enabled: boolean("enabled").notNull().default(false),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** Index bank_id-first (convention F2) — bank_id est PK, index explicite pour cohérence RLS. */
    index("whatsapp_config_bank_id_idx").on(table.bankId),
  ]
);

/**
 * `whatsapp_menu_mapping` — mapping menu (mot-clé → service) par banque (DB-NOTIF, C4).
 *
 * Une ligne par (banque, mot-clé). L'API sélectionne
 * `SELECT keyword, service_id FROM whatsapp_menu_mapping WHERE bank_id = $1`
 * pour router un message entrant vers le bon service (NLU règles).
 *
 * Table séparée (et non colonne JSONB) : cohérent avec l'existant SIGFA (relations
 * FK explicites vers `services`, unicité en base, index bank_id-first), et exactement
 * la forme attendue par le harnais API (`whatsapp.integration.test.ts`).
 *
 * RLS : policy `tenant_isolation` (bank_id = app.current_bank_id).
 */
export const whatsappMenuMapping = pgTable(
  "whatsapp_menu_mapping",
  {
    /** Identifiant unique de l'entrée de mapping. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Mot-clé entrant (ex. « 1 », « depot ») déclenchant la sélection du service. */
    keyword: text("keyword").notNull(),
    /** Service SIGFA cible du mot-clé (FK RESTRICT). */
    serviceId: uuid("service_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => services.id, { onDelete: "restrict" }),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** Index bank_id-first pour les requêtes par banque (convention F2). */
    index("whatsapp_menu_mapping_bank_id_idx").on(table.bankId),
    /** Unicité : un mot-clé mappe au plus un service par banque. */
    unique("whatsapp_menu_mapping_bank_id_keyword_key").on(table.bankId, table.keyword),
  ]
);

/**
 * `whatsapp_inbound_messages` — idempotence des messages WhatsApp entrants (DB-NOTIF, NOTIF-003).
 *
 * Chaque `provider_message_id` reçu est « réclamé » une seule fois par banque
 * (`INSERT ... ON CONFLICT (bank_id, provider_message_id) DO NOTHING`) : garantit
 * un traitement unique même en redélivrance Meta ou concurrence.
 *
 * RLS : policy `tenant_isolation` (bank_id = app.current_bank_id).
 */
export const whatsappInboundMessages = pgTable(
  "whatsapp_inbound_messages",
  {
    /** Identifiant unique. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Identifiant du message chez le fournisseur (clé d'idempotence par banque). */
    providerMessageId: text("provider_message_id").notNull(),
    /** Horodatage de première réception (= réclamation). */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** Index bank_id-first pour les requêtes par banque (convention F2). */
    index("whatsapp_inbound_messages_bank_id_idx").on(table.bankId),
    /** Unicité : un message fournisseur n'est traité qu'une fois par banque. */
    unique("whatsapp_inbound_messages_bank_id_provider_message_id_key").on(
      table.bankId,
      table.providerMessageId
    ),
  ]
);
