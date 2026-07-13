/**
 * Test d'ISOLATION TENANT — SEC-002-CUTOVER-LOT4 (cycle ticket / file d'attente armés).
 *
 * Prouve, sur PostgreSQL 16 réelle sous connexion `sigfa_app` NOBYPASSRLS (jamais
 * l'owner qui contourne FORCE RLS), que la BASCULE `withArmedTenant` des routes
 * `tickets` / `tickets-sync` / `queues` isole réellement les tenants :
 *
 *   - un contexte armé sur la banque B ne LIT PAS les tickets/files de la banque A
 *     (SELECT ticket, position, file), même en ciblant explicitement l'id/bank_id de A ;
 *   - un contexte armé sur B ne PEUT PAS ALTÉRER une ligne de A : transitions de
 *     ticket (UPDATE tickets), allocation de numéro (UPDATE queues), statut de file
 *     (PATCH /queues) — 0 ligne visible → policy `tenant_isolation` ;
 *   - un contexte armé sur B ne PEUT PAS insérer une ligne marquée `bank_id = A`
 *     (rejet WITH CHECK) sur tickets et ticket_transfers ;
 *   - le batch offline (tickets-sync) insère sous armement dans SA banque et refuse
 *     l'écriture cross-tenant (WITH CHECK).
 *
 * COUTURE DB COMPLÈTE : toutes les tables touchées (tickets, queues, ticket_transfers,
 * counters, operations, services, users, agency_users, agent_status_history) portent
 * `tenant_isolation` + le GRANT CRUD `sigfa_app` (0001/0009/0010) ; `banks` est en
 * SELECT armé (0001). Le SQL exécuté ici est CELUI des routes basculées, rejoué à
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

const bankA = "aaaaaaaa-0000-4000-8000-0000000000a4";
const bankB = "bbbbbbbb-0000-4000-8000-0000000000b4";
const agencyA = "aa000000-0000-4000-8000-0000000000a4";
const agencyB = "bb000000-0000-4000-8000-0000000000b4";
const serviceA = "5e000000-0000-4000-8000-0000000000a4";
const serviceB = "5e000000-0000-4000-8000-0000000000b4";
const queueA = "40000000-0000-4000-8000-0000000000a4";
const queueB = "40000000-0000-4000-8000-0000000000b4";
const ticketA = "71000000-0000-4000-8000-0000000000a4";
const counterA = "c0000000-0000-4000-8000-0000000000a4";
const userA = "50000000-0000-4000-8000-0000000000a4";

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
       ('${bankA}','Banque A','cutover4-a'),
       ('${bankB}','Banque B','cutover4-b') ON CONFLICT (id) DO NOTHING`
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
  await h.query(
    `INSERT INTO users (id, bank_id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ('${userA}','${bankA}','agent-a4@ex.test','x','Agent','A4','AGENT',true) ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO counters (id, bank_id, agency_id, number, label, status, agent_id)
       VALUES ('${counterA}','${bankA}','${agencyA}',1,'G1','OPEN','${userA}') ON CONFLICT (id) DO NOTHING`
  );
  // Ticket WAITING de A (émis).
  await h.query(
    `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, tracking_id, channel, status)
       VALUES ('${ticketA}','${bankA}','${agencyA}','${queueA}','${serviceA}',1,'trk-cutover4-a-000001','KIOSK','WAITING')
       ON CONFLICT (id) DO NOTHING`
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
}, 30_000);

describe("SEC-002-CUTOVER-LOT4: isolation tenant sous armement (tickets/tickets-sync/queues)", () => {
  // ── PREUVE ROUGE : l'armement est load-bearing ──────────────────────────────
  it("SEC-002-CUTOVER-LOT4: SANS armement, sigfa_app voit ZÉRO ligne (FORCE RLS) — l'armement porte l'isolation", async () => {
    const tickets = await h.appQuery(`SELECT id FROM tickets`);
    const queues = await h.appQuery(`SELECT id FROM queues`);
    const transfers = await h.appQuery(`SELECT id FROM ticket_transfers`);
    expect(tickets.rows).toHaveLength(0);
    expect(queues.rows).toHaveLength(0);
    expect(transfers.rows).toHaveLength(0);
  }, 60_000);

  // ── tickets.ts (SELECT détail / GET) ────────────────────────────────────────
  it("SEC-002-CUTOVER-LOT4: GET /tickets/:id — B armé ne voit PAS le ticket de A (loadTicket isolé)", async () => {
    // SQL EXACT de `loadTicket` rejoué armé sur B en ciblant l'id + bank_id de A.
    const rows = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT * FROM tickets WHERE id = $1 AND bank_id = $2`,
        [ticketA, bankA]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
    // A armé VOIT bien son ticket.
    const seenByA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT id FROM tickets WHERE id = $1 AND bank_id = $2`,
        [ticketA, bankA]
      );
      return res.rows;
    });
    expect(seenByA).toHaveLength(1);
  }, 60_000);

  // ── tickets.ts (transitions — UPDATE tickets) ───────────────────────────────
  it("SEC-002-CUTOVER-LOT4: transition ticket — B armé ne peut PAS altérer le ticket de A (0 ligne)", async () => {
    // SQL EXACT d'une transition (serve/close/abandon) rejoué armé sur B.
    const updated = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `UPDATE tickets SET status = 'ABANDONED', updated_at = NOW()
          WHERE id = $1 AND bank_id = $2 RETURNING id`,
        [ticketA, bankB]
      );
      return res.rows;
    });
    expect(updated).toHaveLength(0);
    // Le ticket de A reste WAITING (intact pour B).
    const stillWaiting = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT status FROM tickets WHERE id = $1 AND bank_id = $2`,
        [ticketA, bankA]
      );
      return res.rows;
    });
    expect((stillWaiting[0] as { status: string }).status).toBe("WAITING");
  }, 60_000);

  // ── tickets.ts (allocateNumber — UPDATE queues) ─────────────────────────────
  it("SEC-002-CUTOVER-LOT4: allocateNumber — B armé ne peut PAS incrémenter le compteur de la file de A (0 ligne)", async () => {
    // SQL de `allocateNumber` (UPDATE queues … RETURNING) rejoué armé sur B sur la file de A.
    const rows = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `UPDATE queues q SET current_ticket_number = q.current_ticket_number + 1
          WHERE q.id = $1 RETURNING current_ticket_number`,
        [queueA]
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  }, 60_000);

  // ── tickets.ts (INSERT tickets — WITH CHECK) ────────────────────────────────
  it("SEC-002-CUTOVER-LOT4: émission — B armé ne peut PAS insérer un ticket marqué bank_id=A (WITH CHECK)", async () => {
    await expect(
      withArmedTenant(armable(h), bankB, async (conn) => {
        return conn.query(
          `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, tracking_id, channel, status, priority)
           VALUES ($1,$2,$3,$4,$5,$6,'KIOSK','WAITING','STANDARD')`,
          [bankA, agencyA, queueA, serviceA, 999, "trk-inj-a4-000999"]
        );
      })
    ).rejects.toThrow();
  }, 60_000);

  // ── tickets.ts (ticket_transfers — WITH CHECK) ──────────────────────────────
  it("SEC-002-CUTOVER-LOT4: transfert — B armé ne peut PAS insérer un ticket_transfers marqué bank_id=A (WITH CHECK)", async () => {
    await expect(
      withArmedTenant(armable(h), bankB, async (conn) => {
        return conn.query(
          `INSERT INTO ticket_transfers (bank_id, ticket_id, from_service_id, to_service_id, transferred_by)
           VALUES ($1,$2,$3,$4,$5)`,
          [bankA, ticketA, serviceA, serviceA, userA]
        );
      })
    ).rejects.toThrow();
  }, 60_000);

  // ── queues.ts (PATCH — UPDATE queues) ───────────────────────────────────────
  it("SEC-002-CUTOVER-LOT4: PATCH /queues/:id — B armé ne peut PAS altérer la file de A (0 ligne)", async () => {
    // SQL EXACT de `patchQueue` (UPDATE queues SET status…) rejoué armé sur B.
    const updated = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `UPDATE queues SET status = $1, is_open = $2, updated_at = NOW()
          WHERE id = $3 RETURNING id`,
        ["PAUSED", false, queueA]
      );
      return res.rows;
    });
    expect(updated).toHaveLength(0);
    // A armé altère bien SA file.
    const byA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `UPDATE queues SET status = $1, is_open = $2, updated_at = NOW()
          WHERE id = $3 RETURNING status`,
        ["PAUSED", false, queueA]
      );
      return res.rows;
    });
    expect(byA).toHaveLength(1);
    expect((byA[0] as { status: string }).status).toBe("PAUSED");
  }, 60_000);

  // ── tickets-sync.ts (batch INSERT — WITH CHECK) ─────────────────────────────
  it("SEC-002-CUTOVER-LOT4: sync offline — B armé insère dans SA banque, refuse un item marqué bank_id=A (WITH CHECK)", async () => {
    // B armé insère un ticket de sync DANS sa banque (queueB) : autorisé.
    const okB = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, tracking_id, local_uuid, channel, status, priority)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'KIOSK','WAITING','STANDARD')
         ON CONFLICT (local_uuid) DO NOTHING RETURNING id`,
        [bankB, agencyB, queueB, serviceB, 1, "trk-sync-b4-000001", "b4000000-0000-4000-8000-0000000000b4"]
      );
      return res.rows;
    });
    expect(okB).toHaveLength(1);
    // B armé tentant d'insérer un item marqué bank_id=A → rejet WITH CHECK.
    await expect(
      withArmedTenant(armable(h), bankB, async (conn) => {
        return conn.query(
          `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, tracking_id, local_uuid, channel, status, priority)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'KIOSK','WAITING','STANDARD')`,
          [bankA, agencyA, queueA, serviceA, 2, "trk-sync-inj-000002", "a4000000-0000-4000-8000-0000000000a4"]
        );
      })
    ).rejects.toThrow();
  }, 60_000);
});
