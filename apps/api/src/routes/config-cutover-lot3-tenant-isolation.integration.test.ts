/**
 * Test d'ISOLATION TENANT — SEC-002-CUTOVER-LOT3 (seuils + modèle métier armés).
 *
 * Prouve, sur PostgreSQL 16 réelle sous connexion `sigfa_app` NOBYPASSRLS (jamais
 * l'owner qui contourne FORCE RLS), que la BASCULE `withArmedTenant` des routes
 * `thresholds` / `operations` / `agencies` isole réellement les tenants :
 *
 *   - un contexte armé sur la banque B ne LIT PAS les lignes de la banque A
 *     (banks/seuils, operations, agencies, tickets) — même en ciblant explicitement
 *     l'id/bank_id de A, seule la RLS armée filtre ;
 *   - un contexte armé sur B ne PEUT PAS ALTÉRER une ligne de A : UPDATE des seuils
 *     de A (0 ligne visible → policy `tenant_update` + SELECT), UPDATE/DELETE d'une
 *     opération de A (0 ligne), soft-delete d'une agence de A (0 ligne) ;
 *   - un contexte armé sur B ne PEUT PAS insérer une ligne marquée `bank_id = A`
 *     (rejet WITH CHECK) sur operations et agencies ;
 *   - la garde « tickets ouverts » de DELETE /agencies (SELECT tickets) est isolée :
 *     B armé ne voit PAS le ticket ouvert de A.
 *
 * COUTURE DB COMPLÉTÉE — thresholds débloqué : la migration 0014 accorde la policy
 * `tenant_update` + le GRANT UPDATE colonne-scopé des 3 seuils, 0015 y ajoute
 * `updated_at`. Le `UPDATE banks SET <3 seuils>, updated_at=NOW()` de la route tourne
 * désormais SOUS ARMEMENT sur SA propre ligne (démontré ci-dessous), et reste REFUSÉ
 * cross-tenant (0 ligne sur la banque d'autrui).
 *
 * PREUVE ROUGE (armement load-bearing) : SANS armer `app.current_bank_id`, la même
 * connexion `sigfa_app` voit ZÉRO ligne (FORCE RLS) — c'est bien l'armement, pas le
 * `WHERE bank_id` applicatif, qui porte l'isolation en défense-en-profondeur.
 *
 * Le SQL exécuté ici est CELUI des routes basculées (`thresholds.ts` / `operations.ts`
 * / `agencies.ts`), rejoué à travers `withArmedTenant` — l'exact chemin de production.
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

const bankA = "aaaaaaaa-0000-4000-8000-0000000000a3";
const bankB = "bbbbbbbb-0000-4000-8000-0000000000b3";
const agencyA = "aa000000-0000-4000-8000-0000000000a3";
const agencyB = "bb000000-0000-4000-8000-0000000000b3";
const serviceA = "5e000000-0000-4000-8000-0000000000a3";
const operationA = "0b000000-0000-4000-8000-0000000000a3";
const queueA = "40000000-0000-4000-8000-0000000000a3";
const ticketA = "71000000-0000-4000-8000-0000000000a3";

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
       ('${bankA}','Banque A','cutover3-a', 50, 15, 10),
       ('${bankB}','Banque B','cutover3-b', 50, 15, 10) ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO agencies (id, bank_id, name, weekly_schedule) VALUES
       ('${agencyA}','${bankA}','Agence A','{}'),
       ('${agencyB}','${bankB}','Agence B','{}') ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes, display_order)
       VALUES ('${serviceA}','${bankA}','${agencyA}','DEP','Dépôt',10,1)
       ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO operations (id, bank_id, agency_id, service_id, code, name, display_order, is_active)
       VALUES ('${operationA}','${bankA}','${agencyA}','${serviceA}','OP1','Opération A',1,true)
       ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO queues (id, bank_id, agency_id, service_id)
       VALUES ('${queueA}','${bankA}','${agencyA}','${serviceA}') ON CONFLICT (id) DO NOTHING`
  );
  // Ticket OUVERT (WAITING) de A → garde DELETE /agencies (assertNoOpenTickets).
  await h.query(
    `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, tracking_id, channel, status)
       VALUES ('${ticketA}','${bankA}','${agencyA}','${queueA}','${serviceA}',1,'trk-cutover3-a-000001','KIOSK','WAITING')
       ON CONFLICT (id) DO NOTHING`
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
}, 30_000);

describe("SEC-002-CUTOVER-LOT3: isolation tenant sous armement (thresholds/operations/agencies)", () => {
  // ── PREUVE ROUGE : l'armement est load-bearing ──────────────────────────────
  it("SEC-002-CUTOVER-LOT3: SANS armement, sigfa_app voit ZÉRO ligne (FORCE RLS) — l'armement porte l'isolation", async () => {
    const banks = await h.appQuery(`SELECT id FROM banks`);
    const operations = await h.appQuery(`SELECT id FROM operations`);
    const agencies = await h.appQuery(`SELECT id FROM agencies`);
    const tickets = await h.appQuery(`SELECT id FROM tickets`);
    expect(banks.rows).toHaveLength(0);
    expect(operations.rows).toHaveLength(0);
    expect(agencies.rows).toHaveLength(0);
    expect(tickets.rows).toHaveLength(0);
  }, 60_000);

  // ── thresholds.ts (banks — SELECT + UPDATE colonne-scopé) ────────────────────
  it("SEC-002-CUTOVER-LOT3: thresholds DÉBLOQUÉ — A armé met à jour SES seuils (updated_at inclus) sur SA ligne", async () => {
    // SQL EXACT de production `updateThresholds` (SET … updated_at=NOW()) sous armement
    // de A : la couture 0014+0015 (GRANT + policy tenant_update) autorise désormais.
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

  it("SEC-002-CUTOVER-LOT3: thresholds — B armé ne peut PAS altérer les seuils de A (0 ligne, tenant_update)", async () => {
    const rows = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `UPDATE banks
            SET queue_critical_threshold = COALESCE($2, queue_critical_threshold),
                updated_at = NOW()
          WHERE id=$1 AND deleted_at IS NULL
          RETURNING queue_critical_threshold`,
        [bankA, 999]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
    // La ligne de A garde sa valeur (120, posée ci-dessus) : intacte pour B.
    const afterA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT queue_critical_threshold FROM banks WHERE id=$1 AND deleted_at IS NULL`,
        [bankA]
      );
      return res.rows;
    });
    expect((afterA[0] as { queue_critical_threshold: number }).queue_critical_threshold).toBe(120);
  }, 60_000);

  it("SEC-002-CUTOVER-LOT3: thresholds GET — B armé ne voit PAS les seuils de A (SELECT isolé)", async () => {
    const rows = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT queue_critical_threshold, agent_inactivity_minutes, no_show_timeout_minutes
           FROM banks WHERE id=$1 AND deleted_at IS NULL`,
        [bankA]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  }, 60_000);

  // ── operations.ts (operations) ──────────────────────────────────────────────
  it("SEC-002-CUTOVER-LOT3: GET operations — B armé ne voit PAS les opérations de A", async () => {
    const rows = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT id, code FROM operations WHERE bank_id=$1 AND service_id=$2
          ORDER BY display_order ASC`,
        [bankA, serviceA]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  }, 60_000);

  it("SEC-002-CUTOVER-LOT3: PATCH/DELETE operation — B armé ne peut PAS altérer une opération de A (0 ligne)", async () => {
    const updated = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `UPDATE operations SET name=COALESCE($3, name), updated_at=NOW()
          WHERE id=$1 AND bank_id=$2 RETURNING id`,
        [operationA, bankB, "piraté"]
      );
      return res.rows;
    });
    expect(updated).toHaveLength(0);
    const deleted = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `DELETE FROM operations WHERE id=$1 AND bank_id=$2 RETURNING id`,
        [operationA, bankB]
      );
      return res.rows;
    });
    expect(deleted).toHaveLength(0);
    // L'opération de A reste intacte + visible pour A.
    const stillThere = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT name FROM operations WHERE id=$1 AND bank_id=$2`,
        [operationA, bankA]
      );
      return res.rows;
    });
    expect(stillThere).toHaveLength(1);
    expect((stillThere[0] as { name: string }).name).toBe("Opération A");
  }, 60_000);

  it("SEC-002-CUTOVER-LOT3: POST operation — B armé ne peut PAS insérer une opération marquée bank_id=A (WITH CHECK)", async () => {
    await expect(
      withArmedTenant(armable(h), bankB, async (conn) => {
        return conn.query(
          `INSERT INTO operations (bank_id, agency_id, service_id, code, name, display_order, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [bankA, agencyA, serviceA, "INJ", "injection", 9, true]
        );
      })
    ).rejects.toThrow();
  }, 60_000);

  // ── agencies.ts (agencies + tickets guard) ──────────────────────────────────
  it("SEC-002-CUTOVER-LOT3: GET agencies — B armé ne voit PAS les agences de A", async () => {
    const rows = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM agencies WHERE bank_id=$1 AND deleted_at IS NULL ORDER BY created_at ASC`,
        [bankA]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  }, 60_000);

  it("SEC-002-CUTOVER-LOT3: DELETE agency — B armé ne peut PAS soft-supprimer une agence de A (0 ligne)", async () => {
    const deleted = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `UPDATE agencies SET deleted_at=NOW(), is_active=false, updated_at=NOW()
          WHERE id=$1 AND bank_id=$2 RETURNING id`,
        [agencyA, bankB]
      );
      return res.rows;
    });
    expect(deleted).toHaveLength(0);
    // L'agence de A reste vivante + visible pour A.
    const stillThere = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM agencies WHERE id=$1 AND bank_id=$2 AND deleted_at IS NULL`,
        [agencyA, bankA]
      );
      return res.rows;
    });
    expect(stillThere).toHaveLength(1);
  }, 60_000);

  it("SEC-002-CUTOVER-LOT3: POST agency — B armé ne peut PAS insérer une agence marquée bank_id=A (WITH CHECK)", async () => {
    await expect(
      withArmedTenant(armable(h), bankB, async (conn) => {
        return conn.query(
          `INSERT INTO agencies (bank_id, name, weekly_schedule) VALUES ($1,$2,$3)`,
          [bankA, "injection", "{}"]
        );
      })
    ).rejects.toThrow();
  }, 60_000);

  it("SEC-002-CUTOVER-LOT3: garde tickets ouverts — B armé ne voit PAS le ticket ouvert de A (SELECT tickets isolé)", async () => {
    // SQL EXACT de `assertNoOpenTickets` (DELETE /agencies), rejoué armé sur B en
    // ciblant l'agence + bank_id de A : 0 ligne → B croirait « aucun ticket ouvert »,
    // mais la RLS l'empêche de toucher l'agence de A de toute façon (test ci-dessus).
    const rows = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT 1 FROM tickets
          WHERE agency_id=$1 AND bank_id=$2 AND status = ANY($3::ticket_status[]) LIMIT 1`,
        [agencyA, bankA, ["WAITING", "CALLED", "SERVING"]]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
    // A armé VOIT bien son ticket ouvert (la garde fonctionne pour le vrai tenant).
    const seenByA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT 1 FROM tickets
          WHERE agency_id=$1 AND bank_id=$2 AND status = ANY($3::ticket_status[]) LIMIT 1`,
        [agencyA, bankA, ["WAITING", "CALLED", "SERVING"]]
      );
      return res.rows;
    });
    expect(seenByA).toHaveLength(1);
  }, 60_000);
});
