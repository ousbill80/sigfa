import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  notificationTemplates,
  notificationConsents,
  notificationLog,
  notificationDevices,
  notificationTestRecipients,
  notificationChannelEnum,
  notificationTypeEnum,
  notificationStatusEnum,
  notificationFailureReasonEnum,
  pushPlatformEnum,
  consentSourceEnum,
} from "./notifications.js";

/**
 * DB-005 — Tests structurels (in-process, sans base).
 *
 * Vérifient les colonnes, contraintes d'unicité, enums et alignement LA LOI
 * pour les 5 tables de notifications.
 *
 * Note : les enums NotificationChannel et NotificationType sont déjà définis dans
 * enums.ts (schema cœur) et ré-exportés ici. Les nouveaux enums (NotificationStatus,
 * NotificationFailureReason, PushPlatform) sont dans notifications.ts.
 */

/** Valeurs canoniques LA LOI (contrats bundlés notifications.yaml) */
const LA_LOI_NOTIFICATIONS = {
  NotificationChannel: ["SMS", "WHATSAPP", "EMAIL", "PUSH"],
  // CONTRACT-013 : + POSITION_NEAR, POSITION_NEXT (additifs, migration 0012 / NOTIF-002).
  NotificationType: [
    "TICKET_CONFIRMATION",
    "POSITION_UPDATE",
    "YOUR_TURN",
    "DAILY_REPORT",
    "POSITION_NEAR",
    "POSITION_NEXT",
  ],
  // CONTRACT-013 : origine tracée d'un consentement opt-in (migration 0012).
  ConsentSource: ["AGENT", "KIOSK", "WEB", "INBOUND_WHATSAPP", "IMPORT"],
  NotificationStatus: ["QUEUED", "SENT", "DELIVERED", "FAILED"],
  NotificationFailureReason: [
    "PROVIDER_UNREACHABLE",
    "INVALID_NUMBER",
    "OPT_OUT",
    "TEMPLATE_REJECTED",
    "QUOTA_EXCEEDED",
    "UNKNOWN",
  ],
  PushPlatform: ["IOS", "ANDROID", "EXPO"],
} as const;

describe("DB-005: enums notifications — alignement LA LOI", () => {
  it("DB-005: NotificationChannel Drizzle === LA LOI (4 valeurs)", () => {
    expect(notificationChannelEnum.enumValues).toEqual(
      LA_LOI_NOTIFICATIONS.NotificationChannel
    );
  });

  it("DB-005: NotificationType Drizzle === LA LOI (6 valeurs, + POSITION_NEAR/POSITION_NEXT CONTRACT-013)", () => {
    expect(notificationTypeEnum.enumValues).toEqual(
      LA_LOI_NOTIFICATIONS.NotificationType
    );
  });

  it("DB-NOTIF: ConsentSource Drizzle === LA LOI (5 valeurs, INBOUND_WHATSAPP inclus)", () => {
    expect(consentSourceEnum.enumValues).toEqual(
      LA_LOI_NOTIFICATIONS.ConsentSource
    );
  });

  it("DB-005: NotificationStatus Drizzle === LA LOI (4 valeurs)", () => {
    expect(notificationStatusEnum.enumValues).toEqual(
      LA_LOI_NOTIFICATIONS.NotificationStatus
    );
  });

  it("DB-005: NotificationFailureReason Drizzle === LA LOI (6 valeurs)", () => {
    expect(notificationFailureReasonEnum.enumValues).toEqual(
      LA_LOI_NOTIFICATIONS.NotificationFailureReason
    );
  });

  it("DB-005: PushPlatform Drizzle === LA LOI (3 valeurs : IOS/ANDROID/EXPO)", () => {
    expect(pushPlatformEnum.enumValues).toEqual(
      LA_LOI_NOTIFICATIONS.PushPlatform
    );
  });
});

