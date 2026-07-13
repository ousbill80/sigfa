/**
 * Test d'ISOLATION TENANT — SEC-002-CUTOVER-LOT6 (routes de LECTURE IA armées).
 *
 * Prouve, sur PostgreSQL 16 réelle sous connexion `sigfa_app` NOBYPASSRLS (jamais
 * l'owner qui contourne FORCE RLS), que la BASCULE `withArmedTenant` des routes de
 * lecture IA `anomaly-route` / `feedback-insights-route` isole réellement les tenants :
 *
 *   - anomaly-route.ts : un contexte armé sur B ne LIT PAS les `ai_anomalies` de A
 *     (SQL EXACT de `loadAnomalies` — count + liste paginée `WHERE bank_id`), même en
 *     ciblant le `bank_id` de A ; A armé voit bien SES anomalies.
 *   - feedback-insights-route.ts : un contexte armé sur B ne LIT PAS les feedbacks
 *     (`tickets.feedback_score/feedback_comment`) de A (SQL EXACT de `extractFeedbackRows`),
 *     même en ciblant le `bank_id` de A ; A armé voit bien SES feedbacks.
 *
 * COUTURE DB COMPLÈTE : `ai_anomalies` (policy `tenant_isolation` + GRANT CRUD `sigfa_app`,
 * 0007) et `tickets` (policy `tenant_isolation` + GRANT CRUD `sigfa_app`, 0001). Le SQL
 * exécuté ici est CELUI des routes basculées, rejoué à travers `withArmedTenant` —
 * l'exact chemin de production. Le service partagé `feedback-insights-service` est
 * INCHANGÉ : le routeur lui injecte la connexion armée.
 *
 * PREUVE ROUGE (armement load-bearing) : SANS armer `app.current_bank_id`, la même
 * connexion `sigfa_app` voit ZÉRO ligne (FORCE RLS) — c'est bien l'armement, pas le
 * `WHERE bank_id` applicatif, qui porte l'isolation en défense-en-profondeur.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startPostgresContainerWithRoles,
  type DualConnectionHarness,
} from "@sigfa/testing/tenant-isolation";
import { applyMigrations } from "@sigfa/database/test-support";
import { withArmedTenant, type ArmableConnection } from "src/lib/armed-tenant.js";

let h: DualConnectionHarness;

const bankA = "aaaaaaaa-0000-4000-8000-0000000000a6";
const bankB = "bbbbbbbb-0000-4000-8000-0000000000b6";
const agencyA = "aa000000-0000-4000-8000-0000000000a6";
const agencyB = "bb000000-0000-4000-8000-0000000000b6";
const serviceA = "5e000000-0000-4000-8000-0000000000a6";
const serviceB = "5e000000-0000-4000-8000-0000000000b6";
const queueA = "40000000-0000-4000-8000-0000000000a6";
const queueB = "40000000-0000-4000-8000-0000000000b6";
const anomalyA = "a1000000-0000-4000-8000-0000000000a6";
const anomalyB = "a1000000-0000-4000-8000-0000000000b6";
const ticketA = "71000000-0000-4000-8000-0000000000a6";
const ticketB = "71000000-0000-4000-8000-0000000000b6";

/** Adapte `appQuery` (connexion sigfa_app NOBYPASSRLS) en `ArmableConnection`. */
function armable(harness: DualConnectionHarness): ArmableConnection {
  return {
    query: async (sql: string, values?: unknown[]) => {
      const res =
        values !== undefined
          ? await harness.appQuery(sql, values)
          : await harness.appQuery(sql);
      return { rows: res.rows };
    },
  };
}

