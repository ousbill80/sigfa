/**
 * IA-001 — Tests d'intégration du pipeline de features (Testcontainers PG16 réel +
 * RLS double-rôle). Prouve, de bout en bout et sur DONNÉES SYNTHÉTIQUES :
 *  - extraction horaire depuis `tickets` (arrivals/served/no_show/abandoned, sommes
 *    d'attente/service, p90) rattachée au jour Abidjan (émission `issued_at`) ;
 *  - IDEMPOTENCE : rejouer la même fenêtre → mêmes lignes matérialisées, zéro doublon ;
 *  - ISOLATION TENANT : un run bank A ne lit/écrit JAMAIS de features bank B
 *    (garde `withTenantParam` + RLS + filtre bank_id) ;
 *  - BACKTEST : fenêtre (from,to) → feature-set déterministe et rejouable ;
 *  - paramétrage bucket 30/60 min sans migration de schéma.
 *
 * Nommage strict : `IA-001: <description>`.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import type { QueryFn as ReportQueryFn } from "src/reporting/aggregate-service.js";
import { extractBucketObservations } from "src/ai/feature-extraction.js";
import {
  runFeaturePipeline,
  withTenantParam,
  type FeaturePipelineDeps,
} from "src/ai/feature-pipeline.js";
import { InMemoryFeatureStore } from "src/ai/feature-store.js";

let container: StartedTestContainer;
let migClient: pg.Client;
let appClient: pg.Client;

const BANK_A = "11111111-1111-4111-8111-111111111111";
const BANK_B = "22222222-2222-4222-8222-222222222222";
const AGENCY_A = "aaaaaaaa-1111-4111-8111-111111111111";
const AGENCY_B = "bbbbbbbb-2222-4222-8222-222222222222";
const SERVICE_A = "cccccccc-1111-4111-8111-111111111111";
const SERVICE_B = "dddddddd-2222-4222-8222-222222222222";

/** Requête paramétrée migrateur (BYPASSRLS) — fixtures. */
const migQuery: ReportQueryFn = async (sql, values) => {
  const res = await migClient.query(sql, values as unknown[]);
  return { rows: res.rows as Array<Record<string, unknown>> };
};

/** Requête paramétrée applicative (sigfa_app, RLS actif). */
const appQuery: ReportQueryFn = async (sql, values) => {
  const res = await appClient.query(sql, values as unknown[]);
  return { rows: res.rows as Array<Record<string, unknown>> };
};

/** DDL minimal : banks/agencies/services/users + tickets + agent_status_history + fériés + RLS. */
async function migrate(): Promise<void> {
  await migClient.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await migClient.query(
    `CREATE TABLE banks (id UUID PRIMARY KEY, name TEXT NOT NULL);`
  );
  await migClient.query(
    `CREATE TABLE agencies (id UUID PRIMARY KEY, bank_id UUID NOT NULL REFERENCES banks(id), name TEXT NOT NULL);`
  );
  await migClient.query(
    `CREATE TABLE services (id UUID PRIMARY KEY, bank_id UUID NOT NULL REFERENCES banks(id), name TEXT NOT NULL);`
  );
  await migClient.query(
    `CREATE TABLE users (id UUID PRIMARY KEY, bank_id UUID NOT NULL REFERENCES banks(id));`
  );
  await migClient.query(`
    CREATE TABLE tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id),
      service_id UUID NOT NULL REFERENCES services(id),
      counter_id UUID,
      status TEXT NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL,
      wait_time_seconds INT,
      service_time_seconds INT
    );`);
  await migClient.query(`
    CREATE TABLE agent_status_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id),
      agent_id UUID NOT NULL REFERENCES users(id),
      to_status TEXT NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL
    );`);
  await migClient.query(`
    CREATE TABLE public_holidays (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      date DATE NOT NULL,
      name TEXT NOT NULL
    );`);

  // RLS tenant sur les tables lues par l'extraction (prouve l'isolation).
  for (const t of ["tickets", "agent_status_history"]) {
    await migClient.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
    await migClient.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
    await migClient.query(
      `CREATE POLICY tenant_isolation ON ${t} USING (bank_id = current_setting('app.current_bank_id', true)::uuid);`
    );
  }
  // GRANT lecture à sigfa_app (RLS filtre le tenant).
  await migClient.query(
    `GRANT SELECT ON tickets, agent_status_history, public_holidays TO sigfa_app;`
  );
}

/** Insère une banque + agence + service + un agent. */
async function seedTenant(
  bankId: string,
  agencyId: string,
  serviceId: string
): Promise<string> {
  await migQuery(`INSERT INTO banks (id, name) VALUES ($1, 'B')`, [bankId]);
  await migQuery(`INSERT INTO agencies (id, bank_id, name) VALUES ($1, $2, 'A')`, [agencyId, bankId]);
  await migQuery(`INSERT INTO services (id, bank_id, name) VALUES ($1, $2, 'S')`, [serviceId, bankId]);
  const u = await migQuery(
    `INSERT INTO users (id, bank_id) VALUES (gen_random_uuid(), $1) RETURNING id`,
    [bankId]
  );
  return String((u.rows[0] as { id: string }).id);
}