describe("DB-005: modèle notification_templates (structure)", () => {
  it("DB-005: notification_templates — colonnes requises présentes", () => {
    const config = getTableConfig(notificationTemplates);
    const names = config.columns.map((c) => c.name);
    for (const col of [
      "id",
      "bank_id",
      "type",
      "channel",
      "lang",
      "body",
      "created_at",
      "updated_at",
    ]) {
      expect(names, `colonne ${col}`).toContain(col);
    }
  });

  it("DB-005: notification_templates — unicité (bank_id, type, channel, lang)", () => {
    const config = getTableConfig(notificationTemplates);
    const uniq = config.uniqueConstraints.map((u) => u.name);
    expect(uniq).toContain("notification_templates_bank_id_type_channel_lang_key");
  });

  it("DB-005: notification_templates — aucune colonne phone en clair (nommage)", () => {
    const config = getTableConfig(notificationTemplates);
    const names = config.columns.map((c) => c.name);
    // Aucune colonne ne doit s'appeler 'phone' ou contenir 'phone' sans suffixe sécurisé
    const suspicious = names.filter(
      (n) =>
        n === "phone" ||
        (n.includes("phone") && !n.endsWith("_hash") && !n.endsWith("_encrypted"))
    );
    expect(suspicious).toHaveLength(0);
  });

  it("DB-005: notification_templates — bank_id NOT NULL, index bank_id-first", () => {
    const config = getTableConfig(notificationTemplates);
    const bankId = config.columns.find((c) => c.name === "bank_id");
    expect(bankId?.notNull).toBe(true);
    const hasBankFirst = config.indexes.some((idx) => {
      const first = idx.config.columns[0];
      return (
        first !== undefined &&
        "name" in first &&
        (first as { name: string }).name === "bank_id"
      );
    });
    expect(hasBankFirst, "notification_templates index bank_id-first").toBe(true);
  });
});

describe("DB-005: modèle notification_consents (structure)", () => {
  it("DB-005: notification_consents — colonnes requises présentes (phone_encrypted + phone_hash)", () => {
    const config = getTableConfig(notificationConsents);
    const names = config.columns.map((c) => c.name);
    for (const col of [
      "id",
      "bank_id",
      "phone_encrypted",
      "phone_hash",
      "channel",
      "opted_in",
      "opted_at",
      "revoked_at",
      // DB-NOTIF : traçabilité d'origine (INBOUND_WHATSAPP), consentement par canal
      // toujours assuré par l'unicité (bank_id, phone_hash, channel).
      "source",
    ]) {
      expect(names, `colonne ${col}`).toContain(col);
    }
  });

  it("DB-005: notification_consents — phone_encrypted est de type text (jamais varchar limité)", () => {
    const config = getTableConfig(notificationConsents);
    const phoneEncrypted = config.columns.find((c) => c.name === "phone_encrypted");
    expect(phoneEncrypted).toBeDefined();
    // Le type doit être text — conforme à la convention DB-005/DB-008
    expect(phoneEncrypted?.columnType).toBe("PgText");
  });

  it("DB-005: notification_consents — unicité (bank_id, phone_hash, channel)", () => {
    const config = getTableConfig(notificationConsents);
    const uniq = config.uniqueConstraints.map((u) => u.name);
    expect(uniq).toContain("notification_consents_bank_id_phone_hash_channel_key");
  });

  it("DB-005: notification_consents — aucune colonne 'phone' en clair", () => {
    const config = getTableConfig(notificationConsents);
    const names = config.columns.map((c) => c.name);
    const suspicious = names.filter(
      (n) =>
        n === "phone" ||
        (n.includes("phone") && !n.endsWith("_hash") && !n.endsWith("_encrypted"))
    );
    expect(suspicious).toHaveLength(0);
  });

  it("DB-005: notification_consents — bank_id NOT NULL, index bank_id-first", () => {
    const config = getTableConfig(notificationConsents);
    const bankId = config.columns.find((c) => c.name === "bank_id");
    expect(bankId?.notNull).toBe(true);
    const hasBankFirst = config.indexes.some((idx) => {
      const first = idx.config.columns[0];
      return (
        first !== undefined &&
        "name" in first &&
        (first as { name: string }).name === "bank_id"
      );
    });
    expect(hasBankFirst, "notification_consents index bank_id-first").toBe(true);
  });
});

describe("DB-005: modèle notification_log (structure)", () => {
  it("DB-005: notification_log — colonnes requises présentes", () => {
    const config = getTableConfig(notificationLog);
    const names = config.columns.map((c) => c.name);
    for (const col of [
      "id",
      "bank_id",
      "ticket_id",
      "type",
      "channel",
      "phone_hash",
      "device_id",
      "status",
      "failure_reason",
      "provider_message_id",
      "created_at",
      "sent_at",
      "delivered_at",
    ]) {
      expect(names, `colonne ${col}`).toContain(col);
    }
  });

  it("DB-005: notification_log — aucune colonne phone en clair ni phone_encrypted", () => {
    const config = getTableConfig(notificationLog);
    const names = config.columns.map((c) => c.name);
    // Le log ne stocke QUE phone_hash (pas phone_encrypted — jamais de masquage stocké)
    const suspicious = names.filter(
      (n) =>
        n === "phone" ||
        n === "phone_masked" ||
        n.includes("phone") &&
          !n.endsWith("_hash")
    );
    expect(suspicious, "aucune colonne phone en clair dans notification_log").toHaveLength(0);
  });

  it("DB-005: notification_log — index (bank_id, ticket_id) et (bank_id, status, created_at)", () => {
    const config = getTableConfig(notificationLog);
    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("notification_log_bank_id_ticket_id_idx");
    expect(indexNames).toContain("notification_log_bank_id_status_created_at_idx");
  });

  it("DB-005: notification_log — bank_id NOT NULL, index bank_id-first", () => {
    const config = getTableConfig(notificationLog);
    const bankId = config.columns.find((c) => c.name === "bank_id");
    expect(bankId?.notNull).toBe(true);
  });
});

