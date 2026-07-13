/**
 * Test d'ISOLATION TENANT — SEC-002-CUTOVER-LOT2 (routes config/notifications armées).
 *
 * Prouve, sur PostgreSQL 16 réelle sous connexion `sigfa_app` NOBYPASSRLS (jamais
 * l'owner qui contourne FORCE RLS), que la BASCULE `withArmedTenant` des routes
 * `sms-templates` / `devices` / `kiosks-status` isole réellement les tenants :
 *
 *   - un contexte armé sur la banque B ne LIT PAS les lignes de la banque A
 *     (notification_templates, notification_devices, kiosks) — même en ciblant
 *     explicitement l'id/bank_id de A, seule la RLS armée filtre ;
 *   - un contexte armé sur B ne PEUT PAS ALTÉRER une ligne de A : upsert d'un template
 *     de A (0 ligne visible), suppression d'un device de A (0 ligne) ;
 *   - un contexte armé sur B ne PEUT PAS insérer une ligne marquée `bank_id = A`
 *     (rejet WITH CHECK) sur notification_templates.
 *
 * PREUVE ROUGE (armement load-bearing) : SANS armer `app.current_bank_id`, la même
 * connexion `sigfa_app` voit ZÉRO ligne (FORCE RLS) — c'est bien l'armement, pas le
 * `WHERE bank_id` applicatif, qui porte l'isolation en défense-en-profondeur.
 *
 * COUTURE DB DÉBLOQUÉE par lot 3 — `thresholds.ts` est désormais ARMÉE : la migration
 * 0015 (SEC-002-CUTOVER-LOT3) ajoute `updated_at` au GRANT UPDATE colonne-scopé de
 * `banks`. Le test ci-dessous, qui documentait le BLOCAGE au lot 2, vérifie maintenant
 * que le `UPDATE banks … SET updated_at=NOW()` RÉUSSIT sous armement sur la propre
 * ligne du tenant (cf. arch test + config-cutover-lot3-tenant-isolation).
 *
 * Le SQL exécuté ici est CELUI des routes basculées, rejoué à travers
 * `withArmedTenant` — l'exact chemin de production.
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

const bankA = "aaaaaaaa-0000-4000-8000-0000000000a2";
const bankB = "bbbbbbbb-0000-4000-8000-0000000000b2";
const agencyA = "aa000000-0000-4000-8000-0000000000a2";
const agencyB = "bb000000-0000-4000-8000-0000000000b2";
const kioskA = "c0000000-0000-4000-8000-0000000000a2";
const deviceTokenA = "device-token-tenant-a-secret";

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
    `INSERT INTO banks (id, name, slug, queue_critical_threshold, agent_inactivity_minutes, no_show_timeout_minutes)
       VALUES
       ('${bankA}','Banque A','cutover2-a', 50, 15, 10),
       ('${bankB}','Banque B','cutover2-b', 50, 15, 10) ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO agencies (id, bank_id, name, weekly_schedule) VALUES
       ('${agencyA}','${bankA}','Agence A','{}'),
       ('${agencyB}','${bankB}','Agence B','{}') ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO kiosks (id, bank_id, agency_id, label, credentials_hash, printer_status)
       VALUES ('${kioskA}','${bankA}','${agencyA}','Borne A','x','OK')
       ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO notification_templates (bank_id, type, channel, lang, body)
       VALUES ('${bankA}','TICKET_CONFIRMATION','SMS','FR','Ticket {{number}} de A')
       ON CONFLICT (bank_id, type, channel, lang) DO NOTHING`
  );
  await h.query(
    `INSERT INTO notification_devices (bank_id, device_token, platform)
       VALUES ('${bankA}','${deviceTokenA}','ANDROID') ON CONFLICT (device_token) DO NOTHING`
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
}, 30_000);

describe("SEC-002-CUTOVER-LOT2: isolation tenant sous armement (sms/devices/kiosks-status)", () => {
  // ── PREUVE ROUGE : l'armement est load-bearing ──────────────────────────────
  it("SEC-002-CUTOVER-LOT2: SANS armement, sigfa_app voit ZÉRO ligne (FORCE RLS) — l'armement porte l'isolation", async () => {
    const templates = await h.appQuery(`SELECT id FROM notification_templates`);
    const devices = await h.appQuery(`SELECT id FROM notification_devices`);
    const kiosks = await h.appQuery(`SELECT id FROM kiosks`);
    expect(templates.rows).toHaveLength(0);
    expect(devices.rows).toHaveLength(0);
    expect(kiosks.rows).toHaveLength(0);
  }, 60_000);

  // ── COUTURE THRESHOLDS DÉBLOQUÉE par lot 3 (0015 : `updated_at` ajouté au GRANT) ──
  it("SEC-002-CUTOVER-LOT2: thresholds DÉBLOQUÉ — UPDATE banks touchant `updated_at` (accordé par 0015) réussit sous armement", async () => {
    // Rejoue EXACTEMENT le SQL de production `updateThresholds` (SET … updated_at=NOW())
    // sous armement de A (sa propre ligne). Au lot 2, ce chemin ÉCHOUAIT (`updated_at`
    // hors GRANT 0014). La migration 0015 (SEC-002-CUTOVER-LOT3) ajoute `updated_at`
    // au GRANT UPDATE colonne-scopé : l'UPDATE réussit désormais sur la propre ligne
    // du tenant (thresholds.ts est ARMÉE en lot 3 — cf. arch test + isolation lot3).
    const rows = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `UPDATE banks
            SET queue_critical_threshold = COALESCE($2, queue_critical_threshold),
                agent_inactivity_minutes = COALESCE($3, agent_inactivity_minutes),
                no_show_timeout_minutes = COALESCE($4, no_show_timeout_minutes),
                updated_at = NOW()
          WHERE id=$1 AND deleted_at IS NULL
          RETURNING queue_critical_threshold`,
        [bankA, 120, null, null]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(1);
    expect((rows[0] as { queue_critical_threshold: number }).queue_critical_threshold).toBe(120);
  }, 60_000);

  it("SEC-002-CUTOVER-LOT2: banks SELECT reste isolé sous armement — B ne voit PAS la ligne de A", async () => {
    // La lecture (loadThresholds) EST isolée par la policy SELECT `tenant_isolation`
    // de banks ; le chemin UPDATE est désormais armé et isolé (policy `tenant_update`).
    const rows = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT queue_critical_threshold FROM banks WHERE id=$1 AND deleted_at IS NULL`,
        [bankA]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  }, 60_000);

  // ── sms-templates.ts (notification_templates) ───────────────────────────────
  it("SEC-002-CUTOVER-LOT2: GET sms-templates — B armé ne voit PAS les templates de A", async () => {
    const rows = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT type, body FROM notification_templates
          WHERE bank_id=$1 AND channel=$2::notification_channel AND lang=$3
          ORDER BY type ASC`,
        [bankA, "SMS", "FR"]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  }, 60_000);

  it("SEC-002-CUTOVER-LOT2: PATCH sms-templates — B armé ne peut PAS écraser un template de A (upsert isolé)", async () => {
    // L'upsert de B (bank_id=B) ne matche PAS la ligne de A (RLS) → insère une ligne B.
    await withArmedTenant(armable(h), bankB, async (conn) => {
      return conn.query(
        `INSERT INTO notification_templates (bank_id, type, channel, lang, body)
         VALUES ($1, $2::notification_type, $3::notification_channel, $4, $5)
         ON CONFLICT (bank_id, type, channel, lang)
         DO UPDATE SET body = EXCLUDED.body, updated_at = NOW()`,
        [bankB, "TICKET_CONFIRMATION", "SMS", "FR", "Ticket {{number}} de B"]
      );
    });
    // La ligne de A garde son corps d'origine (invisible + intacte pour B).
    const bodyA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT body FROM notification_templates
          WHERE bank_id=$1 AND type='TICKET_CONFIRMATION' AND channel='SMS' AND lang='FR'`,
        [bankA]
      );
      return (res.rows[0] as { body: string }).body;
    });
    expect(bodyA).toBe("Ticket {{number}} de A");
  }, 60_000);

  it("SEC-002-CUTOVER-LOT2: PATCH sms-templates — B armé ne peut PAS insérer un template marqué bank_id=A (WITH CHECK)", async () => {
    await expect(
      withArmedTenant(armable(h), bankB, async (conn) => {
        return conn.query(
          `INSERT INTO notification_templates (bank_id, type, channel, lang, body)
           VALUES ($1, $2::notification_type, $3::notification_channel, $4, $5)`,
          [bankA, "YOUR_TURN", "SMS", "FR", "injection"]
        );
      })
    ).rejects.toThrow();
  }, 60_000);

  // ── devices.ts (notification_devices) ───────────────────────────────────────
  it("SEC-002-CUTOVER-LOT2: DELETE device — B armé ne peut PAS supprimer un device de A (0 ligne)", async () => {
    const deleted = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `DELETE FROM notification_devices WHERE bank_id=$1 AND device_token=$2 RETURNING id`,
        [bankB, deviceTokenA]
      );
      return res.rows;
    });
    expect(deleted).toHaveLength(0);
    // A voit toujours son device (invisible + intact pour B).
    const stillThere = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM notification_devices WHERE device_token=$1`,
        [deviceTokenA]
      );
      return res.rows;
    });
    expect(stillThere).toHaveLength(1);
  }, 60_000);

  it("SEC-002-CUTOVER-LOT2: POST device — B armé ne voit PAS le device de A (token invisible sous RLS)", async () => {
    const rows = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM notification_devices WHERE device_token=$1`,
        [deviceTokenA]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  }, 60_000);

  // ── kiosks-status.ts (kiosks) ───────────────────────────────────────────────
  it("SEC-002-CUTOVER-LOT2: GET /kiosks/status — B armé ne voit PAS les bornes de A", async () => {
    // SQL de kiosks-status, rejoué armé sur B en ciblant le bank_id de A.
    const rows = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT id AS kiosk_id, agency_id, last_seen, printer_status,
                (last_seen IS NULL OR last_seen < NOW() - ($2 || ' seconds')::interval)
                  AS is_silent
           FROM kiosks WHERE bank_id = $1
          ORDER BY created_at ASC`,
        [bankA, "180"]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  }, 60_000);

  it("SEC-002-CUTOVER-LOT2: GET /kiosks/status — A armé voit BIEN sa borne", async () => {
    const rows = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM kiosks WHERE bank_id = $1 ORDER BY created_at ASC`,
        [bankA]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(1);
  }, 60_000);
});
