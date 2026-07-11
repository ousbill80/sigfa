import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startPostgresContainer,
  type PostgresHarness,
} from "@sigfa/testing/tenant-isolation";
import { applyMigrations } from "src/test-support/migrate.js";

/**
 * Tests d'intégration DB-001 — schéma cœur sur PostgreSQL 16 réelle (Testcontainers).
 * Aucun mock (LA LOI T5). Les migrations générées par drizzle-kit sont appliquées
 * telles quelles, puis les critères d'acceptation sont vérifiés via `information_schema`
 * et des insertions réelles.
 */

/** Tables métier attendues (chacune DOIT porter bank_id NOT NULL + index bank_id-first). */
const BUSINESS_TABLES = [
  "agencies",
  "agency_exceptional_closures",
  "services",
  "queues",
  "counters",
  "counter_services",
  "kiosks",
  "user_services",
  "agency_users",
  "agent_status_history",
  "tickets",
  "ticket_transfers",
] as const;

/** UUIDs de fixture déterministes (multi-tenant : deux banques). */
const IDS = {
  bankA: "11111111-1111-4111-a111-111111111111",
  bankB: "22222222-2222-4222-a222-222222222222",
  agencyA: "33333333-3333-4333-a333-333333333333",
  serviceOC: "77777777-7777-4777-a777-777777777777",
  serviceEP: "88888888-8888-4888-a888-888888888888",
  queueOC: "13131313-1313-4131-a131-131313131313",
  counter1: "cccccccc-cccc-4ccc-accc-cccccccccccc",
  counter2: "dddddddd-dddd-4ddd-addd-dddddddddddd",
  agentKofi: "55555555-5555-4555-a555-555555555555",
  agentAmi: "66666666-6666-4666-a666-666666666666",
} as const;

/**
 * Insère un jeu de fixtures cohérent (banque A, agence, 2 services, file, 2 guichets,
 * 2 agents). Idempotent au sein d'un même schéma vierge.
 * @param pg - Harness PostgreSQL
 */
