/**
 * Test d'ISOLATION TENANT — SEC-002-CUTOVER-LOT8 (WEBHOOKS ENTRANTS armés).
 *
 * Prouve, sur PostgreSQL 16 réelle sous connexion `sigfa_app` NOBYPASSRLS (jamais
 * l'owner qui contourne FORCE RLS), que la BASCULE `withArmedTenant` des routes
 * `webhooks-notifications` / `webhooks-whatsapp-inbound` isole réellement les
 * tenants. Pour ces webhooks le `bank_id` (tenant) est RÉSOLU depuis le PAYLOAD/la
 * CONFIG (corrélation `provider_message_id` pour le statut delivery ; `bankSlug` →
 * config pour l'entrant), JAMAIS d'une auth : le test rejoue le SQL EXACT des chemins
 * ARMÉS post-résolution à travers `withArmedTenant` et vérifie qu'un webhook résolu
 * vers A n'écrit/lit QUE dans A — B est inatteignable.
 *
 *   - webhooks-notifications.ts : l'UPDATE armé de `notification_log`
 *     (`applyDeliveryAck`, statut DELIVERED/FAILED) rejoué armé sur B en ciblant le
 *     log de A → 0 ligne (un accusé de A ne met pas à jour un journal de B) ; A armé
 *     met bien à jour SON journal.
 *   - webhooks-whatsapp-inbound.ts : la réclamation d'idempotence armée
 *     (`whatsapp_inbound_messages` INSERT marqué `bank_id=A`) est REJETÉE (WITH CHECK)
 *     sous armement B ; l'opt-in armé (`notification_consents` INSERT marqué
 *     `bank_id=A`) est REJETÉ (WITH CHECK) sous armement B ; la lecture de statut armée
 *     (`tickets` WHERE phone_hash) sur B ne voit PAS le ticket actif de A.
 *
 * COUTURE DB COMPLÈTE : toutes les tables touchées (notification_log,
 * whatsapp_inbound_messages, notification_consents, tickets) portent `tenant_isolation`
 * (FORCE RLS) + le GRANT CRUD `sigfa_app` (0004/0012/0001). Le SQL exécuté ici est
 * CELUI des routes basculées, rejoué à travers `withArmedTenant` — l'exact chemin de
 * production POST-résolution du payload/config.
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

const bankA = "aaaaaaaa-0000-4000-8000-0000000000a8";
const bankB = "bbbbbbbb-0000-4000-8000-0000000000b8";
const agencyA = "aa000000-0000-4000-8000-0000000000a8";
const agencyB = "bb000000-0000-4000-8000-0000000000b8";
const serviceA = "5e000000-0000-4000-8000-0000000000a8";
const queueA = "40000000-0000-4000-8000-0000000000a8";
const ticketA = "71000000-0000-4000-8000-0000000000a8";
const logA = "10c00000-0000-4000-8000-0000000000a8";
const PHONE_HASH_A = "hash-phone-lot8-a";

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
       ('${bankA}','Banque A','cutover8-a'),
       ('${bankB}','Banque B','cutover8-b') ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO agencies (id, bank_id, name, weekly_schedule) VALUES
       ('${agencyA}','${bankA}','Agence A','{}'),
       ('${agencyB}','${bankB}','Agence B','{}') ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes, display_order) VALUES
       ('${serviceA}','${bankA}','${agencyA}','DEP','Dépôt',10,1) ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO queues (id, bank_id, agency_id, service_id, status) VALUES
       ('${queueA}','${bankA}','${agencyA}','${serviceA}','OPEN') ON CONFLICT (id) DO NOTHING`
  );
  // Un journal de notification SENT de A, corrélé par provider_message_id (delivery ack).
  await h.query(
    `INSERT INTO notification_log
        (id, bank_id, type, channel, phone_hash, status, provider_message_id)
       VALUES ('${logA}','${bankA}','TICKET_CONFIRMATION','SMS','${PHONE_HASH_A}','SENT','mid-lot8-a')
       ON CONFLICT (id) DO NOTHING`
  );
  // Un ticket ACTIF de A pour ce phone_hash (lu par la consultation de statut entrante).
  await h.query(
    `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, tracking_id, channel, status, phone_hash)
       VALUES ('${ticketA}','${bankA}','${agencyA}','${queueA}','${serviceA}',1,'trk-cutover8-a-00001','WHATSAPP','WAITING','${PHONE_HASH_A}')
       ON CONFLICT (id) DO NOTHING`
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
}, 30_000);

describe("SEC-002-CUTOVER-LOT8: isolation tenant sous armement (webhooks-notifications/webhooks-whatsapp-inbound)", () => {
  // ── PREUVE ROUGE : l'armement est load-bearing ──────────────────────────────
  it("SEC-002-CUTOVER-LOT8: SANS armement, sigfa_app voit ZÉRO ligne (FORCE RLS) — l'armement porte l'isolation", async () => {
    const logs = await h.appQuery(`SELECT id FROM notification_log`);
    const inbound = await h.appQuery(`SELECT id FROM whatsapp_inbound_messages`);
    const consents = await h.appQuery(`SELECT id FROM notification_consents`);
    const tickets = await h.appQuery(`SELECT id FROM tickets`);
    expect(logs.rows).toHaveLength(0);
    expect(inbound.rows).toHaveLength(0);
    expect(consents.rows).toHaveLength(0);
    expect(tickets.rows).toHaveLength(0);
  }, 60_000);

  // ── webhooks-notifications.ts (UPDATE armé notification_log — isolé) ─────────
  it("SEC-002-CUTOVER-LOT8: delivery ack — B armé ne met PAS à jour le journal de A (0 ligne)", async () => {
    // SQL EXACT d'`applyDeliveryAck` (branche DELIVERED) rejoué armé sur B en ciblant
    // le log de A → 0 ligne (RLS notification_log borne à B).
    const updated = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `UPDATE notification_log
            SET status = 'DELIVERED', delivered_at = '2026-07-13T09:00:00Z'
          WHERE id = $1 AND bank_id = $2
            AND status NOT IN ('FAILED')
          RETURNING id`,
        [logA, bankA]
      );
      return res.rows;
    });
    expect(updated).toHaveLength(0);
    // A armé met bien à jour SON journal.
    const byA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `UPDATE notification_log
            SET status = 'DELIVERED', delivered_at = '2026-07-13T09:00:00Z'
          WHERE id = $1 AND bank_id = $2
            AND status NOT IN ('FAILED')
          RETURNING id`,
        [logA, bankA]
      );
      return res.rows;
    });
    expect(byA).toHaveLength(1);
  }, 60_000);

  // ── webhooks-whatsapp-inbound.ts (idempotence armée — WITH CHECK cross-tenant) ─
  it("SEC-002-CUTOVER-LOT8: inbound claim — B armé ne peut PAS réclamer un message marqué bank_id=A (WITH CHECK)", async () => {
    // SQL EXACT de `claimInboundMessage` rejoué armé sur B en marquant bank_id=A →
    // rejet WITH CHECK (B ne peut pas écrire une idempotence pour A).
    await expect(
      withArmedTenant(armable(h), bankB, async (conn) => {
        return conn.query(
          `INSERT INTO whatsapp_inbound_messages (bank_id, provider_message_id)
           VALUES ($1, $2)
           ON CONFLICT (bank_id, provider_message_id) DO NOTHING
           RETURNING provider_message_id`,
          [bankA, "wamid-lot8-crosstenant"]
        );
      })
    ).rejects.toThrow();
  }, 60_000);

  it("SEC-002-CUTOVER-LOT8: inbound claim — B armé réclame SON propre message (bank_id=B) sans fuite", async () => {
    // A armé réclame SON message ; B armé réclame le SIEN avec le MÊME
    // provider_message_id → deux lignes disjointes (unicité PAR tenant, aucune fuite).
    const claimedByA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `INSERT INTO whatsapp_inbound_messages (bank_id, provider_message_id)
         VALUES ($1, $2)
         ON CONFLICT (bank_id, provider_message_id) DO NOTHING
         RETURNING provider_message_id`,
        [bankA, "wamid-lot8-shared"]
      );
      return res.rows;
    });
    expect(claimedByA).toHaveLength(1);
    const claimedByB = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `INSERT INTO whatsapp_inbound_messages (bank_id, provider_message_id)
         VALUES ($1, $2)
         ON CONFLICT (bank_id, provider_message_id) DO NOTHING
         RETURNING provider_message_id`,
        [bankB, "wamid-lot8-shared"]
      );
      return res.rows;
    });
    // B voit le même id « libre » dans SON tenant (les lignes de A lui sont invisibles).
    expect(claimedByB).toHaveLength(1);
  }, 60_000);

  // ── webhooks-whatsapp-inbound.ts (opt-in armé — WITH CHECK cross-tenant) ─────
  it("SEC-002-CUTOVER-LOT8: inbound opt-in — B armé ne peut PAS tracer un consentement marqué bank_id=A (WITH CHECK)", async () => {
    // SQL EXACT de `traceInboundOptIn` rejoué armé sur B en marquant bank_id=A → rejet.
    await expect(
      withArmedTenant(armable(h), bankB, async (conn) => {
        return conn.query(
          `INSERT INTO notification_consents
              (bank_id, phone_encrypted, phone_hash, channel, opted_in, opted_at, source)
           VALUES ($1, 'v1:enc', $2, 'WHATSAPP'::notification_channel, true, NOW(), 'INBOUND_WHATSAPP')
           ON CONFLICT (bank_id, phone_hash, channel) DO NOTHING`,
          [bankA, PHONE_HASH_A]
        );
      })
    ).rejects.toThrow();
  }, 60_000);

  // ── webhooks-whatsapp-inbound.ts (consultation de statut armée — lecture isolée) ─
  it("SEC-002-CUTOVER-LOT8: inbound statut — B armé ne voit PAS le ticket actif de A (0 ligne)", async () => {
    // SQL EXACT de `loadActiveTicketStatus` (1re requête) rejoué armé sur B en ciblant
    // le phone_hash de A → 0 ligne (RLS tickets bornée à B).
    const seenByB = await withArmedTenant(armable(h), bankB, async (conn) => {
      const res = await conn.query(
        `SELECT t.id, t.number, t.display_number, t.queue_id, t.issued_at
           FROM tickets t
          WHERE t.phone_hash = $1
            AND t.status IN ('WAITING','CALLED')
          ORDER BY t.issued_at DESC
          LIMIT 1`,
        [PHONE_HASH_A]
      );
      return res.rows;
    });
    expect(seenByB).toHaveLength(0);
    // A armé voit bien SON ticket actif.
    const seenByA = await withArmedTenant(armable(h), bankA, async (conn) => {
      const res = await conn.query(
        `SELECT t.id, t.number, t.display_number, t.queue_id, t.issued_at
           FROM tickets t
          WHERE t.phone_hash = $1
            AND t.status IN ('WAITING','CALLED')
          ORDER BY t.issued_at DESC
          LIMIT 1`,
        [PHONE_HASH_A]
      );
      return res.rows;
    });
    expect(seenByA).toHaveLength(1);
  }, 60_000);
});
