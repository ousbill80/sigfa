/**
 * DB-006 — Tests d'intégration pour upsertDailyStats et la fixture reporting
 *
 * Utilise Testcontainers (PostgreSQL réelle) — JAMAIS de mock (T5).
 * Tests nommés DB-006 (T3).
 *
 * @module
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPostgresContainerWithRoles } from "@sigfa/testing/tenant-isolation";
import type { DualConnectionHarness } from "@sigfa/testing/tenant-isolation";
import { applyMigrations } from "src/test-support/migrate.js";
import { REPORTING_FIXTURE, EXPECTED_STATS } from "src/seed/fixtures/reporting-fixture.js";
import { upsertDailyStats } from "src/reporting/upsert-daily-stats.js";

describe("DB-006 — upsertDailyStats + fixture reporting", () => {
  let harness: DualConnectionHarness;

  /** UUIDs déterministes pour les tests */
  const BANK_ID = "ffffffff-0006-4000-8000-000000000001";
  const AGENCY_ID = "ffffffff-0006-4000-8000-000000000002";
  const SERVICE_ID = "ffffffff-0006-4000-8000-000000000003";
  const QUEUE_ID = "ffffffff-0006-4000-8000-000000000004";
  const COUNTER_ID = "ffffffff-0006-4000-8000-000000000005";
  const AGENT_ID = "ffffffff-0006-4000-8000-000000000006";
  const TEST_DAY = "2026-07-01";

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);

    // Insérer les fixtures minimales (connexion migrateur = BYPASSRLS)
    await harness.query(`
      INSERT INTO banks (id, name, slug)
      VALUES ('${BANK_ID}', 'Banque Test DB-006', 'test-db006')
      ON CONFLICT (id) DO NOTHING
    `);

    await harness.query(`
      INSERT INTO agencies (id, bank_id, name)
      VALUES ('${AGENCY_ID}', '${BANK_ID}', 'Agence Test DB-006')
      ON CONFLICT (id) DO NOTHING
    `);

    await harness.query(`
      INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes, display_order)
      VALUES ('${SERVICE_ID}', '${BANK_ID}', '${AGENCY_ID}', 'SVC', 'Service Test', 15, 1)
      ON CONFLICT (agency_id, code) DO NOTHING
    `);

    await harness.query(`
      INSERT INTO queues (id, bank_id, agency_id, service_id)
      VALUES ('${QUEUE_ID}', '${BANK_ID}', '${AGENCY_ID}', '${SERVICE_ID}')
      ON CONFLICT (id) DO NOTHING
    `);

    await harness.query(`
      INSERT INTO counters (id, bank_id, agency_id, number, label)
      VALUES ('${COUNTER_ID}', '${BANK_ID}', '${AGENCY_ID}', 1, 'Guichet 1')
      ON CONFLICT (id) DO NOTHING
    `);

    await harness.query(`
      INSERT INTO users (id, bank_id, email, password_hash, first_name, last_name, role)
      VALUES ('${AGENT_ID}', '${BANK_ID}', 'agent.db006@test.ci', '$2b$12$placeholder', 'Agent', 'Test', 'AGENT')
      ON CONFLICT (email) DO NOTHING
    `);

    // Insérer les tickets de la fixture déterministe (valeurs fixes, résultats prédictibles)
    for (const ticket of REPORTING_FIXTURE.tickets) {
      await harness.query(`
        INSERT INTO tickets (
          id, bank_id, agency_id, queue_id, service_id, counter_id, agent_id,
          number, tracking_id, channel, status, priority,
          issued_at, called_at, served_at, closed_at, no_show_at,
          wait_time_seconds, service_time_seconds,
          feedback_score
        ) VALUES (
          '${ticket.id}',
          '${BANK_ID}',
          '${AGENCY_ID}',
          '${QUEUE_ID}',
          '${SERVICE_ID}',
          ${ticket.counterId ? `'${ticket.counterId}'` : "NULL"},
          ${ticket.agentId ? `'${ticket.agentId}'` : "NULL"},
          ${ticket.number},
          '${ticket.trackingId}',
          '${ticket.channel}',
          '${ticket.status}',
          'STANDARD',
          '${ticket.issuedAt}',
          ${ticket.calledAt ? `'${ticket.calledAt}'` : "NULL"},
          ${ticket.servedAt ? `'${ticket.servedAt}'` : "NULL"},
          ${ticket.closedAt ? `'${ticket.closedAt}'` : "NULL"},
          ${ticket.noShowAt ? `'${ticket.noShowAt}'` : "NULL"},
          ${ticket.waitTimeSeconds ?? "NULL"},
          ${ticket.serviceTimeSeconds ?? "NULL"},
          ${ticket.feedbackScore ?? "NULL"}
        )
        ON CONFLICT (id) DO NOTHING
      `);
    }

    // Insérer les entrées agent_status_history pour agent_active_seconds
    for (const entry of REPORTING_FIXTURE.agentStatusHistory) {
      await harness.query(`
        INSERT INTO agent_status_history (id, bank_id, agency_id, agent_id, from_status, to_status, changed_at)
        VALUES (
          '${entry.id}',
          '${BANK_ID}',
          '${AGENCY_ID}',
          '${AGENT_ID}',
          ${entry.fromStatus ? `'${entry.fromStatus}'` : "NULL"},
          '${entry.toStatus}',
          '${entry.changedAt}'
        )
        ON CONFLICT (id) DO NOTHING
      `);
    }
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1 : upsertDailyStats rejoué 2× → état identique, zéro doublon
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-006: upsertDailyStats rejoué 2× sur le même jour → état identique, zéro doublon (test)",
    async () => {
      // Premier upsert
      await upsertDailyStats(harness.query.bind(harness), TEST_DAY, AGENCY_ID, BANK_ID);

      // Compter les lignes après le premier upsert
      const result1 = await harness.query(`
        SELECT COUNT(*) as count FROM daily_agency_stats
        WHERE bank_id = '${BANK_ID}' AND agency_id = '${AGENCY_ID}' AND day = '${TEST_DAY}'
      `);
      const count1 = parseInt(String(result1.rows[0]?.count ?? "0"), 10);
      expect(count1).toBeGreaterThan(0);

      // Deuxième upsert (rejouer)
      await upsertDailyStats(harness.query.bind(harness), TEST_DAY, AGENCY_ID, BANK_ID);

      // Compter après le deuxième upsert — doit être identique
      const result2 = await harness.query(`
        SELECT COUNT(*) as count FROM daily_agency_stats
        WHERE bank_id = '${BANK_ID}' AND agency_id = '${AGENCY_ID}' AND day = '${TEST_DAY}'
      `);
      const count2 = parseInt(String(result2.rows[0]?.count ?? "0"), 10);

      expect(count2).toBe(count1);
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2 : fixture déterministe → mesures exactes (valeurs attendues exportées)
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-006: fixture déterministe reporting-fixture.ts → mesures exactes (test)",
    async () => {
      // S'assurer que l'upsert a été exécuté (peut dépendre de l'ordre des tests)
      await upsertDailyStats(harness.query.bind(harness), TEST_DAY, AGENCY_ID, BANK_ID);

      // Récupérer l'agrégat toutes-services (service_id IS NULL)
      const result = await harness.query(`
        SELECT
          tickets_issued,
          tickets_served,
          tickets_abandoned,
          tickets_no_show,
          total_wait_seconds,
          total_service_seconds,
          sla_met_count,
          sla_total_count,
          feedback_count,
          feedback_sum,
          nps_promoters,
          nps_passives,
          nps_detractors
        FROM daily_agency_stats
        WHERE bank_id = '${BANK_ID}'
          AND agency_id = '${AGENCY_ID}'
          AND day = '${TEST_DAY}'
          AND service_id IS NULL
      `);

      expect(result.rows).toHaveLength(1);
      const stats = result.rows[0] as Record<string, unknown>;

      expect(parseInt(String(stats["tickets_issued"]), 10)).toBe(EXPECTED_STATS.ticketsIssued);
      expect(parseInt(String(stats["tickets_served"]), 10)).toBe(EXPECTED_STATS.ticketsServed);
      expect(parseInt(String(stats["tickets_abandoned"]), 10)).toBe(EXPECTED_STATS.ticketsAbandoned);
      expect(parseInt(String(stats["tickets_no_show"]), 10)).toBe(EXPECTED_STATS.ticketsNoShow);
      expect(parseInt(String(stats["total_wait_seconds"]), 10)).toBe(EXPECTED_STATS.totalWaitSeconds);
      expect(parseInt(String(stats["total_service_seconds"]), 10)).toBe(EXPECTED_STATS.totalServiceSeconds);
      expect(parseInt(String(stats["sla_met_count"]), 10)).toBe(EXPECTED_STATS.slaMetCount);
      expect(parseInt(String(stats["sla_total_count"]), 10)).toBe(EXPECTED_STATS.slaTotalCount);
      expect(parseInt(String(stats["feedback_count"]), 10)).toBe(EXPECTED_STATS.feedbackCount);
      expect(parseInt(String(stats["feedback_sum"]), 10)).toBe(EXPECTED_STATS.feedbackSum);
      expect(parseInt(String(stats["nps_promoters"]), 10)).toBe(EXPECTED_STATS.npsPromoters);
      expect(parseInt(String(stats["nps_passives"]), 10)).toBe(EXPECTED_STATS.npsPassives);
      expect(parseInt(String(stats["nps_detractors"]), 10)).toBe(EXPECTED_STATS.npsDetractors);
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3 : unicité partielle — contraintes d'index
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-006: unicité (bank_id,agency_id,service_id,day) ; index bank_id-first (tests)",
    async () => {
      // Vérifier que les index uniques partiels existent dans pg_indexes
      const result = await harness.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'daily_agency_stats'
        ORDER BY indexname
      `);

      const indexNames = result.rows.map((r) => String(r["indexname"]));

      // Index uniques partiels
      expect(indexNames).toContain("daily_agency_stats_no_service_uniq");
      expect(indexNames).toContain("daily_agency_stats_with_service_uniq");

      // Index composites bank_id-first
      expect(indexNames).toContain("daily_agency_stats_bank_id_day_idx");
      expect(indexNames).toContain("daily_agency_stats_bank_id_agency_id_day_idx");

      // Vérifier la clause WHERE des index partiels
      const noServiceIdx = result.rows.find(
        (r) => String(r["indexname"]) === "daily_agency_stats_no_service_uniq"
      );
      const withServiceIdx = result.rows.find(
        (r) => String(r["indexname"]) === "daily_agency_stats_with_service_uniq"
      );

      expect(String(noServiceIdx?.["indexdef"] ?? "")).toContain("service_id IS NULL");
      expect(String(withServiceIdx?.["indexdef"] ?? "")).toContain("service_id IS NOT NULL");
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 4 : RLS + tenant-isolation sur daily_agency_stats
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-006: RLS daily_agency_stats — lecture sans contexte → zéro ligne",
    async () => {
      // Sans contexte, RLS doit bloquer la lecture
      const result = await harness.appQuery("SELECT * FROM daily_agency_stats");
      expect(result.rows).toHaveLength(0);
    },
    30_000
  );

  it(
    "DB-006: RLS export_jobs — lecture sans contexte → zéro ligne",
    async () => {
      const result = await harness.appQuery("SELECT * FROM export_jobs");
      expect(result.rows).toHaveLength(0);
    },
    30_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 5 : aucun champ personnel dans daily_agency_stats (test via pg catalog)
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-006: aucun champ personnel dans daily_agency_stats (test de schéma PG réelle)",
    async () => {
      const result = await harness.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'daily_agency_stats'
          AND table_schema = 'public'
        ORDER BY column_name
      `);

      const colNames = result.rows.map((r) => String(r["column_name"]));

      // Pas de champ personnel
      const personalFields = colNames.filter(
        (n) =>
          n === "phone" ||
          n === "email" ||
          n === "first_name" ||
          n === "last_name" ||
          n === "agent_id" ||
          n === "user_id" ||
          (n.includes("phone") && !n.endsWith("_hash") && !n.endsWith("_encrypted"))
      );

      expect(
        personalFields,
        "daily_agency_stats ne doit contenir aucun champ personnel"
      ).toHaveLength(0);
    },
    30_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 6 : migration up/down propre vérifiée via table existence
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-006: migration up propre — daily_agency_stats et export_jobs existent dans pg_tables",
    async () => {
      const result = await harness.query(`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('daily_agency_stats', 'export_jobs')
        ORDER BY tablename
      `);

      const tables = result.rows.map((r) => String(r["tablename"]));
      expect(tables).toContain("daily_agency_stats");
      expect(tables).toContain("export_jobs");
    },
    30_000
  );
});
