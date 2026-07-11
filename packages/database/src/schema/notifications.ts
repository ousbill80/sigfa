import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { banks } from "./banks.js";

// ─────────────────────────────────────────────────────────────────────────────
// Enums DB-005 (alignés LA LOI — notifications.yaml)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canaux de livraison des notifications SIGFA (LA LOI `NotificationChannel`, 4 valeurs).
 * SOURCE : packages/contracts/generated/bundled/notifications.yaml#NotificationChannel
 */
export const notificationChannelEnum = pgEnum("notification_channel", [
  "SMS",
  "WHATSAPP",
  "EMAIL",
  "PUSH",
]);

/**
 * Types de messages du parcours client SIGFA (LA LOI `NotificationType`, 4 valeurs).
 * SOURCE : packages/contracts/generated/bundled/notifications.yaml#NotificationType
 */
export const notificationTypeEnum = pgEnum("notification_type", [
  "TICKET_CONFIRMATION",
  "POSITION_UPDATE",
  "YOUR_TURN",
  "DAILY_REPORT",
]);

/**
 * Statut de livraison d'une notification (LA LOI `NotificationStatus`, 4 valeurs).
 * SOURCE : packages/contracts/generated/bundled/notifications.yaml#NotificationStatus
 */
export const notificationStatusEnum = pgEnum("notification_status", [
  "QUEUED",
  "SENT",
  "DELIVERED",
  "FAILED",
]);

/**
 * Raison d'échec d'une notification (LA LOI `NotificationFailureReason`, 6 valeurs).
 * SOURCE : packages/contracts/generated/bundled/notifications.yaml#NotificationFailureReason
 * `failure_reason` est un ENUM de LA LOI — jamais une chaîne libre (DB-005).
 */
export const notificationFailureReasonEnum = pgEnum("notification_failure_reason", [
  "PROVIDER_UNREACHABLE",
  "INVALID_NUMBER",
  "OPT_OUT",
  "TEMPLATE_REJECTED",
  "QUOTA_EXCEEDED",
  "UNKNOWN",
]);

/**
 * Plateforme du device push (LA LOI `PushPlatform`, 3 valeurs).
 * SOURCE : packages/contracts/generated/bundled/notifications.yaml#PushPlatform
 */
export const pushPlatformEnum = pgEnum("push_platform", ["IOS", "ANDROID", "EXPO"]);

// ─────────────────────────────────────────────────────────────────────────────
// Table 1 : notification_templates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `notification_templates` — templates de notification par banque (DB-005).
 *
 * - Unicité sur `(bank_id, type, channel, lang)` : une banque a un seul template
 *   par type/canal/langue.
 * - Variables autorisées (`{{number}}`, `{{position}}`, `{{estimate}}`) validées
 *   côté API (CONTRACT-005) ; la base stocke le body sans validation.
 * - `lang` : sous-ensemble des langues supportées (FR/DIOULA/BAOULE/EN — aligné
 *   `AgentLanguage` de LA LOI mais utilisé ici comme code de template).
 *
 * ## Décision d'audit (DB-005)
 * `notification_templates` est incluse dans `AUDITED_TABLES` car c'est une entité
 * de configuration bancaire (modifiable par BANK_ADMIN) dont les mutations doivent
 * être tracées pour conformité.
 *
 * RLS : policy `tenant_isolation` (bank_id = app.current_bank_id).
 */
