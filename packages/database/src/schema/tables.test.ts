import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { banks } from "./banks.js";
import { agencies, agencyExceptionalClosures } from "./agencies.js";
import { services } from "./services.js";
import { queues } from "./queues.js";
import { counters, counterServices } from "./counters.js";
import { kiosks } from "./kiosks.js";
import { users, userServices, agencyUsers, agentStatusHistory } from "./users.js";
import { tickets, ticketTransfers } from "./tickets.js";

/**
 * Tests structurels du modèle Drizzle (DB-001) — SOURCE DE VÉRITÉ.
 * Vérifient in-process (sans base) les invariants de convention F2 :
 * bank_id sur chaque table métier, PK, contraintes CHECK bornées, uniques.
 */

/** Toutes les tables métier (hors racine tenant `banks` et identité `users`). */
const BUSINESS_TABLES = {
  agencies,
  agencyExceptionalClosures,
  services,
  queues,
  counters,
  counterServices,
  kiosks,
  userServices,
  agencyUsers,
  agentStatusHistory,
  tickets,
  ticketTransfers,
} as const;

describe("DB-001: modèle Drizzle (structure)", () => {
  it("DB-001: chaque table métier expose une colonne bank_id NOT NULL", () => {
    for (const [name, table] of Object.entries(BUSINESS_TABLES)) {
      const config = getTableConfig(table);
      const bankId = config.columns.find((column) => column.name === "bank_id");
      expect(bankId, `${name}.bank_id présent`).toBeDefined();
      expect(bankId?.notNull, `${name}.bank_id NOT NULL`).toBe(true);
    }
  });

  it("DB-001: chaque table métier a un index dont la première colonne est bank_id", () => {
    for (const [name, table] of Object.entries(BUSINESS_TABLES)) {
      const config = getTableConfig(table);
      const hasBankFirst = config.indexes.some((index) => {
        const first = index.config.columns[0];
        return (
          first !== undefined &&
          "name" in first &&
          (first as { name: string }).name === "bank_id"
        );
      });
      expect(hasBankFirst, `${name} index bank_id-first`).toBe(true);
    }
  });

  it("DB-001: banks porte 3 CHECK bornés + slug unique", () => {
    const config = getTableConfig(banks);
    const checkNames = config.checks.map((check) => check.name).sort();
    expect(checkNames).toEqual([
      "banks_agent_inactivity_minutes_bounds",
      "banks_no_show_timeout_minutes_bounds",
      "banks_queue_critical_threshold_bounds",
    ]);
    const slug = config.columns.find((column) => column.name === "slug");
    expect(slug?.isUnique).toBe(true);
  });

  it("DB-001: services porte le CHECK de format de code et l'unicité (agency_id, code)", () => {
    const config = getTableConfig(services);
    expect(config.checks.map((check) => check.name)).toContain("services_code_format");
    expect(config.uniqueConstraints.map((u) => u.name)).toContain("services_agency_id_code_key");
  });

  it("DB-001: tickets — tracking_id/local_uuid uniques, unicité (queue_id, number, issued_day), issued_day généré", () => {
    const config = getTableConfig(tickets);
    const tracking = config.columns.find((column) => column.name === "tracking_id");
    const local = config.columns.find((column) => column.name === "local_uuid");
    const issuedDay = config.columns.find((column) => column.name === "issued_day");
    expect(tracking?.isUnique).toBe(true);
    expect(tracking?.notNull).toBe(true);
    expect(local?.isUnique).toBe(true);
    expect(issuedDay?.generated).toBeDefined();
    expect(config.uniqueConstraints.map((u) => u.name)).toContain(
      "tickets_queue_id_number_issued_day_key"
    );
  });

  it("DB-001: users — email unique global, languages NOT NULL", () => {
    const config = getTableConfig(users);
    const email = config.columns.find((column) => column.name === "email");
    const languages = config.columns.find((column) => column.name === "languages");
    expect(email?.isUnique).toBe(true);
    expect(languages?.notNull).toBe(true);
  });

  it("DB-001: toutes les FK sont en RESTRICT (aucune cascade destructive)", () => {
    for (const table of Object.values(BUSINESS_TABLES)) {
      const config = getTableConfig(table);
      for (const fk of config.foreignKeys) {
        expect(fk.onDelete).toBe("restrict");
      }
    }
  });
});