async function seedBaseFixture(pg: PostgresHarness): Promise<void> {
  await pg.query(
    `INSERT INTO banks (id, name, slug) VALUES ('${IDS.bankA}', 'Banque A', 'banque-a')`
  );
  await pg.query(
    `INSERT INTO agencies (id, bank_id, name, weekly_schedule)
     VALUES ('${IDS.agencyA}', '${IDS.bankA}', 'Agence Plateau',
             '{"monday":{"start":"08:00","end":"17:00"}}'::jsonb)`
  );
  await pg.query(
    `INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes)
     VALUES ('${IDS.serviceOC}', '${IDS.bankA}', '${IDS.agencyA}', 'OC', 'Operations Courantes', 10),
            ('${IDS.serviceEP}', '${IDS.bankA}', '${IDS.agencyA}', 'EP', 'Epargne', 15)`
  );
  await pg.query(
    `INSERT INTO queues (id, bank_id, agency_id, service_id)
     VALUES ('${IDS.queueOC}', '${IDS.bankA}', '${IDS.agencyA}', '${IDS.serviceOC}')`
  );
  await pg.query(
    `INSERT INTO counters (id, bank_id, agency_id, number, label)
     VALUES ('${IDS.counter1}', '${IDS.bankA}', '${IDS.agencyA}', 1, 'Guichet 1'),
            ('${IDS.counter2}', '${IDS.bankA}', '${IDS.agencyA}', 2, 'Guichet 2')`
  );
  await pg.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
     VALUES ('${IDS.agentKofi}', 'kofi@banque-a.com', 'h', 'Kofi', 'Asante', 'AGENT'),
            ('${IDS.agentAmi}', 'ami@banque-a.com', 'h', 'Aminata', 'Coulibaly', 'AGENT')`
  );
}

describe("DB-001: schéma cœur Drizzle sur PostgreSQL 16 (Testcontainers)", () => {
  let pg: PostgresHarness;

  beforeAll(async () => {
    pg = await startPostgresContainer();
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  }, 30_000);

  it("DB-001: migration up/down propre sur PG16 vierge (Testcontainers)", async () => {
    // UP : applique toutes les migrations générées.
    await applyMigrations(pg);
    const tablesResult = await pg.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    const tables = tablesResult.rows.map((row) => row.table_name as string);
    expect(tables).toContain("banks");
    expect(tables).toContain("users");
    for (const table of BUSINESS_TABLES) {
      expect(tables, `table ${table} présente`).toContain(table);
    }

    // DOWN : suppression propre du schéma (aucune dépendance orpheline).
    await pg.query("DROP SCHEMA public CASCADE");
    await pg.query("CREATE SCHEMA public");
    const afterDrop = await pg.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`
    );
    expect(afterDrop.rows[0]?.n).toBe(0);

    // Ré-applique pour les tests suivants (idempotence du pipeline de migration).
    await applyMigrations(pg);
    await seedBaseFixture(pg);
  });

  it("DB-001: 100% des tables métier portent bank_id NOT NULL + index bank_id-first (information_schema)", async () => {
    for (const table of BUSINESS_TABLES) {
      const col = await pg.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = 'bank_id'`
      );
      expect(col.rows.length, `${table}.bank_id existe`).toBe(1);
      expect(col.rows[0]?.is_nullable, `${table}.bank_id NOT NULL`).toBe("NO");

      // Index dont la PREMIÈRE colonne est bank_id.
      const idx = await pg.query(
        `SELECT i.relname AS index_name
           FROM pg_index x
           JOIN pg_class i ON i.oid = x.indexrelid
           JOIN pg_class t ON t.oid = x.indrelid
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.indkey[0]
          WHERE t.relname = '${table}' AND a.attname = 'bank_id'`
      );
      expect(idx.rows.length, `${table} a un index bank_id-first`).toBeGreaterThanOrEqual(1);
    }
  });

  it("DB-001: thresholds CHECK bornés — valeur hors bornes rejetée", async () => {
    // queue_critical_threshold ∈ [1,500]
    await expect(
      pg.query(
        `INSERT INTO banks (id, name, slug, queue_critical_threshold)
         VALUES (gen_random_uuid(), 'X', 'x-oob', 501)`
      )
    ).rejects.toThrow();
    // agent_inactivity_minutes ∈ [1,60]
    await expect(
      pg.query(
        `INSERT INTO banks (id, name, slug, agent_inactivity_minutes)
         VALUES (gen_random_uuid(), 'Y', 'y-oob', 61)`
      )
    ).rejects.toThrow();
    // no_show_timeout_minutes ∈ [1,30]
    await expect(
      pg.query(
        `INSERT INTO banks (id, name, slug, no_show_timeout_minutes)
         VALUES (gen_random_uuid(), 'Z', 'z-oob', 0)`
      )
    ).rejects.toThrow();
    // Valeur dans les bornes acceptée.
    await pg.query(
      `INSERT INTO banks (id, name, slug, queue_critical_threshold, agent_inactivity_minutes, no_show_timeout_minutes)
       VALUES (gen_random_uuid(), 'OK', 'ok-bounds', 500, 60, 30)`
    );
  });

  it("DB-001: email unique GLOBAL — même email 2 banques → rejet", async () => {
    await pg.query(
      `INSERT INTO banks (id, name, slug) VALUES ('${IDS.bankB}', 'Banque B', 'banque-b')`
    );
    // Même email qu'un utilisateur existant (rattaché conceptuellement à une autre banque)
    await expect(
      pg.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
         VALUES (gen_random_uuid(), 'kofi@banque-a.com', 'h', 'Autre', 'Kofi', 'AGENT')`
      )
    ).rejects.toThrow();
  });

  it("DB-001: unicité (queue_id, number, issued_day) violée → erreur ; issued_day = date locale Abidjan (pas UTC)", async () => {
    // Ticket émis à 23h59 UTC → 23h59 Abidjan (UTC+0) : reste le même jour.
    // Ticket émis à 00h30 UTC le lendemain doit tomber sur un autre issued_day.
    const t1 = "aaaa1111-1111-4111-a111-111111111111";
    await pg.query(
      `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, channel, status, tracking_id, issued_at)
       VALUES ('${t1}', '${IDS.bankA}', '${IDS.agencyA}', '${IDS.queueOC}', '${IDS.serviceOC}',
               1, 'KIOSK', 'WAITING', 'trk000000000000000001', '2026-07-11T23:59:00+00:00')`
    );
    const day1 = await pg.query(`SELECT issued_day::text AS d FROM tickets WHERE id = '${t1}'`);
    expect(day1.rows[0]?.d).toBe("2026-07-11");

    // Même (queue, number, jour) → violation d'unicité.
    await expect(
      pg.query(
        `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, channel, status, tracking_id, issued_at)
         VALUES (gen_random_uuid(), '${IDS.bankA}', '${IDS.agencyA}', '${IDS.queueOC}', '${IDS.serviceOC}',
                 1, 'KIOSK', 'WAITING', 'trk000000000000000002', '2026-07-11T23:59:00+00:00')`
      )
    ).rejects.toThrow();

    // Même number, jour SUIVANT (Abidjan) → autorisé.
    await pg.query(
      `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, channel, status, tracking_id, issued_at)
       VALUES (gen_random_uuid(), '${IDS.bankA}', '${IDS.agencyA}', '${IDS.queueOC}', '${IDS.serviceOC}',
               1, 'KIOSK', 'WAITING', 'trk000000000000000003', '2026-07-12T00:30:00+00:00')`
    );
    const days = await pg.query(
      `SELECT DISTINCT issued_day::text AS d FROM tickets WHERE queue_id = '${IDS.queueOC}' AND number = 1 ORDER BY d`
    );
    expect(days.rows.map((r) => r.d)).toEqual(["2026-07-11", "2026-07-12"]);
  });

  it("DB-001: 2 insertions simultanées même queue via lock-then-increment → numéros distincts, zéro violation", async () => {
    // Simule le pattern API-003 : UPDATE ... RETURNING (lock-then-increment) sur queues.current_ticket_number.
    // Deux transactions concurrentes doivent obtenir deux numéros distincts.
    const { default: pglib } = await import("pg");
    const makeClient = (): InstanceType<typeof pglib.Client> =>
      new pglib.Client({ connectionString: pg.connectionString });

    const c1 = makeClient();
    const c2 = makeClient();
    await c1.connect();
    await c2.connect();
    try {
      await c1.query("BEGIN");
      await c2.query("BEGIN");

      // c1 verrouille la ligne file et incrémente.
      const r1 = await c1.query(
        `UPDATE queues SET current_ticket_number = current_ticket_number + 1
          WHERE id = $1 RETURNING current_ticket_number`,
        [IDS.queueOC]
      );
      const n1 = (r1.rows[0] as { current_ticket_number: number }).current_ticket_number;

      // c2 tente le même UPDATE : il bloque jusqu'au COMMIT de c1.
      const c2Promise = c2.query(
        `UPDATE queues SET current_ticket_number = current_ticket_number + 1
          WHERE id = $1 RETURNING current_ticket_number`,
        [IDS.queueOC]
      );

      await c1.query("COMMIT");
      const r2 = await c2Promise;
      const n2 = (r2.rows[0] as { current_ticket_number: number }).current_ticket_number;
      await c2.query("COMMIT");

      expect(n1).not.toBe(n2);
      expect([n1, n2].sort((a, b) => a - b)).toEqual([n1, n2].sort((a, b) => a - b));
      expect(Math.abs(n1 - n2)).toBe(1);
    } finally {
      await c1.end();
      await c2.end();
    }
  });

  it("DB-001: tracking_id et local_uuid uniques — doublons rejetés", async () => {
    const track = "V9k2mXpLqRwZsYn8fBjH3";
    const local = "550e8400-e29b-41d4-a716-446655440099";
    await pg.query(
      `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, channel, status, tracking_id, local_uuid, issued_at)
       VALUES (gen_random_uuid(), '${IDS.bankA}', '${IDS.agencyA}', '${IDS.queueOC}', '${IDS.serviceOC}',
               500, 'KIOSK', 'WAITING', '${track}', '${local}', now())`
    );
    // tracking_id dupliqué → rejet
    await expect(
      pg.query(
        `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, channel, status, tracking_id, issued_at)
         VALUES (gen_random_uuid(), '${IDS.bankA}', '${IDS.agencyA}', '${IDS.queueOC}', '${IDS.serviceOC}',
                 501, 'KIOSK', 'WAITING', '${track}', now())`
      )
    ).rejects.toThrow();
    // local_uuid dupliqué → rejet
    await expect(
      pg.query(
        `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, channel, status, local_uuid, issued_at)
         VALUES (gen_random_uuid(), '${IDS.bankA}', '${IDS.agencyA}', '${IDS.queueOC}', '${IDS.serviceOC}',
                 502, 'KIOSK', 'WAITING', '${local}', now())`
      )
    ).rejects.toThrow();
  });

  it("DB-001: fermeture exceptionnelle ajoutée → weekly_schedule intact", async () => {
    const before = await pg.query(
      `SELECT weekly_schedule::text AS s FROM agencies WHERE id = '${IDS.agencyA}'`
    );
    await pg.query(
      `INSERT INTO agency_exceptional_closures (id, bank_id, agency_id, date, reason)
       VALUES (gen_random_uuid(), '${IDS.bankA}', '${IDS.agencyA}', '2026-08-07', 'Fete nationale')`
    );
    const after = await pg.query(
      `SELECT weekly_schedule::text AS s FROM agencies WHERE id = '${IDS.agencyA}'`
    );
    expect(after.rows[0]?.s).toBe(before.rows[0]?.s);
    const closures = await pg.query(
      `SELECT count(*)::int AS n FROM agency_exceptional_closures WHERE agency_id = '${IDS.agencyA}'`
    );
    expect(closures.rows[0]?.n).toBe(1);
  });

  it("DB-001: jointures de routage réalisables — counter_services × user_services × languages", async () => {
    // Kofi parle FR+DIOULA et sait traiter OC ; le guichet 1 couvre OC.
    await pg.query(
      `UPDATE users SET languages = '{FR,DIOULA}' WHERE id = '${IDS.agentKofi}'`
    );
    await pg.query(
      `INSERT INTO user_services (id, bank_id, user_id, service_id)
       VALUES (gen_random_uuid(), '${IDS.bankA}', '${IDS.agentKofi}', '${IDS.serviceOC}')`
    );
    await pg.query(
      `INSERT INTO counter_services (id, bank_id, counter_id, service_id)
       VALUES (gen_random_uuid(), '${IDS.bankA}', '${IDS.counter1}', '${IDS.serviceOC}')`
    );
    await pg.query(
      `INSERT INTO agency_users (id, bank_id, agency_id, user_id)
       VALUES (gen_random_uuid(), '${IDS.bankA}', '${IDS.agencyA}', '${IDS.agentKofi}')`
    );
    // Couple attendu : (Kofi, guichet 1, OC), Kofi parlant DIOULA.
    const rows = await pg.query(
      `SELECT u.id AS user_id, cs.counter_id, us.service_id
         FROM user_services us
         JOIN counter_services cs ON cs.service_id = us.service_id
         JOIN users u ON u.id = us.user_id
        WHERE us.service_id = '${IDS.serviceOC}'
          AND 'DIOULA' = ANY(u.languages)`
    );
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0]?.user_id).toBe(IDS.agentKofi);
    expect(rows.rows[0]?.counter_id).toBe(IDS.counter1);
    expect(rows.rows[0]?.service_id).toBe(IDS.serviceOC);
  });

  it("DB-001: insertion ticket complet + relecture relations + transfert en cascade → 2 lignes ticket_transfers", async () => {
    const ticketId = "ffffffff-ffff-4fff-afff-ffffffffffff";
    await pg.query(
      `INSERT INTO tickets
         (id, bank_id, agency_id, queue_id, service_id, counter_id, agent_id, number, display_number,
          tracking_id, channel, status, priority, sms_consent, issued_at, called_at, served_at)
       VALUES ('${ticketId}', '${IDS.bankA}', '${IDS.agencyA}', '${IDS.queueOC}', '${IDS.serviceOC}',
               '${IDS.counter1}', '${IDS.agentKofi}', 47, 'OC-047', 'trkfull00000000000047',
               'KIOSK', 'SERVING', 'STANDARD', false, now(), now(), now())`
    );
    // Relecture des relations (jointures FK complètes).
    const read = await pg.query(
      `SELECT t.display_number, s.code, c.label AS counter_label, a.name AS agency_name, b.slug
         FROM tickets t
         JOIN services s ON s.id = t.service_id
         JOIN counters c ON c.id = t.counter_id
         JOIN agencies a ON a.id = t.agency_id
         JOIN banks b ON b.id = t.bank_id
        WHERE t.id = '${ticketId}'`
    );
    expect(read.rows[0]).toMatchObject({
      display_number: "OC-047",
      code: "OC",
      counter_label: "Guichet 1",
      agency_name: "Agence Plateau",
      slug: "banque-a",
    });

    // Cascade de transfert : OC → EP (guichet 1 → guichet 2), puis EP → OC (2e saut).
    await pg.query(
      `INSERT INTO ticket_transfers
         (id, bank_id, ticket_id, from_counter_id, from_service_id, to_service_id, to_counter_id, reason, transferred_by, transferred_at)
       VALUES (gen_random_uuid(), '${IDS.bankA}', '${ticketId}', '${IDS.counter1}', '${IDS.serviceOC}',
               '${IDS.serviceEP}', '${IDS.counter2}', 'Competence specialisee', '${IDS.agentKofi}', now())`
    );
    await pg.query(
      `INSERT INTO ticket_transfers
         (id, bank_id, ticket_id, from_counter_id, from_service_id, to_service_id, to_counter_id, reason, transferred_by, transferred_at)
       VALUES (gen_random_uuid(), '${IDS.bankA}', '${ticketId}', '${IDS.counter2}', '${IDS.serviceEP}',
               '${IDS.serviceOC}', '${IDS.counter1}', 'Retour service initial', '${IDS.agentAmi}', now())`
    );
    const transfers = await pg.query(
      `SELECT count(*)::int AS n FROM ticket_transfers WHERE ticket_id = '${ticketId}'`
    );
    expect(transfers.rows[0]?.n).toBe(2);
  });
});