export const notificationTemplates = pgTable(
  "notification_templates",
  {
    /** Identifiant unique du template. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /** Type de notification (LA LOI `NotificationType`). */
    type: notificationTypeEnum("type").notNull(),
    /** Canal de livraison (LA LOI `NotificationChannel`). */
    channel: notificationChannelEnum("channel").notNull(),
    /** Langue du template (FR/DIOULA/BAOULE/EN). */
    lang: text("lang").notNull(),
    /**
     * Corps du template.
     * Variables autorisées : `{{number}}`, `{{position}}`, `{{estimate}}`.
     * Validation côté API (CONTRACT-005).
     */
    body: text("body").notNull(),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** Index bank_id-first pour les requêtes par banque (convention F2). */
    index("notification_templates_bank_id_idx").on(table.bankId),
    /**
     * Unicité : une banque a au plus un template par (type, canal, langue).
     * Critère DB-005 : `(bank_id, type, channel, lang)`.
     */
    unique("notification_templates_bank_id_type_channel_lang_key").on(
      table.bankId,
      table.type,
      table.channel,
      table.lang
    ),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 2 : notification_consents
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `notification_consents` — opt-in/opt-out UEMOA par téléphone et canal (DB-005).
 *
 * - **Aucun numéro de téléphone en clair** : `phone_encrypted` (opaque DB-008,
 *   format `v1:iv:tag:ct`) + `phone_hash` (HMAC-SHA256, colonne de recherche).
 * - Unicité sur `(bank_id, phone_hash, channel)` — un abonné a un seul consentement
 *   par canal et par banque.
 * - `phone_encrypted` est de type `text` DÉFINITIF (format DB-008, aucune ALTER ultérieure).
 * - `opted_at` : date d'opt-in ; `revoked_at` : date d'opt-out (null si actif).
 *
 * ## Décision d'audit (DB-005)
 * `notification_consents` est EXCLUE des triggers d'audit car :
 * - La table ne porte pas de FK vers `users` (contexte acteur non résolvable) ;
 * - Les données sont pseudonymisées (phone_hash) — un diff d'audit n'apporterait
 *   pas de valeur traçable supplémentaire.
 *
 * RLS : policy `tenant_isolation` (bank_id = app.current_bank_id).
 */
export const notificationConsents = pgTable(
  "notification_consents",
  {
    /** Identifiant unique du consentement. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /**
     * Numéro de téléphone chiffré au repos (DB-008).
     * Type `text` DÉFINITIF — format `v1:iv:tag:ct`.
     * JAMAIS indexé, JAMAIS exposé directement.
     */
    phoneEncrypted: text("phone_encrypted").notNull(),
    /**
     * Empreinte déterministe HMAC-SHA256 du numéro (colonne de recherche).
     * Fournie par DB-008. Indexée implicitement via la contrainte d'unicité.
     * JAMAIS le numéro en clair.
     */
    phoneHash: text("phone_hash").notNull(),
    /** Canal de notification concerné (LA LOI `NotificationChannel`). */
    channel: notificationChannelEnum("channel").notNull(),
    /** `true` = opt-in actif, `false` = opt-out. */
    optedIn: boolean("opted_in").notNull().default(false),
    /** Horodatage d'opt-in (null si jamais opté). */
    optedAt: timestamp("opted_at", { withTimezone: true }),
    /** Horodatage d'opt-out (null si opt-in actif ou jamais opté). */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Horodatage de création. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de dernière mise à jour. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** Index bank_id-first pour les requêtes par banque (convention F2). */
    index("notification_consents_bank_id_idx").on(table.bankId),
    /**
     * Unicité : un abonné a au plus un consentement par (banque, canal).
     * `phone_hash` est la clé de recherche (jamais le numéro en clair).
     */
    unique("notification_consents_bank_id_phone_hash_channel_key").on(
      table.bankId,
      table.phoneHash,
      table.channel
    ),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 3 : notification_log
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `notification_log` — journal d'envoi des notifications (DB-005).
 *
 * - Append-only en pratique (les envois ne se corrigent pas, on insère un nouvel
 *   événement).
 * - `phone_hash` uniquement (jamais `phone_encrypted` ni masquage stocké) —
 *   le masquage `phoneNumberMasked` est calculé par l'API (CONTRACT-007).
 * - `failure_reason` est l'enum `NotificationFailureReason` de LA LOI.
 * - Index composites : `(bank_id, ticket_id)` et `(bank_id, status, created_at)`.
 *
 * ## Décision d'audit (DB-005)
 * `notification_log` est EXCLUE des triggers d'audit car :
 * - C'est elle-même un journal — auditer un journal crée une boucle et une double
 *   comptabilité inutile ;
 * - Sa fréquence d'écriture (un envoi par notification) est incompatible avec un
 *   trigger synchrone d'audit.
 *
 * RLS : policy `tenant_isolation` (bank_id = app.current_bank_id).
 */
export const notificationLog = pgTable(
  "notification_log",
  {
    /** Identifiant unique de l'entrée de log. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /**
     * Ticket associé à la notification (optionnel — certaines notifications
     * sont admin sans ticket).
     * FK sans RESTRICT (le log survit à la suppression d'un ticket).
     */
    ticketId: uuid("ticket_id"),
    /** Type de notification envoyée (LA LOI `NotificationType`). */
    type: notificationTypeEnum("type").notNull(),
    /** Canal de livraison (LA LOI `NotificationChannel`). */
    channel: notificationChannelEnum("channel").notNull(),
    /**
     * Empreinte du téléphone destinataire — présent pour SMS/WHATSAPP.
     * Null pour EMAIL et PUSH (pas de numéro de téléphone).
     * JAMAIS le numéro en clair ni une forme masquée.
     */
    phoneHash: text("phone_hash"),
    /**
     * Identifiant du device push (référence à notification_devices.id).
     * Présent pour le canal PUSH uniquement.
     */
    deviceId: uuid("device_id"),
    /** Statut de livraison (LA LOI `NotificationStatus`). */
    status: notificationStatusEnum("status").notNull().default("QUEUED"),
    /**
     * Raison d'échec — enum `NotificationFailureReason` de LA LOI.
     * Non null uniquement si `status = 'FAILED'`.
     */
    failureReason: notificationFailureReasonEnum("failure_reason"),
    /** Identifiant du message chez le fournisseur (référence externe). */
    providerMessageId: text("provider_message_id"),
    /** Horodatage de création de l'entrée (= mise en file BullMQ). */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage d'envoi au fournisseur (status → SENT). */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Horodatage de livraison finale (status → DELIVERED). */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    /**
     * Index (bank_id, ticket_id) — lookup du log par ticket (API /notifications/log?ticketId=).
     * Critère DB-005.
     */
    index("notification_log_bank_id_ticket_id_idx").on(table.bankId, table.ticketId),
    /**
     * Index (bank_id, status, created_at) — filtrage par statut + pagination chronologique.
     * Critère DB-005.
     */
    index("notification_log_bank_id_status_created_at_idx").on(
      table.bankId,
      table.status,
      table.createdAt
    ),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 4 : notification_devices
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `notification_devices` — registre des devices push enregistrés (DB-005).
 *
 * - `device_token` est GLOBALEMENT UNIQUE (un token ne peut être enregistré que
 *   par une seule banque — si un utilisateur change de banque, son token est
 *   transféré).
 * - Ré-enregistrement idempotent : `ON CONFLICT (device_token) DO UPDATE`
 *   (upsert sans créer de doublon — CONTRACT-007).
 * - `phone_hash` (optionnel) : lien vers l'abonné, pour les push ciblés.
 *   Jamais `phone_encrypted` dans cette table (device_token suffit pour le push).
 * - `revoked_at` : device révoqué (ex. désinstallation).
 *
 * ## Décision d'audit (DB-005)
 * `notification_devices` est EXCLUE des triggers d'audit car :
 * - La fréquence d'upsert est élevée (ré-enregistrement à chaque ouverture d'app) ;
 * - Un trigger d'audit de masse serait trop bruité pour être utile à la conformité.
 *
 * RLS : policy `tenant_isolation` (bank_id = app.current_bank_id).
 */
export const notificationDevices = pgTable(
  "notification_devices",
  {
    /** Identifiant unique du device. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /**
     * Token push fourni par APNs (iOS), FCM (Android) ou Expo.
     * GLOBALEMENT UNIQUE — un token ne peut appartenir qu'à une banque.
     * Ré-enregistrement idempotent via ON CONFLICT (device_token) DO UPDATE.
     */
    deviceToken: text("device_token").notNull().unique(),
    /** Plateforme du device (LA LOI `PushPlatform` : IOS/ANDROID/EXPO). */
    platform: pushPlatformEnum("platform").notNull(),
    /**
     * Empreinte du téléphone associé (optionnel, pour push ciblé).
     * JAMAIS de `phone_encrypted` dans cette table.
     */
    phoneHash: text("phone_hash"),
    /** Horodatage de dernière activité du device. */
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    /** Horodatage de révocation (null si device actif). */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Horodatage de premier enregistrement. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** Index bank_id-first pour les requêtes par banque (convention F2). */
    index("notification_devices_bank_id_idx").on(table.bankId),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Table 5 : notification_test_recipients
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `notification_test_recipients` — liste blanche des destinataires de test (DB-005).
 *
 * Support du 422 `TEST_RECIPIENT_NOT_ALLOWED` de LA LOI (CONTRACT-007) :
 * avant d'envoyer une notification de test, l'API vérifie que le `phone_hash`
 * du destinataire est présent dans cette liste pour la banque concernée.
 *
 * - Unicité sur `(bank_id, phone_hash)` : un numéro ne peut être dans la liste
 *   de test d'une banque qu'une seule fois.
 * - `phone_encrypted` + `phone_hash` — aucun numéro en clair.
 * - `added_by` : UUID de l'utilisateur BANK_ADMIN ayant ajouté le destinataire.
 *
 * ## Décision d'audit (DB-005)
 * `notification_test_recipients` est EXCLUE des triggers d'audit car :
 * - Volume très faible (liste interne BANK_ADMIN) ;
 * - Les mutations sont initiées par des acteurs authentifiés (BANK_ADMIN) dont
 *   les actions sont déjà tracées via les routes API (audit applicatif SEC-001) ;
 * - La table ne porte pas de FK vers `users` pour `added_by`, rendant la
 *   résolution du contexte acteur non triviale en trigger.
 *
 * RLS : policy `tenant_isolation` (bank_id = app.current_bank_id).
 */
export const notificationTestRecipients = pgTable(
  "notification_test_recipients",
  {
    /** Identifiant unique. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant — banque propriétaire (FK RESTRICT). */
    bankId: uuid("bank_id")
      .notNull()
      /* v8 ignore next — callback de résolution lazy FK Drizzle (pure DSL, non instrumentable) */
      .references(() => banks.id, { onDelete: "restrict" }),
    /**
     * Empreinte du numéro destinataire (colonne de lookup).
     * Fourni par DB-008. JAMAIS le numéro en clair.
     */
    phoneHash: text("phone_hash").notNull(),
    /**
     * Numéro chiffré au repos (DB-008, format `v1:iv:tag:ct`).
     * Type `text` DÉFINITIF — aucune ALTER ultérieure.
     */
    phoneEncrypted: text("phone_encrypted").notNull(),
    /** UUID de l'utilisateur BANK_ADMIN ayant ajouté ce destinataire. */
    addedBy: uuid("added_by").notNull(),
    /** Horodatage d'ajout. */
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** Index bank_id-first pour les requêtes par banque (convention F2). */
    index("notification_test_recipients_bank_id_idx").on(table.bankId),
    /**
     * Unicité : un numéro ne peut figurer qu'une fois dans la liste de test
     * d'une banque donnée.
     */
    unique("notification_test_recipients_bank_id_phone_hash_key").on(
      table.bankId,
      table.phoneHash
    ),
  ]
);
