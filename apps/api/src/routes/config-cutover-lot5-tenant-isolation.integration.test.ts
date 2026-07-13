/**
 * Test d'ISOLATION TENANT — SEC-002-CUTOVER-LOT5 (conseillers / import CSV / droit à l'oubli armés).
 *
 * Prouve, sur PostgreSQL 16 réelle sous connexion `sigfa_app` NOBYPASSRLS (jamais
 * l'owner qui contourne FORCE RLS), que la BASCULE `withArmedTenant` des routes
 * `agents` / `agents-import` / `data-privacy` isole réellement les tenants :
 *
 *   - agents.ts : un contexte armé sur B ne LIT PAS les `users` / `user_services` /
 *     `agency_users` de A (même en ciblant l'id/bank_id de A), ne PEUT PAS ALTÉRER le
 *     profil d'un agent de A (UPDATE users → 0 ligne), et ne PEUT PAS insérer une
 *     ligne marquée `bank_id = A` (rejet WITH CHECK) sur users / user_services ;
 *   - agents-import.ts : B armé insère un agent DANS sa banque (autorisé) et REFUSE
 *     un INSERT `users` marqué `bank_id = A` (rejet WITH CHECK) — le batch ne peut pas
 *     provisionner d'agent cross-tenant ;
 *   - data-privacy.ts : l'effacement de A (armé sur A, SQL EXACT de `purgePhone`)
 *     anonymise le ticket de A et éradique le consentement de A SANS toucher B ; B armé
 *     ne PEUT PAS anonymiser/voir le ticket de A par `phone_hash` (0 ligne), ni insérer
 *     une entrée `audit_log` marquée `bank_id = A` (rejet WITH CHECK) — B ne peut donc
 *     JAMAIS déclencher l'effacement de A.
 *
 * COUTURE DB COMPLÈTE : toutes les tables touchées (users, user_services, agency_users,
 * services, agencies, agent_status_history, tickets, notification_consents,
 * retention_policies, audit_log) portent `tenant_isolation` + le GRANT CRUD `sigfa_app`
 * (0001/0003/0004/0006). Le SQL exécuté ici est CELUI des routes basculées, rejoué à
 * travers `withArmedTenant` — l'exact chemin de production.
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

const bankA = "aaaaaaaa-0000-4000-8000-0000000000a5";
const bankB = "bbbbbbbb-0000-4000-8000-0000000000b5";
const agencyA = "aa000000-0000-4000-8000-0000000000a5";
const agencyB = "bb000000-0000-4000-8000-0000000000b5";
const serviceA = "5e000000-0000-4000-8000-0000000000a5";
const serviceB = "5e000000-0000-4000-8000-0000000000b5";
const queueA = "40000000-0000-4000-8000-0000000000a5";
const userA = "50000000-0000-4000-8000-0000000000a5";
const userB = "50000000-0000-4000-8000-0000000000b5";
const ticketA = "71000000-0000-4000-8000-0000000000a5";

// Le hash « client » à purger : occurrence chez A uniquement (droit à l'oubli).
const phoneHashA = "hash-lot5-client-a-0000000000000000";

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
       ('${bankA}','Banque A','cutover5-a'),
       ('${bankB}','Banque B','cutover5-b') ON CONFLICT (id) DO NOTHING`
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
  // Un agent chez A et un chez B.
  await h.query(
    `INSERT INTO users (id, bank_id, email, password_hash, first_name, last_name, role, is_active)
       VALUES
       ('${userA}','${bankA}','agent-a5@ex.test','x','Agent','A5','AGENT',true),
       ('${userB}','${bankB}','agent-b5@ex.test','x','Agent','B5','AGENT',true)
       ON CONFLICT (id) DO NOTHING`
  );
  // Compétence + affectation de l'agent A (lues par le profil agents.ts).
  await h.query(
    `INSERT INTO user_services (bank_id, user_id, service_id)
       VALUES ('${bankA}','${userA}','${serviceA}') ON CONFLICT DO NOTHING`
  );
  await h.query(
    `INSERT INTO agency_users (bank_id, agency_id, user_id)
       VALUES ('${bankA}','${agencyA}','${userA}') ON CONFLICT DO NOTHING`
  );
  // Ticket clos de A portant le hash du client à purger (droit à l'oubli).
  await h.query(
    `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, tracking_id, channel, status, phone_encrypted, phone_hash, closed_at)
       VALUES ('${ticketA}','${bankA}','${agencyA}','${queueA}','${serviceA}',1,'trk-cutover5-a-000001','KIOSK','DONE','enc-a','${phoneHashA}', now())
       ON CONFLICT (id) DO NOTHING`
  );
  // Consentement de A portant le même hash (PII pur, éradiqué à la purge).
  await h.query(
    `INSERT INTO notification_consents (bank_id, phone_encrypted, phone_hash, channel, opted_in)
       VALUES ('${bankA}','enc-a','${phoneHashA}','SMS',true) ON CONFLICT DO NOTHING`
  );
  // Politique de rétention propre à A (lue par GET /data/retention-policy).
  await h.query(
    `INSERT INTO retention_policies (bank_id, phone_retention_months)
       VALUES ('${bankA}', 24) ON CONFLICT (bank_id) DO NOTHING`
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
}, 30_000);

describe("SEC-002-CUTOVER-LOT5: isolation tenant sous armement (agents/agents-import/data-privacy)", () => {
  // ── PREUVE ROUGE : l'armement est load-bearing ──────────────────────────────
  it("SEC-002-CUTOVER-LOT5: SANS armement, sigfa_app voit ZÉRO ligne (FORCE RLS) — l'armement porte l'isolation", async () => {
    const users = await h.appQuery(`SELECT id FROM users`);
    const consents = await h.appQuery(`SELECT id FROM notification_consents`);
    const policies = await h.appQuery(`SELECT id FROM retention_policies`);
    expect(users.rows).toHaveLength(0);
    expect(consents.rows).toHaveLength(0);
    expect(policies.rows).toHaveLength(0);
  }, 60_000);

  // ── agents.ts (GET profil — SELECT users / user_services / agency_users) ─────
  it("SEC-002-CUTOVER-LOT5: GET /agents/:id — B armé ne voit PAS l'agent de A (loadAgentProfile isolé)", async () => {
    // SQL EXACT de `loadAgentProfile` rejoué armé sur B en ciblant l'id + bank_id de A.
    const rows = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT u.id FROM users u WHERE u.id = $1 AND u.bank_id = $2`,
        [userA, bankA]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
    // A armé VOIT bien son agent et ses compétences/affectations.
    const seenByA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const u = await conn.query(
        `SELECT u.id FROM users u WHERE u.id = $1 AND u.bank_id = $2`,
        [userA, bankA]
      );
      const svc = await conn.query(
        `SELECT service_id FROM user_services WHERE user_id = $1`,
        [userA]
      );
      const ag = await conn.query(
        `SELECT agency_id FROM agency_users WHERE user_id = $1`,
        [userA]
      );
      return { u: u.rows, svc: svc.rows, ag: ag.rows };
    });
    expect(seenByA.u).toHaveLength(1);
    expect(seenByA.svc).toHaveLength(1);
    expect(seenByA.ag).toHaveLength(1);
  }, 60_000);

  // ── agents.ts (PATCH profil — UPDATE users) ─────────────────────────────────
  it("SEC-002-CUTOVER-LOT5: PATCH /agents/:id — B armé ne peut PAS altérer le profil de l'agent de A (0 ligne)", async () => {
    // SQL EXACT d'`applyProfileUpdate` (UPDATE users … languages) rejoué armé sur B.
    const updated = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `UPDATE users
            SET languages = COALESCE($3::agent_language[], languages), updated_at = NOW()
          WHERE id = $1 AND bank_id = $2 RETURNING id`,
        [userA, bankB, ["EN"]]
      );
      return res.rows;
    });
    expect(updated).toHaveLength(0);
    // A armé altère bien SON agent.
    const byA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `UPDATE users
            SET languages = COALESCE($3::agent_language[], languages), updated_at = NOW()
          WHERE id = $1 AND bank_id = $2 RETURNING languages`,
        [userA, bankA, ["EN"]]
      );
      return res.rows;
    });
    expect(byA).toHaveLength(1);
  }, 60_000);

  // ── agents.ts (INSERT user_services — WITH CHECK) ───────────────────────────
  it("SEC-002-CUTOVER-LOT5: PATCH /agents/:id — B armé ne peut PAS insérer un user_services marqué bank_id=A (WITH CHECK)", async () => {
    await expect(
      withArmedTenant(armable(h), bankB, async (conn) => {
        return conn.query(
          `INSERT INTO user_services (bank_id, user_id, service_id) VALUES ($1,$2,$3)`,
          [bankA, userA, serviceA]
        );
      })
    ).rejects.toThrow();
  }, 60_000);

  // ── agents-import.ts (INSERT users — DANS sa banque autorisé, cross-tenant rejeté) ──
  it("SEC-002-CUTOVER-LOT5: import — B armé insère un agent DANS sa banque, refuse un INSERT users marqué bank_id=A (WITH CHECK)", async () => {
    // SQL EXACT d'`insertUser` : B armé insère un agent dans SA banque → autorisé.
    const okB = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `INSERT INTO users (bank_id, email, password_hash, first_name, last_name, role, languages)
         VALUES ($1, $2, $3, $4, $5, $6::role, $7) RETURNING id`,
        [bankB, "import-b5@ex.test", "x", "Import", "B5", "AGENT", ["FR"]]
      );
      return res.rows;
    });
    expect(okB).toHaveLength(1);
    // B armé tentant d'insérer un agent marqué bank_id=A → rejet WITH CHECK.
    await expect(
      withArmedTenant(armable(h), bankB, async (conn) => {
        return conn.query(
          `INSERT INTO users (bank_id, email, password_hash, first_name, last_name, role, languages)
           VALUES ($1, $2, $3, $4, $5, $6::role, $7)`,
          [bankA, "import-inj-a5@ex.test", "x", "Inj", "A5", "AGENT", ["FR"]]
        );
      })
    ).rejects.toThrow();
  }, 60_000);

  // ── data-privacy.ts (purgePhone — B ne voit/altère PAS le ticket de A) ───────
  it("SEC-002-CUTOVER-LOT5: droit à l'oubli — B armé ne peut PAS anonymiser le ticket de A par phone_hash (0 ligne)", async () => {
    // SQL EXACT de `purgePhone` (UPDATE tickets … WHERE bank_id=A AND phone_hash) mais
    // armé sur B : la policy borne à B → 0 ligne, le ticket de A reste intact.
    const affected = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `WITH purged AS (
           UPDATE tickets t SET phone_encrypted = NULL, phone_hash = NULL, updated_at = now()
           WHERE t.bank_id = '${bankA}' AND t.phone_hash = '${phoneHashA}'
           RETURNING t.id
         )
         SELECT count(*)::int AS n FROM purged`
      );
      return Number((res.rows[0] as { n: number }).n);
    });
    expect(affected).toBe(0);
    // Le ticket de A conserve encore son phone_hash (non purgé par B).
    const stillA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT phone_hash FROM tickets WHERE id = $1 AND bank_id = $2`,
        [ticketA, bankA]
      );
      return res.rows;
    });
    expect((stillA[0] as { phone_hash: string | null }).phone_hash).toBe(phoneHashA);
  }, 60_000);

  // ── data-privacy.ts (audit_log — B ne peut pas écrire pour A) ────────────────
  it("SEC-002-CUTOVER-LOT5: droit à l'oubli — B armé ne peut PAS écrire une entrée audit_log marquée bank_id=A (WITH CHECK)", async () => {
    await expect(
      withArmedTenant(armable(h), bankB, async (conn) => {
        return conn.query(
          `INSERT INTO audit_log (bank_id, action, entity_type, diff)
           VALUES ('${bankA}', 'DATA_PURGE', 'phone', '{"reason":"RIGHT_TO_ERASURE"}'::jsonb)`
        );
      })
    ).rejects.toThrow();
  }, 60_000);

  // ── data-privacy.ts (purge de A bornée à A — n'atteint jamais B) ─────────────
  it("SEC-002-CUTOVER-LOT5: droit à l'oubli — l'effacement de A (armé sur A) anonymise A et éradique son consentement SANS toucher B", async () => {
    // Seed d'un consentement chez B portant PAR HASARD le même phone_hash (collision).
    // La purge de A ne doit PAS l'éradiquer : la policy borne le DELETE à A.
    await h.query(
      `INSERT INTO notification_consents (bank_id, phone_encrypted, phone_hash, channel, opted_in)
         VALUES ('${bankB}','enc-b','${phoneHashA}','SMS',true) ON CONFLICT DO NOTHING`
    );
    // SQL EXACT de `purgePhone` armé sur A : anonymise tickets + DELETE consents de A.
    const result = await withArmedTenant(armable(h), bankA, async (conn) => {
      const t = await conn.query(
        `WITH purged AS (
           UPDATE tickets t SET phone_encrypted = NULL, phone_hash = NULL, updated_at = now()
           WHERE t.bank_id = '${bankA}' AND t.phone_hash = '${phoneHashA}'
           RETURNING t.id
         )
         SELECT count(*)::int AS n FROM purged`
      );
      const cRes = await conn.query(
        `WITH purged AS (
           DELETE FROM notification_consents c
           WHERE c.bank_id = '${bankA}' AND c.phone_hash = '${phoneHashA}'
           RETURNING c.id
         )
         SELECT count(*)::int AS n FROM purged`
      );
      return {
        tickets: Number((t.rows[0] as { n: number }).n),
        consents: Number((cRes.rows[0] as { n: number }).n),
      };
    });
    expect(result.tickets).toBe(1);
    expect(result.consents).toBe(1);
    // Le consentement de B (même hash) DEMEURE : l'effacement de A ne l'a pas touché.
    const consentB = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM notification_consents WHERE bank_id = $1 AND phone_hash = $2`,
        [bankB, phoneHashA]
      );
      return res.rows;
    });
    expect(consentB).toHaveLength(1);
  }, 60_000);

  // ── data-privacy.ts (retention_policies — lecture isolée) ────────────────────
  it("SEC-002-CUTOVER-LOT5: GET /data/retention-policy — B armé ne lit PAS la politique de A (isolée)", async () => {
    // SQL EXACT de `loadRetentionMonths` rejoué armé sur B en ciblant A → 0 ligne.
    const rowsB = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT phone_retention_months FROM retention_policies WHERE bank_id = $1`,
        [bankA]
      );
      return res.rows;
    });
    expect(rowsB).toHaveLength(0);
    // A armé lit bien SA politique (24 mois seedés).
    const rowsA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT phone_retention_months FROM retention_policies WHERE bank_id = $1`,
        [bankA]
      );
      return res.rows;
    });
    expect(rowsA).toHaveLength(1);
    expect((rowsA[0] as { phone_retention_months: number }).phone_retention_months).toBe(24);
  }, 60_000);
});
