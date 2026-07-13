import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  whatsappConfig,
  whatsappMenuMapping,
  whatsappInboundMessages,
} from "./whatsapp.js";

/**
 * DB-NOTIF — Tests structurels WhatsApp (in-process, sans base).
 *
 * Vérifient colonnes, clés et unicités des 3 tables WhatsApp, alignées EXACTEMENT
 * sur ce que le code API attend (apps/api/src/services/whatsapp/*,
 * apps/api/src/routes/webhooks-whatsapp-inbound.ts).
 */

/** Vrai si la table a un index dont la première colonne est `bank_id`. */
function hasBankIdFirstIndex(table: Parameters<typeof getTableConfig>[0]): boolean {
  const config = getTableConfig(table);
  return config.indexes.some((idx) => {
    const first = idx.config.columns[0];
    return (
      first !== undefined &&
      "name" in first &&
      (first as { name: string }).name === "bank_id"
    );
  });
}

describe("DB-NOTIF: whatsapp_config (structure)", () => {
  it("DB-NOTIF: whatsapp_config — colonnes attendues par l'API présentes", () => {
    const names = getTableConfig(whatsappConfig).columns.map((c) => c.name);
    for (const col of [
      "bank_id",
      "business_number",
      "webhook_secret",
      "default_agency_id",
      "enabled",
      "created_at",
      "updated_at",
    ]) {
      expect(names, `colonne ${col}`).toContain(col);
    }
  });

  it("DB-NOTIF: whatsapp_config — bank_id est clé primaire (une config par banque)", () => {
    const config = getTableConfig(whatsappConfig);
    const bankId = config.columns.find((c) => c.name === "bank_id");
    expect(bankId?.primary, "bank_id PK").toBe(true);
    expect(bankId?.notNull, "bank_id NOT NULL (PK)").toBe(true);
  });

  it("DB-NOTIF: whatsapp_config — index bank_id-first", () => {
    expect(hasBankIdFirstIndex(whatsappConfig)).toBe(true);
  });
});

describe("DB-NOTIF: whatsapp_menu_mapping (structure)", () => {
  it("DB-NOTIF: whatsapp_menu_mapping — colonnes keyword/service_id présentes", () => {
    const names = getTableConfig(whatsappMenuMapping).columns.map((c) => c.name);
    for (const col of ["id", "bank_id", "keyword", "service_id"]) {
      expect(names, `colonne ${col}`).toContain(col);
    }
  });

  it("DB-NOTIF: whatsapp_menu_mapping — unicité (bank_id, keyword)", () => {
    const uniq = getTableConfig(whatsappMenuMapping).uniqueConstraints.map((u) => u.name);
    expect(uniq).toContain("whatsapp_menu_mapping_bank_id_keyword_key");
  });

  it("DB-NOTIF: whatsapp_menu_mapping — bank_id NOT NULL + index bank_id-first", () => {
    const bankId = getTableConfig(whatsappMenuMapping).columns.find((c) => c.name === "bank_id");
    expect(bankId?.notNull).toBe(true);
    expect(hasBankIdFirstIndex(whatsappMenuMapping)).toBe(true);
  });
});

describe("DB-NOTIF: whatsapp_inbound_messages (structure)", () => {
  it("DB-NOTIF: whatsapp_inbound_messages — colonnes d'idempotence présentes", () => {
    const names = getTableConfig(whatsappInboundMessages).columns.map((c) => c.name);
    for (const col of ["id", "bank_id", "provider_message_id", "created_at"]) {
      expect(names, `colonne ${col}`).toContain(col);
    }
  });

  it("DB-NOTIF: whatsapp_inbound_messages — unicité (bank_id, provider_message_id)", () => {
    const uniq = getTableConfig(whatsappInboundMessages).uniqueConstraints.map((u) => u.name);
    expect(uniq).toContain("whatsapp_inbound_messages_bank_id_provider_message_id_key");
  });

  it("DB-NOTIF: whatsapp_inbound_messages — bank_id NOT NULL + index bank_id-first", () => {
    const bankId = getTableConfig(whatsappInboundMessages).columns.find((c) => c.name === "bank_id");
    expect(bankId?.notNull).toBe(true);
    expect(hasBankIdFirstIndex(whatsappInboundMessages)).toBe(true);
  });
});