beforeAll(async () => {
  h = await startPostgresContainerWithRoles();
  await applyMigrations(h);
  // Seed via le rôle migrateur (owner) : deux tenants disjoints A et B.
  await h.query(
    `INSERT INTO banks (id, name, slug) VALUES
       ('${bankA}','Banque A','cutover6-a'),
       ('${bankB}','Banque B','cutover6-b') ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO agencies (id, bank_id, name, weekly_schedule) VALUES
       ('${agencyA}','${bankA}','Agence A','{}'),
       ('${agencyB}','${bankB}','Agence B','{}') ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes, display_order) VALUES
       ('${serviceA}','${bankA}','${agencyA}','DEP','Dépôt',10,1),
       ('${serviceB}','${bankB}','${agencyB}','DEP','Dépôt',10,1) ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO queues (id, bank_id, agency_id, service_id, status) VALUES
       ('${queueA}','${bankA}','${agencyA}','${serviceA}','OPEN'),
       ('${queueB}','${bankB}','${agencyB}','${serviceB}','OPEN') ON CONFLICT (id) DO NOTHING`
  );
  // Une anomalie ouverte chez A et une chez B (lues par anomaly-route.loadAnomalies).
  await h.query(
    `INSERT INTO ai_anomalies (id, bank_id, agency_id, type, status, payload, detected_at) VALUES
       ('${anomalyA}','${bankA}','${agencyA}','QUEUE_STUCK','open','{"description":"A"}'::jsonb, now()),
       ('${anomalyB}','${bankB}','${agencyB}','QUEUE_STUCK','open','{"description":"B"}'::jsonb, now())
       ON CONFLICT (id) DO NOTHING`
  );
  // Un ticket clos AVEC feedback chez A et un chez B (lus par extractFeedbackRows).
  await h.query(
    `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, tracking_id, channel, status,
       feedback_score, feedback_comment, feedback_at, closed_at)
       VALUES
       ('${ticketA}','${bankA}','${agencyA}','${queueA}','${serviceA}',1,'trk-cutover6-a-000001','KIOSK','DONE',5,'Excellent service A', now(), now()),
       ('${ticketB}','${bankB}','${agencyB}','${queueB}','${serviceB}',1,'trk-cutover6-b-000001','KIOSK','DONE',2,'Attente trop longue B', now(), now())
       ON CONFLICT (id) DO NOTHING`
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
}, 30_000);

// Bornes de jour civil Abidjan couvrant « aujourd'hui » (feedback_at = now()).
const dayStart = "2000-01-01";
const dayEnd = "2999-12-31";

describe("SEC-002-CUTOVER-LOT6: isolation tenant sous armement (anomaly/feedback-insights)", () => {
  // ── PREUVE ROUGE : l'armement est load-bearing ──────────────────────────────
  it("SEC-002-CUTOVER-LOT6: SANS armement, sigfa_app voit ZÉRO ligne (FORCE RLS) — l'armement porte l'isolation", async () => {
    const anomalies = await h.appQuery(`SELECT id FROM ai_anomalies`);
    const feedbacks = await h.appQuery(
      `SELECT id FROM tickets WHERE feedback_at IS NOT NULL`
    );
    expect(anomalies.rows).toHaveLength(0);
    expect(feedbacks.rows).toHaveLength(0);
  }, 60_000);

  // ── anomaly-route.ts (loadAnomalies — SELECT ai_anomalies WHERE bank_id) ─────
  it("SEC-002-CUTOVER-LOT6: GET /ai/anomalies — B armé ne voit PAS les anomalies de A (loadAnomalies isolé)", async () => {
    // SQL EXACT de `loadAnomalies` (count) rejoué armé sur B en ciblant bank_id=A.
    const countByB = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT COUNT(*)::int AS total FROM ai_anomalies WHERE bank_id = $1 AND status = $2`,
        [bankA, "open"]
      );
      return Number((res.rows[0] as { total: number }).total);
    });
    expect(countByB).toBe(0);
    // SQL EXACT de `loadAnomalies` (liste) rejoué armé sur B en ciblant bank_id=A.
    const listByB = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT id, type, status, agency_id, payload, detected_at, acked_by, acked_at, resolved_at
           FROM ai_anomalies
          WHERE bank_id = $1 AND status = $2
          ORDER BY detected_at DESC
          LIMIT $3 OFFSET $4`,
        [bankA, "open", 20, 0]
      );
      return res.rows;
    });
    expect(listByB).toHaveLength(0);
    // A armé VOIT bien SON anomalie ouverte.
    const seenByA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM ai_anomalies WHERE bank_id = $1 AND status = $2`,
        [bankA, "open"]
      );
      return res.rows;
    });
    expect(seenByA).toHaveLength(1);
    expect((seenByA[0] as { id: string }).id).toBe(anomalyA);
  }, 60_000);

  // ── feedback-insights-route.ts (extractFeedbackRows — SELECT tickets WHERE bank_id) ──
  it("SEC-002-CUTOVER-LOT6: GET /ai/feedback-insights — B armé ne voit PAS les feedbacks de A (extractFeedbackRows isolé)", async () => {
    // SQL EXACT d'`extractFeedbackRows` (scope agence) rejoué armé sur B en ciblant
    // bank_id=A + agency_id=A : la policy borne à B → 0 ligne.
    const rowsByB = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT t.feedback_score, t.feedback_comment
           FROM tickets t
          WHERE t.bank_id = $1
            AND t.agency_id = $4
            AND t.feedback_at IS NOT NULL
            AND (t.feedback_at AT TIME ZONE 'Africa/Abidjan')::date >= $2::date
            AND (t.feedback_at AT TIME ZONE 'Africa/Abidjan')::date <= $3::date`,
        [bankA, dayStart, dayEnd, agencyA]
      );
      return res.rows;
    });
    expect(rowsByB).toHaveLength(0);
    // A armé LIT bien SES feedbacks (le verbatim de A n'est visible que pour A).
    const rowsByA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT t.feedback_score, t.feedback_comment
           FROM tickets t
          WHERE t.bank_id = $1
            AND t.agency_id = $4
            AND t.feedback_at IS NOT NULL
            AND (t.feedback_at AT TIME ZONE 'Africa/Abidjan')::date >= $2::date
            AND (t.feedback_at AT TIME ZONE 'Africa/Abidjan')::date <= $3::date`,
        [bankA, dayStart, dayEnd, agencyA]
      );
      return res.rows;
    });
    expect(rowsByA).toHaveLength(1);
    expect((rowsByA[0] as { feedback_score: number }).feedback_score).toBe(5);
  }, 60_000);
});
