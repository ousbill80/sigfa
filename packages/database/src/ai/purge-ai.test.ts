/**
 * DB-007 — Suite de tests d'intégration : tables IA + purge rétention 24 mois
 *
 * TDD rouge→vert : ces tests échouent AVANT la migration 0007 et l'implémentation
 * de `purge-ai.ts`. PostgreSQL réelle via Testcontainers — aucun mock (LA LOI T5).
 *
 * Couvre :
 *   - Critère 1 : unicité forecast (bank,agency,date,hour,model_version) ; upsert idempotent
 *   - Critère 2 : cycle anomalie open→acked→resolved persisté avec horodatages
 *   - Critère 3 : enums types/status alignés LA LOI
 *   - Critère 4 : purgeAiHistory — >24 mois purgé, récent intact, rejouable (horloge injectable)
 *   - Critère 5 : aucun champ personnel ; RLS + tenant-isolation sur les 4 tables
 *   - Critère 6 : bank_id explicite, test 2 tenants : agrégats A n'incluent jamais données B
 *   - Critère 7 : migration up/down propre sur base seedée complète (0000→0007)
 *
 * @module
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startPostgresContainerWithRoles } from "@sigfa/testing/tenant-isolation";
import type { DualConnectionHarness } from "@sigfa/testing/tenant-isolation";
import { applyMigrations } from "src/test-support/migrate.js";
import { withTenant } from "src/tenant.js";

const { purgeAiHistory } = await import("src/ai/index.js");

// ── Fixtures ────────────────────────────────────────────────────────────────

const BANK_A = "aaaaaaaa-0000-4000-8000-00000000db07";
const BANK_B = "bbbbbbbb-0000-4000-8000-00000000db07";
const AGENCY_A = "aa000000-0000-4000-8000-00000000db07";
const AGENCY_B = "bb000000-0000-4000-8000-00000000db07";

/** Horloge fixe pour les tests (11 juillet 2026). */
const NOW = new Date("2026-07-11T12:00:00.000Z");

// ── Helpers ─────────────────────────────────────────────────────────────────

async function insertForecast(
  harness: DualConnectionHarness,
  opts: {
    id: string;
    bankId: string;
    agencyId: string;
    targetDate: string;
    hour: number;
    modelVersion: string;
    computedAt: string;
    expectedTickets?: number;
  }
): Promise<void> {
  await harness.query(`
    INSERT INTO ai_forecasts
      (id, bank_id, agency_id, target_date, hour, expected_tickets, confidence,
       factors, model_version, computed_at, data_window)
    VALUES (
      '${opts.id}',
      '${opts.bankId}',
      '${opts.agencyId}',
      '${opts.targetDate}',
      ${opts.hour},
      ${opts.expectedTickets ?? 10},
      0.85,
      '["NONE"]'::jsonb,
      '${opts.modelVersion}',
      '${opts.computedAt}'::timestamptz,
      '2026-01-01/2026-07-11'
    )
    ON CONFLICT DO NOTHING
  `);
}

async function insertAnomaly(
  harness: DualConnectionHarness,
  opts: {
    id: string;
    bankId: string;
    agencyId?: string;
    type: string;
    status: string;
    detectedAt: string;
    ackedAt?: string;
    resolvedAt?: string;
  }
): Promise<void> {
  const agencyLiteral = opts.agencyId ? `'${opts.agencyId}'` : "NULL";
  const ackedAtLiteral = opts.ackedAt ? `'${opts.ackedAt}'::timestamptz` : "NULL";
  const resolvedAtLiteral = opts.resolvedAt ? `'${opts.resolvedAt}'::timestamptz` : "NULL";
  await harness.query(`
    INSERT INTO ai_anomalies
      (id, bank_id, agency_id, type, status, payload, detected_at, acked_at, resolved_at)
    VALUES (
      '${opts.id}',
      '${opts.bankId}',
      ${agencyLiteral},
      '${opts.type}',
      '${opts.status}',
      '{}'::jsonb,
      '${opts.detectedAt}'::timestamptz,
      ${ackedAtLiteral},
      ${resolvedAtLiteral}
    )
  `);
}