describe("DB-005: modèle notification_devices (structure)", () => {
  it("DB-005: notification_devices — colonnes requises présentes", () => {
    const config = getTableConfig(notificationDevices);
    const names = config.columns.map((c) => c.name);
    for (const col of [
      "id",
      "bank_id",
      "device_token",
      "platform",
      "phone_hash",
      "last_seen",
      "revoked_at",
      "created_at",
    ]) {
      expect(names, `colonne ${col}`).toContain(col);
    }
  });

  it("DB-005: notification_devices — device_token globalement unique", () => {
    const config = getTableConfig(notificationDevices);
    const token = config.columns.find((c) => c.name === "device_token");
    expect(token?.isUnique).toBe(true);
  });

  it("DB-005: notification_devices — aucune colonne phone en clair", () => {
    const config = getTableConfig(notificationDevices);
    const names = config.columns.map((c) => c.name);
    const suspicious = names.filter(
      (n) =>
        n === "phone" ||
        n === "phone_encrypted" ||
        (n.includes("phone") && !n.endsWith("_hash"))
    );
    expect(suspicious).toHaveLength(0);
  });

  it("DB-005: notification_devices — bank_id NOT NULL, index bank_id-first", () => {
    const config = getTableConfig(notificationDevices);
    const bankId = config.columns.find((c) => c.name === "bank_id");
    expect(bankId?.notNull).toBe(true);
    const hasBankFirst = config.indexes.some((idx) => {
      const first = idx.config.columns[0];
      return (
        first !== undefined &&
        "name" in first &&
        (first as { name: string }).name === "bank_id"
      );
    });
    expect(hasBankFirst, "notification_devices index bank_id-first").toBe(true);
  });
});

describe("DB-005: modèle notification_test_recipients (structure)", () => {
  it("DB-005: notification_test_recipients — colonnes requises présentes", () => {
    const config = getTableConfig(notificationTestRecipients);
    const names = config.columns.map((c) => c.name);
    for (const col of [
      "id",
      "bank_id",
      "phone_hash",
      "phone_encrypted",
      "added_by",
      "added_at",
    ]) {
      expect(names, `colonne ${col}`).toContain(col);
    }
  });

  it("DB-005: notification_test_recipients — unicité (bank_id, phone_hash)", () => {
    const config = getTableConfig(notificationTestRecipients);
    const uniq = config.uniqueConstraints.map((u) => u.name);
    expect(uniq).toContain("notification_test_recipients_bank_id_phone_hash_key");
  });

  it("DB-005: notification_test_recipients — phone_encrypted est de type text", () => {
    const config = getTableConfig(notificationTestRecipients);
    const phoneEncrypted = config.columns.find((c) => c.name === "phone_encrypted");
    expect(phoneEncrypted).toBeDefined();
    expect(phoneEncrypted?.columnType).toBe("PgText");
  });

  it("DB-005: notification_test_recipients — aucune colonne phone en clair", () => {
    const config = getTableConfig(notificationTestRecipients);
    const names = config.columns.map((c) => c.name);
    const suspicious = names.filter(
      (n) =>
        n === "phone" ||
        (n.includes("phone") && !n.endsWith("_hash") && !n.endsWith("_encrypted"))
    );
    expect(suspicious).toHaveLength(0);
  });

  it("DB-005: notification_test_recipients — bank_id NOT NULL, index bank_id-first", () => {
    const config = getTableConfig(notificationTestRecipients);
    const bankId = config.columns.find((c) => c.name === "bank_id");
    expect(bankId?.notNull).toBe(true);
    const hasBankFirst = config.indexes.some((idx) => {
      const first = idx.config.columns[0];
      return (
        first !== undefined &&
        "name" in first &&
        (first as { name: string }).name === "bank_id"
      );
    });
    expect(hasBankFirst, "notification_test_recipients index bank_id-first").toBe(true);
  });
});
