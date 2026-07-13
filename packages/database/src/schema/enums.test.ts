import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startPostgresContainer,
  type PostgresHarness,
} from "@sigfa/testing/tenant-isolation";
import {
  ticketStatusEnum,
  ticketPriorityEnum,
  ticketChannelEnum,
  agentStatusEnum,
  counterStatusEnum,
  queueStatusEnum,
  printerStatusEnum,
  roleEnum,
  agentLanguageEnum,
} from "./enums.js";
import { applyMigrations } from "src/test-support/migrate.js";

/**
 * LA LOI — valeurs canoniques des enums, copiées à l'identique depuis les
 * contrats bundlés (`packages/contracts/generated/bundled/{core,agents}.yaml`).
 * Le test échoue si le schéma Drizzle diverge de LA LOI.
 */
const LA_LOI = {
  TicketStatus: ["WAITING", "CALLED", "SERVING", "DONE", "NO_SHOW", "ABANDONED", "TRANSFERRED"],
  TicketPriority: ["STANDARD", "PRIORITY", "VIP", "PMR", "SENIOR"],
  TicketChannel: ["KIOSK", "QR", "MOBILE", "WHATSAPP"],
  AgentStatus: ["AVAILABLE", "SERVING", "PAUSED", "ABSENT", "OFFLINE"],
  CounterStatus: ["OPEN", "PAUSED", "CLOSED"],
  QueueStatus: ["OPEN", "PAUSED", "CLOSED"],
  PrinterStatus: ["OK", "PAPER_LOW", "ERROR", "OFFLINE"],
  // Role complet de LA LOI (7 valeurs, NONE inclus)
  Role: ["SUPER_ADMIN", "BANK_ADMIN", "AGENCY_DIRECTOR", "MANAGER", "AGENT", "AUDITOR", "NONE"],
  // Décision PO 2026-07 : DIOULA et BAOULE retirés du périmètre (migration 0011)
  AgentLanguage: ["FR", "EN"],
} as const;

describe("DB-001: alignement des enums Drizzle ↔ LA LOI", () => {
  it("DB-001: enums Drizzle === LA LOI (TicketStatus 7, TicketPriority 5, canaux, statuts)", () => {
    expect(ticketStatusEnum.enumValues).toEqual(LA_LOI.TicketStatus);
    expect(ticketPriorityEnum.enumValues).toEqual(LA_LOI.TicketPriority);
    expect(ticketPriorityEnum.enumValues).toHaveLength(5);
    expect(ticketChannelEnum.enumValues).toEqual(LA_LOI.TicketChannel);
    expect(agentStatusEnum.enumValues).toEqual(LA_LOI.AgentStatus);
    expect(counterStatusEnum.enumValues).toEqual(LA_LOI.CounterStatus);
    expect(queueStatusEnum.enumValues).toEqual(LA_LOI.QueueStatus);
    expect(printerStatusEnum.enumValues).toEqual(LA_LOI.PrinterStatus);
    expect(agentLanguageEnum.enumValues).toEqual(LA_LOI.AgentLanguage);
  });

  it("DB-001: Role Drizzle = LA LOI \\ {NONE} (sous-ensemble strict documenté)", () => {
    const expected = LA_LOI.Role.filter((role) => role !== "NONE");
    expect(roleEnum.enumValues).toEqual(expected);
    expect(roleEnum.enumValues).not.toContain("NONE");
    expect(roleEnum.enumValues).toHaveLength(6);
  });

  describe("assertion en base réelle (pg_enum)", () => {
    let pg: PostgresHarness;

    beforeAll(async () => {
      pg = await startPostgresContainer();
      await applyMigrations(pg);
    }, 180_000);

    afterAll(async () => {
      await pg?.stop();
    }, 30_000);

    it("DB-001: NONE absent de pg_enum pour le type role (assertion base)", async () => {
      const result = await pg.query(
        `SELECT e.enumlabel AS label
           FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'role'
          ORDER BY e.enumsortorder`
      );
      const labels = result.rows.map((row) => row.label as string);
      expect(labels).toEqual(LA_LOI.Role.filter((role) => role !== "NONE"));
      expect(labels).not.toContain("NONE");
    });

    it("DB-001: chaque enum PG porte exactement les valeurs de LA LOI", async () => {
      const checks: Array<[string, readonly string[]]> = [
        ["ticket_status", LA_LOI.TicketStatus],
        ["ticket_priority", LA_LOI.TicketPriority],
        ["ticket_channel", LA_LOI.TicketChannel],
        ["agent_status", LA_LOI.AgentStatus],
        ["counter_status", LA_LOI.CounterStatus],
        ["queue_status", LA_LOI.QueueStatus],
        ["printer_status", LA_LOI.PrinterStatus],
        ["agent_language", LA_LOI.AgentLanguage],
      ];
      for (const [typname, expected] of checks) {
        const result = await pg.query(
          `SELECT e.enumlabel AS label
             FROM pg_enum e
             JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = '${typname}'
            ORDER BY e.enumsortorder`
        );
        const labels = result.rows.map((row) => row.label as string);
        expect(labels, `enum ${typname}`).toEqual([...expected]);
      }
    });
  });
});