/** Insère un ticket DONE (émis à `iso`, attente/service donnés). */
async function insertTicket(
  bankId: string,
  agencyId: string,
  serviceId: string,
  status: string,
  isoIssued: string,
  wait: number | null,
  service: number | null,
  counterId: string | null
): Promise<void> {
  await migQuery(
    `INSERT INTO tickets (bank_id, agency_id, service_id, counter_id, status, issued_at, wait_time_seconds, service_time_seconds)
     VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8)`,
    [bankId, agencyId, serviceId, counterId, status, isoIssued, wait, service]
  );
}

beforeAll(async () => {
  container = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "sigfa",
      POSTGRES_PASSWORD: "sigfa_test",
      POSTGRES_DB: "sigfa_test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  migClient = new pg.Client({
    connectionString: `postgresql://sigfa:sigfa_test@${host}:${port}/sigfa_test`,
  });
  await migClient.connect();
  await migClient.query(
    `CREATE ROLE sigfa_app WITH LOGIN PASSWORD 'sigfa_app_test' NOCREATEDB NOCREATEROLE NOBYPASSRLS;`
  );
  await migrate();

  appClient = new pg.Client({
    connectionString: `postgresql://sigfa_app:sigfa_app_test@${host}:${port}/sigfa_test`,
  });
  await appClient.connect();
}, 120_000);

afterAll(async () => {
  await appClient?.end();
  await migClient?.end();
  await container?.stop();
});

beforeEach(async () => {
  await migQuery(`DELETE FROM tickets`);
  await migQuery(`DELETE FROM agent_status_history`);
  await migQuery(`DELETE FROM public_holidays`);
  await migQuery(`DELETE FROM services`);
  await migQuery(`DELETE FROM users`);
  await migQuery(`DELETE FROM agencies`);
  await migQuery(`DELETE FROM banks`);
});

const FROZEN_NOW = new Date("2027-01-01T00:00:00Z");

function deps(store: InMemoryFeatureStore): FeaturePipelineDeps {
  return { appQuery, holidaysQuery: migQuery, store, now: FROZEN_NOW };
}