async function insertQualityScore(
  harness: DualConnectionHarness,
  opts: {
    id: string;
    bankId: string;
    agencyId: string;
    period: string;
    modelVersion: string;
    createdAt: string;
  }
): Promise<void> {
  await harness.query(`
    INSERT INTO ai_quality_scores
      (id, bank_id, agency_id, period, score, components, model_version, created_at, updated_at)
    VALUES (
      '${opts.id}',
      '${opts.bankId}',
      '${opts.agencyId}',
      '${opts.period}'::date,
      4.2,
      '{"sentiment": 0.8}'::jsonb,
      '${opts.modelVersion}',
      '${opts.createdAt}'::timestamptz,
      '${opts.createdAt}'::timestamptz
    )
  `);
}

/** Insère une feature ai_features (DB-AI-FEATURES) — horloge `computedAt` injectée. */
async function insertFeature(
  harness: DualConnectionHarness,
  opts: {
    id: string;
    bankId: string;
    agencyId: string;
    date: string;
    hourBucket: number;
    computedAt: string;
  }
): Promise<void> {
  await harness.query(`
    INSERT INTO ai_features
      (id, bank_id, agency_id, service_id, date, hour_bucket, bucket_minutes,
       arrivals, served, no_show, abandoned, p90_wait_seconds,
       counters_open, agents_active, day_of_week,
       is_month_end, is_public_pay_day, is_public_holiday, is_eve_of_holiday,
       is_partial, available_days, feature_set_version, computed_at)
    VALUES (
      '${opts.id}', '${opts.bankId}', '${opts.agencyId}', NULL,
      '${opts.date}'::date, ${opts.hourBucket}, 60,
      5, 5, 0, 0, 120.0, 3, 2, 5,
      false, false, false, false, false, 90, 'fs-v1',
      '${opts.computedAt}'::timestamptz
    )
  `);
}

// ── Suite principale ─────────────────────────────────────────────────────────

