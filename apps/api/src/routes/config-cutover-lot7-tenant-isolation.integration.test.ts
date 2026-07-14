/**
 * Test d'ISOLATION TENANT — SEC-002-CUTOVER-LOT7 (surfaces à token/session armées).
 *
 * Prouve, sur PostgreSQL 16 réelle sous connexion `sigfa_app` NOBYPASSRLS (jamais
 * l'owner qui contourne FORCE RLS), que la BASCULE `withArmedTenant` des routes
 * `public-tickets` / `tv-session` / `kiosk-session` isole réellement les tenants.
 * Le `bank_id` (tenant) de ces surfaces est RÉSOLU depuis un token/une session
 * (ticket public, session TV, session borne), PAS depuis une auth staff : le test
 * rejoue le SQL EXACT des chemins ARMÉS post-résolution à travers `withArmedTenant`
 * et vérifie qu'une session/token du tenant A ne donne accès qu'aux données de A —
 * B n'atteint JAMAIS A, et A ne fuit rien de B.
 *
 *   - tv-session.ts : la CONFIRMATION armée de l'agence (`SELECT id FROM agencies`)
 *     rejouée armée sur B en ciblant l'agence de A → 0 ligne (une session TV ne
 *     confirme QUE ses propres agences) ; A confirme bien la sienne.
 *   - kiosk-session.ts : le heartbeat armé (UPDATE `kiosks` … FROM subselect) rejoué
 *     armé sur B → n'altère PAS la borne de A (0 ligne) ; la révocation armée
 *     (UPDATE `kiosks` … WHERE bank_id) idem ; l'audit d'ouverture marqué `bank_id=A`
 *     est REJETÉ (WITH CHECK) sous armement B.
 *   - public-tickets.ts : le feedback armé (UPDATE `tickets` … feedback_score) rejoué
 *     armé sur B ne touche PAS le ticket clos de A (0 ligne) ; l'agrégat NPS
 *     (INSERT `daily_agency_stats` marqué `bank_id=A`) est REJETÉ (WITH CHECK) sous
 *     armement B ; la lecture publique d'opérations (`operations` JOIN `services`)
 *     armée sur B ne voit PAS les opérations de A.
 *
 * COUTURE DB COMPLÈTE : toutes les tables touchées (agencies, kiosks, tickets,
 * daily_agency_stats, operations, services, audit_log) portent `tenant_isolation`
 * (FORCE RLS) + le GRANT CRUD `sigfa_app` (0001/0003/0005/0009). Le SQL exécuté ici
 * est CELUI des routes basculées, rejoué à travers `withArmedTenant` — l'exact
 * chemin de production POST-résolution du token.
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

const bankA = "aaaaaaaa-0000-4000-8000-0000000000a7";
const bankB = "bbbbbbbb-0000-4000-8000-0000000000b7";
const agencyA = "aa000000-0000-4000-8000-0000000000a7";
const agencyB = "bb000000-0000-4000-8000-0000000000b7";
const serviceA = "5e000000-0000-4000-8000-0000000000a7";
const serviceB = "5e000000-0000-4000-8000-0000000000b7";
const queueA = "40000000-0000-4000-8000-0000000000a7";
const kioskA = "c1000000-0000-4000-8000-0000000000a7";
const kioskB = "c1000000-0000-4000-8000-0000000000b7";
const operationA = "09000000-0000-4000-8000-0000000000a7";
const ticketA = "71000000-0000-4000-8000-0000000000a7";

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
       ('${bankA}','Banque A','cutover7-a'),
       ('${bankB}','Banque B','cutover7-b') ON CONFLICT (id) DO NOTHING`
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
       ('${queueA}','${bankA}','${agencyA}','${serviceA}','OPEN') ON CONFLICT (id) DO NOTHING`
  );
  // Une opération active chez A (lue par GET /public/agencies/:id/operations).
  await h.query(
    `INSERT INTO operations (id, bank_id, agency_id, service_id, code, name, is_active, display_order)
       VALUES ('${operationA}','${bankA}','${agencyA}','${serviceA}','DEPCSH','Dépôt espèces',true,1)
       ON CONFLICT (id) DO NOTHING`
  );
  // Une borne chez A et une chez B (heartbeat / révocation armés).
  await h.query(
    `INSERT INTO kiosks (id, bank_id, agency_id, label, credentials_hash, printer_status)
       VALUES
       ('${kioskA}','${bankA}','${agencyA}','Borne A','hash-a','OK'),
       ('${kioskB}','${bankB}','${agencyB}','Borne B','hash-b','OK')
       ON CONFLICT (id) DO NOTHING`
  );
  // Un ticket CLOS de A éligible au feedback public (24 h non expirée).
  await h.query(
    `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, tracking_id, channel, status, closed_at)
       VALUES ('${ticketA}','${bankA}','${agencyA}','${queueA}','${serviceA}',1,'trk-cutover7-a-000001','KIOSK','DONE', now())
       ON CONFLICT (id) DO NOTHING`
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
}, 30_000);

describe("SEC-002-CUTOVER-LOT7: isolation tenant sous armement (public-tickets/tv-session/kiosk-session)", () => {
  // ── PREUVE ROUGE : l'armement est load-bearing ──────────────────────────────
  it("SEC-002-CUTOVER-LOT7: SANS armement, sigfa_app voit ZÉRO ligne (FORCE RLS) — l'armement porte l'isolation", async () => {
    const kiosks = await h.appQuery(`SELECT id FROM kiosks`);
    const tickets = await h.appQuery(`SELECT id FROM tickets`);
    const agencies = await h.appQuery(`SELECT id FROM agencies`);
    const operations = await h.appQuery(`SELECT id FROM operations`);
    expect(kiosks.rows).toHaveLength(0);
    expect(tickets.rows).toHaveLength(0);
    expect(agencies.rows).toHaveLength(0);
    expect(operations.rows).toHaveLength(0);
  }, 60_000);

  // ── tv-session.ts (confirmation armée de l'agence) ──────────────────────────
  it("SEC-002-CUTOVER-LOT7: POST /tv/session — B armé ne confirme PAS l'agence de A (assertAgencyInArmedTenant isolé)", async () => {
    // SQL EXACT de la confirmation armée (`SELECT id FROM agencies …`) rejoué sur B
    // en ciblant l'agence de A → 0 ligne (RLS borne à B).
    const seenByB = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM agencies
          WHERE id = $1 AND is_active = true AND deleted_at IS NULL`,
        [agencyA]
      );
      return res.rows;
    });
    expect(seenByB).toHaveLength(0);
    // A armé confirme bien SA propre agence.
    const seenByA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM agencies
          WHERE id = $1 AND is_active = true AND deleted_at IS NULL`,
        [agencyA]
      );
      return res.rows;
    });
    expect(seenByA).toHaveLength(1);
  }, 60_000);

  // ── kiosk-session.ts (heartbeat armé — UPDATE kiosks isolé) ─────────────────
  it("SEC-002-CUTOVER-LOT7: POST /kiosks/:id/heartbeat — B armé ne peut PAS mettre à jour la borne de A (0 ligne)", async () => {
    // SQL EXACT d'`applyHeartbeat` rejoué armé sur B en ciblant la borne de A → 0 ligne.
    const updated = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `UPDATE kiosks AS k
            SET printer_status = $2::printer_status,
                app_version = $3,
                last_seen = now(),
                updated_at = now()
           FROM (SELECT id, printer_status AS previous_status FROM kiosks WHERE id = $1) AS old
          WHERE k.id = old.id
          RETURNING k.id`,
        [kioskA, "ERROR", "9.9.9"]
      );
      return res.rows;
    });
    expect(updated).toHaveLength(0);
    // A armé met bien à jour SA borne.
    const byA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `UPDATE kiosks AS k
            SET printer_status = $2::printer_status,
                app_version = $3,
                last_seen = now(),
                updated_at = now()
           FROM (SELECT id, printer_status AS previous_status FROM kiosks WHERE id = $1) AS old
          WHERE k.id = old.id
          RETURNING k.id`,
        [kioskA, "PAPER_LOW", "1.0.0"]
      );
      return res.rows;
    });
    expect(byA).toHaveLength(1);
  }, 60_000);

  // ── kiosk-session.ts (révocation armée — UPDATE kiosks WHERE bank_id) ────────
  it("SEC-002-CUTOVER-LOT7: DELETE /kiosk/session/:id — B armé ne peut PAS révoquer la borne de A (0 ligne)", async () => {
    // SQL EXACT de `revokeKioskSession` rejoué armé sur B en ciblant A → 0 ligne.
    const revoked = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `UPDATE kiosks SET session_revoked_at = now(), updated_at = now()
          WHERE id = $1 AND bank_id = $2
          RETURNING id`,
        [kioskA, bankA]
      );
      return res.rows;
    });
    expect(revoked).toHaveLength(0);
  }, 60_000);

  // ── kiosk-session.ts (audit d'ouverture — WITH CHECK cross-tenant rejeté) ────
  it("SEC-002-CUTOVER-LOT7: POST /kiosk/session — B armé ne peut PAS écrire un audit_log marqué bank_id=A (WITH CHECK)", async () => {
    await expect(
      withArmedTenant(armable(h), bankB, async (conn) => {
        return conn.query(
          `INSERT INTO audit_log (bank_id, action, entity_type, entity_id, diff)
           VALUES ('${bankA}', 'POST /kiosk/session', 'kiosk', '${kioskA}', '{"after":{"sessionOpened":true}}'::jsonb)`
        );
      })
    ).rejects.toThrow();
  }, 60_000);

  // ── public-tickets.ts (feedback armé — UPDATE tickets isolé) ────────────────
  it("SEC-002-CUTOVER-LOT7: POST /public/tickets/:trackingId/feedback — B armé ne touche PAS le ticket clos de A (0 ligne)", async () => {
    // SQL EXACT de `persistFeedback` rejoué armé sur B en ciblant le ticket de A → 0 ligne.
    const applied = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `UPDATE tickets
            SET feedback_score = $2, feedback_comment = $3, feedback_at = now(), updated_at = now()
          WHERE id = $1
            AND status = 'DONE'
            AND feedback_score IS NULL
            AND NOW() - closed_at <= INTERVAL '24 hours'
          RETURNING id`,
        [ticketA, 5, null]
      );
      return res.rows;
    });
    expect(applied).toHaveLength(0);
    // A armé applique bien le feedback sur SON ticket.
    const byA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `UPDATE tickets
            SET feedback_score = $2, feedback_comment = $3, feedback_at = now(), updated_at = now()
          WHERE id = $1
            AND status = 'DONE'
            AND feedback_score IS NULL
            AND NOW() - closed_at <= INTERVAL '24 hours'
          RETURNING id`,
        [ticketA, 4, null]
      );
      return res.rows;
    });
    expect(byA).toHaveLength(1);
  }, 60_000);

  // ── public-tickets.ts (agrégat NPS — WITH CHECK cross-tenant rejeté) ─────────
  it("SEC-002-CUTOVER-LOT7: feedback — B armé ne peut PAS insérer un daily_agency_stats marqué bank_id=A (WITH CHECK)", async () => {
    // SQL EXACT d'`upsertAggregate` (agrégat toutes-services) rejoué armé sur B en
    // marquant bank_id=A → rejet WITH CHECK (B ne peut pas agréger pour A).
    await expect(
      withArmedTenant(armable(h), bankB, async (conn) => {
        return conn.query(
          `INSERT INTO daily_agency_stats
             (bank_id, agency_id, service_id, day, feedback_count, feedback_sum, nps_promoters, updated_at)
           VALUES ($1, $2, $3, (now() AT TIME ZONE 'Africa/Abidjan')::date, 1, $4, 1, now())`,
          [bankA, agencyA, null, 5]
        );
      })
    ).rejects.toThrow();
  }, 60_000);

  // ── public-tickets.ts (lecture publique operations armée — isolée) ──────────
  it("SEC-002-CUTOVER-LOT7: GET /public/agencies/:id/operations — B armé ne voit PAS les opérations de A", async () => {
    // SQL EXACT de la lecture armée (`operations` JOIN `services`) rejoué sur B en
    // ciblant l'agence/service de A → 0 ligne (RLS operations bornée à B).
    const seenByB = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT o.id
           FROM operations o JOIN services s ON s.id = o.service_id
          WHERE o.agency_id = $1 AND o.service_id = $2 AND o.is_active = true`,
        [agencyA, serviceA]
      );
      return res.rows;
    });
    expect(seenByB).toHaveLength(0);
    // A armé voit bien SON opération active.
    const seenByA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT o.id
           FROM operations o JOIN services s ON s.id = o.service_id
          WHERE o.agency_id = $1 AND o.service_id = $2 AND o.is_active = true`,
        [agencyA, serviceA]
      );
      return res.rows;
    });
    expect(seenByA).toHaveLength(1);
  }, 60_000);
});
