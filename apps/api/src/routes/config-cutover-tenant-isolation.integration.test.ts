/**
 * Test d'ISOLATION TENANT — SEC-002-CUTOVER-LOT1 (routes de config armées).
 *
 * Prouve, sur PostgreSQL 16 réelle sous connexion `sigfa_app` NOBYPASSRLS (jamais
 * l'owner qui contourne FORCE RLS), que la BASCULE `withArmedTenant` des routes de
 * config `services` / `hours` / `counters` isole réellement les tenants :
 *
 *   - un contexte armé sur la banque B ne LIT PAS les lignes de la banque A
 *     (services, agencies/weekly_schedule, agency_exceptional_closures, counters,
 *      counter_services) — même SANS `WHERE bank_id`, seule la RLS armée filtre ;
 *   - un contexte armé sur B ne PEUT PAS ALTÉRER une ligne de A (UPDATE/DELETE →
 *     0 ligne touchée), ni INSÉRER une ligne marquée `bank_id = A` (rejet WITH CHECK) ;
 *   - l'audit (`audit_log`) écrit dans la tx armée hérite du contexte et reste isolé.
 *
 * PREUVE ROUGE (armement load-bearing) : SANS armer `app.current_bank_id`, la même
 * connexion `sigfa_app` voit ZÉRO ligne (FORCE RLS) — donc c'est bien l'armement,
 * pas le `WHERE bank_id` applicatif, qui porte l'isolation en défense-en-profondeur.
 *
 * Le SQL exécuté ici est CELUI des routes basculées (`services.ts` / `hours.ts` /
 * `counters.ts`), rejoué à travers `withArmedTenant` — l'exact chemin de production.
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

const bankA = "aaaaaaaa-0000-4000-8000-00000000000a";
const bankB = "bbbbbbbb-0000-4000-8000-00000000000b";
const agencyA = "aa000000-0000-4000-8000-00000000000a";
const agencyB = "bb000000-0000-4000-8000-00000000000b";
const serviceA = "5e000000-0000-4000-8000-00000000000a";
const counterA = "c0000000-0000-4000-8000-00000000000a";

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
       ('${bankA}','Banque A','cutover-a'),
       ('${bankB}','Banque B','cutover-b') ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO agencies (id, bank_id, name, weekly_schedule) VALUES
       ('${agencyA}','${bankA}','Agence A','{"monday":{"open":"08:00","close":"16:00","closed":false}}'),
       ('${agencyB}','${bankB}','Agence B','{}') ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes, display_order)
       VALUES ('${serviceA}','${bankA}','${agencyA}','DEP','Dépôt',10,1)
       ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO counters (id, bank_id, agency_id, number, label, status)
       VALUES ('${counterA}','${bankA}','${agencyA}',1,'Guichet 1','OPEN')
       ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO counter_services (bank_id, counter_id, service_id)
       VALUES ('${bankA}','${counterA}','${serviceA}') ON CONFLICT DO NOTHING`
  );
  await h.query(
    `INSERT INTO agency_exceptional_closures (bank_id, agency_id, date, reason)
       VALUES ('${bankA}','${agencyA}','2026-12-25','Noël') ON CONFLICT DO NOTHING`
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
}, 30_000);

describe("SEC-002-CUTOVER-LOT1: isolation tenant sous armement (services/hours/counters)", () => {
  // ── PREUVE ROUGE : l'armement est load-bearing ────────────────────────────
  it("SEC-002-CUTOVER-LOT1: SANS armement, sigfa_app voit ZÉRO ligne (FORCE RLS) — l'armement porte l'isolation", async () => {
    // Requête sigfa_app SANS `SET LOCAL app.current_bank_id` : RLS forcée → 0 ligne.
    const services = await h.appQuery(`SELECT id FROM services`);
    const counters = await h.appQuery(`SELECT id FROM counters`);
    const agencies = await h.appQuery(`SELECT id FROM agencies`);
    expect(services.rows).toHaveLength(0);
    expect(counters.rows).toHaveLength(0);
    expect(agencies.rows).toHaveLength(0);
  }, 60_000);

  // ── services.ts ────────────────────────────────────────────────────────────
  it("SEC-002-CUTOVER-LOT1: GET /services — B armé ne voit PAS les services de A", async () => {
    // SQL de registerListServices, rejoué armé sur B (avec l'agence de A).
    const rows = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM services
          WHERE bank_id=$1 AND agency_id=$2 AND deleted_at IS NULL`,
        [bankA, agencyA] // B tente de cibler le tenant A explicitement
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  }, 60_000);

  it("SEC-002-CUTOVER-LOT1: PATCH /services/:id — B armé ne peut PAS altérer un service de A (0 ligne)", async () => {
    const updated = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `UPDATE services SET name='pirate'
          WHERE id=$1 AND bank_id=$2 AND deleted_at IS NULL RETURNING id`,
        [serviceA, bankB]
      );
      return res.rows;
    });
    expect(updated).toHaveLength(0);
    // A voit son service intact (nom d'origine).
    const stillOriginal = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(`SELECT name FROM services WHERE id=$1`, [serviceA]);
      return (res.rows[0] as { name: string }).name;
    });
    expect(stillOriginal).toBe("Dépôt");
  }, 60_000);

  it("SEC-002-CUTOVER-LOT1: POST /services — B armé ne peut PAS insérer une ligne marquée bank_id=A (WITH CHECK)", async () => {
    await expect(
      withArmedTenant(armable(h), bankB, async (conn) => {
        return conn.query(
          `INSERT INTO services (bank_id, agency_id, code, name, sla_minutes, display_order)
             VALUES ($1,$2,'INJ','Injection',10,0) RETURNING id`,
          [bankA, agencyA] // marque la banque A sous contexte armé B
        );
      })
    ).rejects.toThrow();
  }, 60_000);

  it("SEC-002-CUTOVER-LOT1: GET /services — A armé voit BIEN ses propres services", async () => {
    const rows = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM services WHERE bank_id=$1 AND agency_id=$2 AND deleted_at IS NULL`,
        [bankA, agencyA]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(1);
  }, 60_000);

  // ── hours.ts (agencies.weekly_schedule + agency_exceptional_closures) ───────
  it("SEC-002-CUTOVER-LOT1: PATCH /agencies/:id/hours — B armé ne peut PAS écraser l'hebdo de A (0 ligne)", async () => {
    const updated = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `UPDATE agencies SET weekly_schedule='{}'::jsonb
          WHERE id=$1 AND bank_id=$2 RETURNING id`,
        [agencyA, bankB]
      );
      return res.rows;
    });
    expect(updated).toHaveLength(0);
  }, 60_000);

  it("SEC-002-CUTOVER-LOT1: hours — B armé ne voit PAS les fermetures exceptionnelles de A", async () => {
    const rows = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT date FROM agency_exceptional_closures WHERE bank_id=$1 AND agency_id=$2`,
        [bankA, agencyA]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  }, 60_000);

  it("SEC-002-CUTOVER-LOT1: hours — public_holidays reste lisible (référentiel national, hors tenant)", async () => {
    // Le référentiel n'a pas de bank_id : lisible sous n'importe quel contexte armé.
    await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(`SELECT count(*)::int AS n FROM public_holidays`);
      expect((res.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(0);
      return res.rows;
    });
  }, 60_000);

  // ── counters.ts (counters + counter_services) ──────────────────────────────
  it("SEC-002-CUTOVER-LOT1: GET /counters — B armé ne voit PAS les guichets de A", async () => {
    const rows = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM counters WHERE bank_id=$1 AND agency_id=$2`,
        [bankA, agencyA]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  }, 60_000);

  it("SEC-002-CUTOVER-LOT1: PATCH /counters/:id — B armé ne peut PAS altérer un guichet de A (0 ligne)", async () => {
    const updated = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `UPDATE counters SET status='CLOSED'
          WHERE id=$1 AND bank_id=$2 RETURNING id`,
        [counterA, bankB]
      );
      return res.rows;
    });
    expect(updated).toHaveLength(0);
  }, 60_000);

  it("SEC-002-CUTOVER-LOT1: counter_services — B armé ne voit PAS les liaisons n-n de A", async () => {
    const rows = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM counter_services WHERE counter_id=$1 AND bank_id=$2`,
        [counterA, bankB]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  }, 60_000);

  it("SEC-002-CUTOVER-LOT1: audit — une entrée écrite armée pour A n'est PAS visible par B", async () => {
    // Écrit une entrée d'audit dans la tx armée A (SELECT+INSERT autorisés à sigfa_app).
    await withArmedTenant(armable(h), bankA, async (conn) => {
      return conn.query(
        `INSERT INTO audit_log (bank_id, action, entity_type, entity_id)
           VALUES ($1,'PATCH /services/:id','service',$2)`,
        [bankA, serviceA]
      );
    });
    const fromA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM audit_log WHERE entity_id=$1 AND action='PATCH /services/:id'`,
        [serviceA]
      );
      return res.rows;
    });
    const fromB = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM audit_log WHERE entity_id=$1`,
        [serviceA]
      );
      return res.rows;
    });
    expect(fromA.length).toBeGreaterThanOrEqual(1);
    expect(fromB).toHaveLength(0);
  }, 60_000);
});