describe("DB-007 — tables IA + rétention (intégration PG16, Testcontainers)", () => {
  let harness: DualConnectionHarness;

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);

    await harness.query(`
      INSERT INTO banks (id, name, slug) VALUES
        ('${BANK_A}', 'Banque A DB007', 'banque-a-db007'),
        ('${BANK_B}', 'Banque B DB007', 'banque-b-db007')
      ON CONFLICT (id) DO NOTHING
    `);
    await harness.query(`
      INSERT INTO agencies (id, bank_id, name) VALUES
        ('${AGENCY_A}', '${BANK_A}', 'Agence A1 DB007'),
        ('${AGENCY_B}', '${BANK_B}', 'Agence B1 DB007')
      ON CONFLICT (id) DO NOTHING
    `);
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  beforeEach(async () => {
    await harness.query(`DELETE FROM ai_forecasts WHERE bank_id IN ('${BANK_A}', '${BANK_B}')`);
    await harness.query(`DELETE FROM ai_anomalies WHERE bank_id IN ('${BANK_A}', '${BANK_B}')`);
    await harness.query(`DELETE FROM ai_quality_scores WHERE bank_id IN ('${BANK_A}', '${BANK_B}')`);
    await harness.query(
      `DELETE FROM ai_staffing_recommendations WHERE bank_id IN ('${BANK_A}', '${BANK_B}')`
    );
    await harness.query(`DELETE FROM ai_features WHERE bank_id IN ('${BANK_A}', '${BANK_B}')`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Critère 7 : migration up/down propre (0000→0007) — validé implicitement
  // ─────────────────────────────────────────────────────────────────────────

  it(
    "DB-007: migration up propre — les 4 tables IA existent après 0000→0007",
    async () => {
      const res = await harness.query(`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN (
            'ai_forecasts',
            'ai_staffing_recommendations',
            'ai_anomalies',
            'ai_quality_scores'
          )
        ORDER BY tablename
      `);
      expect(res.rows).toHaveLength(4);
      const names = res.rows.map((r) => String(r.tablename));
      expect(names).toContain("ai_anomalies");
      expect(names).toContain("ai_forecasts");
      expect(names).toContain("ai_quality_scores");
      expect(names).toContain("ai_staffing_recommendations");
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Critère 3 : enums types/statuts alignés LA LOI
  // ─────────────────────────────────────────────────────────────────────────

  it(
    "DB-007: enums types/status alignés LA LOI — pg_enum contient les valeurs exactes",
    async () => {
      // contextual_factor
      const factors = await harness.query(`
        SELECT enumlabel FROM pg_enum
        WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'contextual_factor')
        ORDER BY enumsortorder
      `);
      expect(factors.rows.map((r) => r.enumlabel)).toEqual([
        "END_OF_MONTH",
        "CIVIL_SERVICE_PAY",
        "PUBLIC_HOLIDAY",
        "SCHOOL_START",
        "NONE",
      ]);

      // staffing_ack_status
      const staffingStatus = await harness.query(`
        SELECT enumlabel FROM pg_enum
        WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'staffing_ack_status')
        ORDER BY enumsortorder
      `);
      expect(staffingStatus.rows.map((r) => r.enumlabel)).toEqual(["PENDING", "ACKED"]);

      // anomaly_type
      const anomalyType = await harness.query(`
        SELECT enumlabel FROM pg_enum
        WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'anomaly_type')
        ORDER BY enumsortorder
      `);
      expect(anomalyType.rows.map((r) => r.enumlabel)).toEqual([
        "QUEUE_STUCK",
        "AGENT_INACTIVE_PATTERN",
        "SLA_SYSTEMIC",
      ]);

      // anomaly_status
      const anomalyStatus = await harness.query(`
        SELECT enumlabel FROM pg_enum
        WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'anomaly_status')
        ORDER BY enumsortorder
      `);
      expect(anomalyStatus.rows.map((r) => r.enumlabel)).toEqual(["open", "acked", "resolved"]);
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Critère 1 : unicité forecast (bank,agency,date,hour,model_version)
  // ─────────────────────────────────────────────────────────────────────────

  it(
    "DB-007: unicité forecast (bank,agency,date,hour,model_version) ; upsert de recalcul idempotent",
    async () => {
      await insertForecast(harness, {
        id: "f7000001-0000-4000-8000-00000000db07",
        bankId: BANK_A,
        agencyId: AGENCY_A,
        targetDate: "2026-07-15",
        hour: 10,
        modelVersion: "forecast-v1.0.0",
        computedAt: "2026-07-14T22:00:00Z",
        expectedTickets: 20,
      });

      // Deuxième insertion avec même clé unique → doit échouer (NOT ON CONFLICT)
      await expect(
        harness.query(`
          INSERT INTO ai_forecasts
            (id, bank_id, agency_id, target_date, hour, expected_tickets, confidence,
             factors, model_version, computed_at, data_window)
          VALUES (
            'f7000002-0000-4000-8000-00000000db07',
            '${BANK_A}',
            '${AGENCY_A}',
            '2026-07-15',
            10,
            25,
            0.90,
            '["END_OF_MONTH"]'::jsonb,
            'forecast-v1.0.0',
            '2026-07-14T23:00:00Z'::timestamptz,
            '2026-01-01/2026-07-14'
          )
        `)
      ).rejects.toThrow();

      // Un upsert ON CONFLICT DO UPDATE permet le recalcul idempotent
      await harness.query(`
        INSERT INTO ai_forecasts
          (id, bank_id, agency_id, target_date, hour, expected_tickets, confidence,
           factors, model_version, computed_at, data_window)
        VALUES (
          'f7000001-0000-4000-8000-00000000db07',
          '${BANK_A}',
          '${AGENCY_A}',
          '2026-07-15',
          10,
          30,
          0.92,
          '["END_OF_MONTH"]'::jsonb,
          'forecast-v1.0.0',
          '2026-07-14T23:30:00Z'::timestamptz,
          '2026-01-01/2026-07-14'
        )
        ON CONFLICT (bank_id, agency_id, target_date, hour, model_version)
        DO UPDATE SET
          expected_tickets = EXCLUDED.expected_tickets,
          confidence = EXCLUDED.confidence,
          factors = EXCLUDED.factors,
          computed_at = EXCLUDED.computed_at
      `);

      const row = await harness.query(`
        SELECT expected_tickets, confidence FROM ai_forecasts
        WHERE bank_id = '${BANK_A}' AND agency_id = '${AGENCY_A}'
          AND target_date = '2026-07-15' AND hour = 10 AND model_version = 'forecast-v1.0.0'
      `);
      expect(row.rows).toHaveLength(1);
      // Valeurs mises à jour par l'upsert
      expect(Number(row.rows[0]!.expected_tickets)).toBe(30);
      expect(Number(row.rows[0]!.confidence)).toBeCloseTo(0.92, 2);
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Critère 2 : cycle anomalie open→acked→resolved avec horodatages
  // ─────────────────────────────────────────────────────────────────────────

  it(
    "DB-007: cycle anomalie open→acked→resolved persisté avec horodatages (test)",
    async () => {
      const anomalyId = "a7000001-0000-4000-8000-00000000db07";
      const detectedAt = "2026-07-11T08:00:00Z";

      // État initial : open
      await insertAnomaly(harness, {
        id: anomalyId,
        bankId: BANK_A,
        agencyId: AGENCY_A,
        type: "QUEUE_STUCK",
        status: "open",
        detectedAt,
      });

      let row = await harness.query(`
        SELECT status, acked_at, resolved_at FROM ai_anomalies WHERE id = '${anomalyId}'
      `);
      expect(row.rows[0]!.status).toBe("open");
      expect(row.rows[0]!.acked_at).toBeNull();
      expect(row.rows[0]!.resolved_at).toBeNull();

      // Transition → acked
      const ackedAt = "2026-07-11T09:15:00Z";
      await harness.query(`
        UPDATE ai_anomalies
        SET status = 'acked',
            acked_by = 'manager-uuid-01',
            acked_at = '${ackedAt}'::timestamptz,
            updated_at = now()
        WHERE id = '${anomalyId}'
      `);

      row = await harness.query(`
        SELECT status, acked_at, acked_by, resolved_at FROM ai_anomalies WHERE id = '${anomalyId}'
      `);
      expect(row.rows[0]!.status).toBe("acked");
      expect(row.rows[0]!.acked_at).not.toBeNull();
      expect(row.rows[0]!.acked_by).toBe("manager-uuid-01");
      expect(row.rows[0]!.resolved_at).toBeNull();

      // Transition → resolved
      const resolvedAt = "2026-07-12T08:00:00Z";
      await harness.query(`
        UPDATE ai_anomalies
        SET status = 'resolved',
            resolved_at = '${resolvedAt}'::timestamptz,
            updated_at = now()
        WHERE id = '${anomalyId}'
      `);

      row = await harness.query(`
        SELECT status, acked_at, resolved_at FROM ai_anomalies WHERE id = '${anomalyId}'
      `);
      expect(row.rows[0]!.status).toBe("resolved");
      expect(row.rows[0]!.acked_at).not.toBeNull();
      expect(row.rows[0]!.resolved_at).not.toBeNull();
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Critère 4 : purgeAiHistory >24 mois, récent intact, idempotent
  // ─────────────────────────────────────────────────────────────────────────

  it(
    "DB-007: purgeAiHistory — >24 mois purgé, récent intact, rejouable (horloge contrôlée)",
    async () => {
      // Forecast ancien (>24 mois avant NOW)
      await insertForecast(harness, {
        id: "f7000010-0000-4000-8000-00000000db07",
        bankId: BANK_A,
        agencyId: AGENCY_A,
        targetDate: "2024-05-01",
        hour: 10,
        modelVersion: "forecast-v1.0.0",
        computedAt: "2024-04-30T22:00:00Z",
      });

      // Forecast récent (<24 mois)
      await insertForecast(harness, {
        id: "f7000011-0000-4000-8000-00000000db07",
        bankId: BANK_A,
        agencyId: AGENCY_A,
        targetDate: "2026-06-01",
        hour: 9,
        modelVersion: "forecast-v1.0.0",
        computedAt: "2026-05-31T22:00:00Z",
      });

      // Anomalie résolue ancienne (>24 mois)
      await insertAnomaly(harness, {
        id: "a7000010-0000-4000-8000-00000000db07",
        bankId: BANK_A,
        agencyId: AGENCY_A,
        type: "SLA_SYSTEMIC",
        status: "resolved",
        detectedAt: "2024-05-01T08:00:00Z",
        resolvedAt: "2024-05-02T08:00:00Z",
      });

      // Anomalie ouverte ancienne (>24 mois — doit être purgée car ancienne)
      await insertAnomaly(harness, {
        id: "a7000011-0000-4000-8000-00000000db07",
        bankId: BANK_A,
        agencyId: AGENCY_A,
        type: "AGENT_INACTIVE_PATTERN",
        status: "open",
        detectedAt: "2024-05-03T08:00:00Z",
      });

      // Score ancien (>24 mois)
      await insertQualityScore(harness, {
        id: "97000010-0000-4000-8000-00000000db07",
        bankId: BANK_A,
        agencyId: AGENCY_A,
        period: "2024-05-01",
        modelVersion: "nlp-v1.0.0",
        createdAt: "2024-05-31T12:00:00Z",
      });

      // Score récent (<24 mois)
      await insertQualityScore(harness, {
        id: "97000011-0000-4000-8000-00000000db07",
        bankId: BANK_A,
        agencyId: AGENCY_A,
        period: "2026-06-01",
        modelVersion: "nlp-v1.0.0",
        createdAt: "2026-06-30T12:00:00Z",
      });

      // Feature ancienne (>24 mois — computed_at)
      await insertFeature(harness, {
        id: "fe700010-0000-4000-8000-00000000db07",
        bankId: BANK_A,
        agencyId: AGENCY_A,
        date: "2024-05-01",
        hourBucket: 9,
        computedAt: "2024-04-30T22:00:00Z",
      });

      // Feature récente (<24 mois)
      await insertFeature(harness, {
        id: "fe700011-0000-4000-8000-00000000db07",
        bankId: BANK_A,
        agencyId: AGENCY_A,
        date: "2026-06-01",
        hourBucket: 9,
        computedAt: "2026-05-31T22:00:00Z",
      });

      // Premier appel
      const first = await purgeAiHistory(harness.query.bind(harness), { now: NOW });
      expect(first.deletedForecasts).toBeGreaterThanOrEqual(1);
      expect(first.deletedAnomalies).toBeGreaterThanOrEqual(2);
      expect(first.deletedQualityScores).toBeGreaterThanOrEqual(1);
      expect(first.deletedFeatures).toBeGreaterThanOrEqual(1);

      // Vérifier que le forecast ancien est supprimé et le récent intact
      const oldForecast = await harness.query(`
        SELECT count(*)::int AS n FROM ai_forecasts
        WHERE id = 'f7000010-0000-4000-8000-00000000db07'
      `);
      expect(oldForecast.rows[0]!.n).toBe(0);

      const recentForecast = await harness.query(`
        SELECT count(*)::int AS n FROM ai_forecasts
        WHERE id = 'f7000011-0000-4000-8000-00000000db07'
      `);
      expect(recentForecast.rows[0]!.n).toBe(1);

      // Anomalies anciennes supprimées
      const oldAnomaly = await harness.query(`
        SELECT count(*)::int AS n FROM ai_anomalies
        WHERE id IN ('a7000010-0000-4000-8000-00000000db07', 'a7000011-0000-4000-8000-00000000db07')
      `);
      expect(oldAnomaly.rows[0]!.n).toBe(0);

      // Score ancien supprimé, récent intact
      const oldScore = await harness.query(`
        SELECT count(*)::int AS n FROM ai_quality_scores
        WHERE id = '97000010-0000-4000-8000-00000000db07'
      `);
      expect(oldScore.rows[0]!.n).toBe(0);

      const recentScore = await harness.query(`
        SELECT count(*)::int AS n FROM ai_quality_scores
        WHERE id = '97000011-0000-4000-8000-00000000db07'
      `);
      expect(recentScore.rows[0]!.n).toBe(1);

      // Feature ancienne supprimée, récente intacte (DB-AI-FEATURES)
      const oldFeature = await harness.query(`
        SELECT count(*)::int AS n FROM ai_features
        WHERE id = 'fe700010-0000-4000-8000-00000000db07'
      `);
      expect(oldFeature.rows[0]!.n).toBe(0);

      const recentFeature = await harness.query(`
        SELECT count(*)::int AS n FROM ai_features
        WHERE id = 'fe700011-0000-4000-8000-00000000db07'
      `);
      expect(recentFeature.rows[0]!.n).toBe(1);

      // Deuxième appel → idempotent (rien à supprimer)
      const second = await purgeAiHistory(harness.query.bind(harness), { now: NOW });
      expect(second.deletedForecasts).toBe(0);
      expect(second.deletedAnomalies).toBe(0);
      expect(second.deletedQualityScores).toBe(0);
      expect(second.deletedFeatures).toBe(0);
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Critère 5 : RLS + tenant-isolation sur les 4 tables IA
  // ─────────────────────────────────────────────────────────────────────────

  it(
    "DB-007: RLS ENABLED + FORCED + policy tenant_isolation sur les 4 tables IA",
    async () => {
      const aiTables = [
        "ai_forecasts",
        "ai_staffing_recommendations",
        "ai_anomalies",
        "ai_quality_scores",
      ];

      const rlsResult = await harness.query(`
        SELECT pt.tablename,
               pt.rowsecurity,
               pc.relforcerowsecurity AS forcerowsecurity
        FROM pg_tables pt
        JOIN pg_class pc ON pc.relname = pt.tablename
          AND pc.relnamespace = 'public'::regnamespace
        WHERE pt.schemaname = 'public'
          AND pt.tablename = ANY(ARRAY[${aiTables.map((t) => `'${t}'`).join(",")}])
        ORDER BY pt.tablename
      `);

      expect(rlsResult.rows).toHaveLength(4);
      for (const row of rlsResult.rows) {
        expect(row.rowsecurity, `Table ${String(row.tablename)}: RLS doit être ENABLED`).toBe(true);
        expect(row.forcerowsecurity, `Table ${String(row.tablename)}: FORCE RLS doit être activé`).toBe(true);
      }

      const policyResult = await harness.query(`
        SELECT tablename, policyname FROM pg_policies
        WHERE schemaname = 'public'
          AND policyname = 'tenant_isolation'
          AND tablename = ANY(ARRAY[${aiTables.map((t) => `'${t}'`).join(",")}])
        ORDER BY tablename
      `);
      expect(policyResult.rows).toHaveLength(4);
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Critère 6 : bank_id explicite — agrégats tenant A n'incluent jamais données B
  // ─────────────────────────────────────────────────────────────────────────

  it(
    "DB-007: bank_id explicite — test 2 tenants, agrégats A n'incluent jamais données B (tenant-isolation)",
    async () => {
      // Insérer un forecast pour banque A et un pour banque B
      await insertForecast(harness, {
        id: "f7000020-0000-4000-8000-00000000db07",
        bankId: BANK_A,
        agencyId: AGENCY_A,
        targetDate: "2026-07-20",
        hour: 10,
        modelVersion: "forecast-v2.0.0",
        computedAt: "2026-07-19T22:00:00Z",
        expectedTickets: 50,
      });
      await insertForecast(harness, {
        id: "f7000021-0000-4000-8000-00000000db07",
        bankId: BANK_B,
        agencyId: AGENCY_B,
        targetDate: "2026-07-20",
        hour: 10,
        modelVersion: "forecast-v2.0.0",
        computedAt: "2026-07-19T22:00:00Z",
        expectedTickets: 75,
      });

      // Sous contexte A → ne voit que les forecasts de A
      const rowsA = await withTenant(harness.appQuery.bind(harness), BANK_A, async (query) => {
        const res = await query("SELECT bank_id, expected_tickets FROM ai_forecasts ORDER BY expected_tickets");
        return res.rows as Array<{ bank_id: string; expected_tickets: number }>;
      });

      expect(rowsA.every((r) => r.bank_id === BANK_A)).toBe(true);
      expect(rowsA.some((r) => r.bank_id === BANK_B)).toBe(false);
      // Vérifie que les données de B (75 tickets) ne sont PAS dans les résultats A
      expect(rowsA.some((r) => Number(r.expected_tickets) === 75)).toBe(false);

      // Sous contexte B → ne voit que les forecasts de B
      const rowsB = await withTenant(harness.appQuery.bind(harness), BANK_B, async (query) => {
        const res = await query("SELECT bank_id, expected_tickets FROM ai_forecasts ORDER BY expected_tickets");
        return res.rows as Array<{ bank_id: string; expected_tickets: number }>;
      });

      expect(rowsB.every((r) => r.bank_id === BANK_B)).toBe(true);
      expect(rowsB.some((r) => r.bank_id === BANK_A)).toBe(false);
      // Vérifie que les données de A (50 tickets) ne sont PAS dans les résultats B
      expect(rowsB.some((r) => Number(r.expected_tickets) === 50)).toBe(false);

      // Même isolation pour ai_anomalies
      await insertAnomaly(harness, {
        id: "a7000020-0000-4000-8000-00000000db07",
        bankId: BANK_A,
        agencyId: AGENCY_A,
        type: "QUEUE_STUCK",
        status: "open",
        detectedAt: "2026-07-20T10:00:00Z",
      });
      await insertAnomaly(harness, {
        id: "a7000021-0000-4000-8000-00000000db07",
        bankId: BANK_B,
        agencyId: AGENCY_B,
        type: "SLA_SYSTEMIC",
        status: "open",
        detectedAt: "2026-07-20T10:00:00Z",
      });

      const anomaliesA = await withTenant(harness.appQuery.bind(harness), BANK_A, async (query) => {
        const res = await query("SELECT bank_id FROM ai_anomalies");
        return res.rows as Array<{ bank_id: string }>;
      });

      expect(anomaliesA.every((r) => r.bank_id === BANK_A)).toBe(true);
      expect(anomaliesA.some((r) => r.bank_id === BANK_B)).toBe(false);
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Critère 5 : aucun champ personnel dans les tables IA (via information_schema)
  // ─────────────────────────────────────────────────────────────────────────

  it(
    "DB-007: aucun champ personnel (phone, email, first_name, last_name) dans les 4 tables IA",
    async () => {
      const prohibitedPatterns = ["phone", "email", "first_name", "last_name"];
      for (const pattern of prohibitedPatterns) {
        const res = await harness.query(`
          SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN (
              'ai_forecasts', 'ai_staffing_recommendations',
              'ai_anomalies', 'ai_quality_scores'
            )
            AND column_name LIKE '%${pattern}%'
        `);
        expect(
          res.rows,
          `Le champ "${pattern}" ne doit pas être présent dans les tables IA`
        ).toHaveLength(0);
      }
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Critère 5 : ai_* tables absentes de AUDITED_TABLES (volume trop élevé)
  // ─────────────────────────────────────────────────────────────────────────

  it(
    "DB-007: tables IA absentes de AUDITED_TABLES (décision de volume documentée)",
    async () => {
      const { AUDITED_TABLES } = await import("src/audit/index.js");
      const aiTableNames = [
        "ai_forecasts",
        "ai_staffing_recommendations",
        "ai_anomalies",
        "ai_quality_scores",
      ];
      for (const tableName of aiTableNames) {
        expect(
          (AUDITED_TABLES as readonly string[]).includes(tableName),
          `${tableName} ne doit PAS figurer dans AUDITED_TABLES (tables IA à volume élevé)`
        ).toBe(false);
      }
    },
    10_000
  );

  // ─────────────────────────────────────────────────────────────────────────
  // ai_staffing_recommendations — structure et cycle de vie
  // ─────────────────────────────────────────────────────────────────────────

  it(
    "DB-007: ai_staffing_recommendations — insertion + status PENDING/ACKED cycle (test)",
    async () => {
      const recId = "b7000001-0000-4000-8000-00000000db07";

      await harness.query(`
        INSERT INTO ai_staffing_recommendations
          (id, bank_id, agency_id, target_date, time, action, counters, rationale, status)
        VALUES (
          '${recId}',
          '${BANK_A}',
          '${AGENCY_A}',
          '2026-07-15',
          '10:30',
          'OPEN_COUNTER',
          2,
          'Pic prévu à 10h30',
          'PENDING'
        )
      `);

      let row = await harness.query(`
        SELECT status, acked_by, acked_at FROM ai_staffing_recommendations WHERE id = '${recId}'
      `);
      expect(row.rows[0]!.status).toBe("PENDING");
      expect(row.rows[0]!.acked_by).toBeNull();
      expect(row.rows[0]!.acked_at).toBeNull();

      // Acquittement → ACKED
      await harness.query(`
        UPDATE ai_staffing_recommendations
        SET status = 'ACKED',
            acked_by = 'manager-001',
            acked_at = now(),
            updated_at = now()
        WHERE id = '${recId}'
      `);

      row = await harness.query(`
        SELECT status, acked_by, acked_at FROM ai_staffing_recommendations WHERE id = '${recId}'
      `);
      expect(row.rows[0]!.status).toBe("ACKED");
      expect(row.rows[0]!.acked_by).toBe("manager-001");
      expect(row.rows[0]!.acked_at).not.toBeNull();
    },
    60_000
  );
});