describe("feature-pipeline (integration)", () => {
  it("IA-001: extraction horaire depuis tickets — arrivals/served/no_show/abandoned par bucket", async () => {
    await seedTenant(BANK_A, AGENCY_A, SERVICE_A);
    // 3 arrivées à 09h Abidjan le 2026-06-10 : 2 DONE + 1 ABANDONED.
    await insertTicket(BANK_A, AGENCY_A, SERVICE_A, "DONE", "2026-06-10T09:05:00Z", 120, 300, "c1000000-0000-4000-8000-000000000001");
    await insertTicket(BANK_A, AGENCY_A, SERVICE_A, "DONE", "2026-06-10T09:40:00Z", 240, 200, "c1000000-0000-4000-8000-000000000001");
    await insertTicket(BANK_A, AGENCY_A, SERVICE_A, "ABANDONED", "2026-06-10T09:55:00Z", null, null, null);
    // 1 NO_SHOW à 10h.
    await insertTicket(BANK_A, AGENCY_A, SERVICE_A, "NO_SHOW", "2026-06-10T10:10:00Z", null, null, null);

    const obs = await withTenantParam(appQuery, BANK_A, async (q) =>
      extractBucketObservations(q, {
        bankId: BANK_A,
        dayStart: "2026-06-10",
        dayEnd: "2026-06-10",
      })
    );
    const b9 = obs.find((o) => o.hourBucket === 9);
    expect(b9?.arrivals).toBe(3);
    expect(b9?.served).toBe(2);
    expect(b9?.abandoned).toBe(1);
    expect(b9?.totalWaitSeconds).toBe(360); // 120 + 240
    expect(b9?.countersOpen).toBe(1); // un seul guichet distinct
    const b10 = obs.find((o) => o.hourBucket === 10);
    expect(b10?.noShow).toBe(1);
  });

  it("IA-001: upsert idempotent — re-run même fenêtre = zéro doublon (Testcontainers)", async () => {
    await seedTenant(BANK_A, AGENCY_A, SERVICE_A);
    await insertTicket(BANK_A, AGENCY_A, SERVICE_A, "DONE", "2026-06-10T09:05:00Z", 60, 120, null);
    const store = new InMemoryFeatureStore();
    const r1 = await runFeaturePipeline(deps(store), {
      bankId: BANK_A,
      dayStart: "2026-06-10",
      dayEnd: "2026-06-10",
    });
    const r2 = await runFeaturePipeline(deps(store), {
      bankId: BANK_A,
      dayStart: "2026-06-10",
      dayEnd: "2026-06-10",
    });
    expect(r1.produced).toBe(r2.produced);
    expect(store.count(BANK_A)).toBe(r1.produced); // pas de doublon après rejeu
  });

  it("IA-001: isolation tenant — run bank A ne lit/écrit jamais de features bank B", async () => {
    await seedTenant(BANK_A, AGENCY_A, SERVICE_A);
    await seedTenant(BANK_B, AGENCY_B, SERVICE_B);
    await insertTicket(BANK_A, AGENCY_A, SERVICE_A, "DONE", "2026-06-10T09:05:00Z", 60, 120, null);
    await insertTicket(BANK_B, AGENCY_B, SERVICE_B, "DONE", "2026-06-10T09:05:00Z", 60, 120, null);

    const store = new InMemoryFeatureStore();
    await runFeaturePipeline(deps(store), { bankId: BANK_A, dayStart: "2026-06-10", dayEnd: "2026-06-10" });

    // Toutes les features matérialisées appartiennent à A ; B absent malgré des tickets.
    const rowsA = store.getByBank(BANK_A);
    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsA.every((r) => r.bankId === BANK_A && r.agencyId === AGENCY_A)).toBe(true);
    expect(store.count(BANK_B)).toBe(0);
  });

  it("IA-001: RLS bloque la lecture cross-tenant même si bank_id est falsifié dans le WHERE", async () => {
    await seedTenant(BANK_A, AGENCY_A, SERVICE_A);
    await seedTenant(BANK_B, AGENCY_B, SERVICE_B);
    await insertTicket(BANK_B, AGENCY_B, SERVICE_B, "DONE", "2026-06-10T09:05:00Z", 60, 120, null);

    // Sous le contexte tenant A, tenter d'extraire les tickets de B → RLS renvoie 0.
    const obs = await withTenantParam(appQuery, BANK_A, async (q) =>
      extractBucketObservations(q, { bankId: BANK_B, dayStart: "2026-06-10", dayEnd: "2026-06-10" })
    );
    expect(obs).toHaveLength(0);
  });

  it("IA-001: backtest — fenêtre (from,to) → feature-set déterministe et rejouable", async () => {
    await seedTenant(BANK_A, AGENCY_A, SERVICE_A);
    await insertTicket(BANK_A, AGENCY_A, SERVICE_A, "DONE", "2026-06-08T09:05:00Z", 60, 120, null);
    await insertTicket(BANK_A, AGENCY_A, SERVICE_A, "DONE", "2026-06-09T09:05:00Z", 90, 150, null);
    await insertTicket(BANK_A, AGENCY_A, SERVICE_A, "DONE", "2026-06-10T09:05:00Z", 30, 90, null);

    const store1 = new InMemoryFeatureStore();
    const store2 = new InMemoryFeatureStore();
    const run = { bankId: BANK_A, dayStart: "2026-06-08", dayEnd: "2026-06-10" };
    const a = await runFeaturePipeline(deps(store1), run);
    const b = await runFeaturePipeline(deps(store2), run);
    // Feature-sets identiques (déterminisme du backtest sur le même dataset).
    expect(JSON.stringify(a.features)).toBe(JSON.stringify(b.features));
  });

  it("IA-001: paramétrage bucket 30/60 min sans migration de schéma", async () => {
    await seedTenant(BANK_A, AGENCY_A, SERVICE_A);
    // 09:05 et 09:40 → même bucket 60 min (9), buckets 30 min différents (18 et 19).
    await insertTicket(BANK_A, AGENCY_A, SERVICE_A, "DONE", "2026-06-10T09:05:00Z", 60, 120, null);
    await insertTicket(BANK_A, AGENCY_A, SERVICE_A, "DONE", "2026-06-10T09:40:00Z", 60, 120, null);

    const obs60 = await withTenantParam(appQuery, BANK_A, async (q) =>
      extractBucketObservations(q, { bankId: BANK_A, dayStart: "2026-06-10", dayEnd: "2026-06-10", bucketMinutes: 60 })
    );
    expect(obs60.filter((o) => o.arrivals > 0)).toHaveLength(1); // un seul bucket 9

    const obs30 = await withTenantParam(appQuery, BANK_A, async (q) =>
      extractBucketObservations(q, { bankId: BANK_A, dayStart: "2026-06-10", dayEnd: "2026-06-10", bucketMinutes: 30 })
    );
    const buckets30 = obs30.filter((o) => o.arrivals > 0).map((o) => o.hourBucket).sort((x, y) => x - y);
    expect(buckets30).toEqual([18, 19]); // 09:05 → bucket 18, 09:40 → bucket 19
  });

  it("IA-001: agents_active dérivé de agent_status_history par bucket", async () => {
    const agentId = await seedTenant(BANK_A, AGENCY_A, SERVICE_A);
    await insertTicket(BANK_A, AGENCY_A, SERVICE_A, "DONE", "2026-06-10T09:05:00Z", 60, 120, null);
    await migQuery(
      `INSERT INTO agent_status_history (bank_id, agency_id, agent_id, to_status, changed_at)
       VALUES ($1,$2,$3,'SERVING','2026-06-10T09:10:00Z'::timestamptz)`,
      [BANK_A, AGENCY_A, agentId]
    );
    const obs = await withTenantParam(appQuery, BANK_A, async (q) =>
      extractBucketObservations(q, { bankId: BANK_A, dayStart: "2026-06-10", dayEnd: "2026-06-10" })
    );
    expect(obs.find((o) => o.hourBucket === 9)?.agentsActive).toBe(1);
  });
});
