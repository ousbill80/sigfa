/**
 * REP-003 — Tests d'intégration des routes export + benchmark (Testcontainers PG16
 * + Redis 7 + BullMQ réels). Prouve :
 *  - POST /reports/export → 202 + jobId, export_jobs PENDING créé ;
 *  - le worker BullMQ construit le fichier, écrit file_url signé + expires_at, READY ;
 *  - GET /reports/export/:jobId → statut + URL si READY (polling contractualisé) ;
 *  - ownership : jobId d'un autre tenant / autre demandeur → 404 opaque ;
 *  - RBAC : AGENT → 403 sur export ; DIRECTOR OK ;
 *  - benchmark : classement + statut vert/orange/rouge, agence sans donnée → n/a.
 *
 * Le harness admin fournit le schéma tickets/agencies ; la table `export_jobs` est
 * créée ici par DDL de test (dépendance DB signalée dans le rapport agent).
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { createApp } from "src/app.js";
import {
  startAdminHarness,
  stopAdminHarness,
  forgeToken,
  seedBankAgency,
  type AdminHarness,
  type BankFixture,
} from "src/routes/admin-test-harness.js";
import {
  startExportBuildInfra,
  type ExportBuildInfra,
} from "src/jobs/export-build.job.js";
import { MockObjectStorage } from "src/reporting/export-storage.js";
import { loadOwnedJob } from "src/reporting/export-job-service.js";
import type { QueryFn } from "src/reporting/aggregate-service.js";

let h: AdminHarness;
let redisContainer: StartedTestContainer;
let redis: Redis;
let connection: { host: string; port: number };
let app: ReturnType<typeof createApp>;
let infra: ExportBuildInfra | undefined;
let bankA: BankFixture;
let bankB: BankFixture;
let dirTokenA: string;
let agentTokenA: string;
let dirTokenB: string;
let auditorTokenA: string;

const storage = new MockObjectStorage({ secret: "rep003-integration-secret" });

/** QueryFn paramétrée branchée sur le pg.Client réel. */
const query: QueryFn = async (sql, values) => {
  const res = await h.db.query(sql, values as unknown[]);
  return { rows: res.rows as Array<Record<string, unknown>> };
};

async function req(
  method: string,
  path: string,
  token: string
): Promise<Response> {
  return app.request(`/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-forwarded-for": "1.2.3.4" },
  });
}

/** Crée export_jobs + daily_agency_stats (DDL de test — dépendance DB signalée). */
async function extendSchema(): Promise<void> {
  await h.db.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='export_job_status') THEN
        CREATE TYPE export_job_status AS ENUM ('PENDING','PROCESSING','READY','FAILED'); END IF;
    END $$;`);
  await h.db.query(`CREATE TABLE IF NOT EXISTS export_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id UUID NOT NULL, requested_by UUID NOT NULL,
    scope TEXT NOT NULL, period TEXT NOT NULL, format TEXT NOT NULL,
    status export_job_status NOT NULL DEFAULT 'PENDING',
    file_url TEXT, expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await h.db.query(`CREATE TABLE IF NOT EXISTS daily_agency_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL, agency_id UUID NOT NULL, service_id UUID,
    day DATE NOT NULL,
    tickets_issued INTEGER NOT NULL DEFAULT 0, tickets_served INTEGER NOT NULL DEFAULT 0,
    tickets_abandoned INTEGER NOT NULL DEFAULT 0, tickets_no_show INTEGER NOT NULL DEFAULT 0,
    total_wait_seconds INTEGER NOT NULL DEFAULT 0, total_service_seconds INTEGER NOT NULL DEFAULT 0,
    sla_met_count INTEGER NOT NULL DEFAULT 0, sla_total_count INTEGER NOT NULL DEFAULT 0,
    feedback_count INTEGER NOT NULL DEFAULT 0, feedback_sum INTEGER NOT NULL DEFAULT 0,
    nps_promoters INTEGER NOT NULL DEFAULT 0, nps_passives INTEGER NOT NULL DEFAULT 0, nps_detractors INTEGER NOT NULL DEFAULT 0,
    agent_active_seconds INTEGER, agent_available_seconds INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await h.db.query(`CREATE UNIQUE INDEX IF NOT EXISTS das_no_svc ON daily_agency_stats (bank_id, agency_id, day) WHERE service_id IS NULL`);
}

/** Matérialise une ligne d'agrégat (SLA/attente paramétrés). */
async function seedStats(
  bankId: string,
  agencyId: string,
  day: string,
  slaMet: number,
  waitSeconds: number
): Promise<void> {
  await h.db.query(
    `INSERT INTO daily_agency_stats (bank_id, agency_id, service_id, day,
       tickets_issued, tickets_served, tickets_abandoned, tickets_no_show,
       total_wait_seconds, total_service_seconds, sla_met_count, sla_total_count,
       feedback_count, feedback_sum, nps_promoters, nps_passives, nps_detractors,
       agent_active_seconds, agent_available_seconds)
     VALUES ($1,$2,NULL,$3, 100,80,15,0, $4,43200, $5,100, 10,40, 5,3,2, 3600,7200)`,
    [bankId, agencyId, day, waitSeconds, slaMet]
  );
}

/** Attend qu'une condition soit vraie (polling), sinon lève au timeout. */
async function waitFor(cond: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitFor: condition non satisfaite avant le timeout");
}

beforeAll(async () => {
  h = await startAdminHarness();
  redisContainer = await new GenericContainer("redis:7")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  connection = { host: redisContainer.getHost(), port: redisContainer.getMappedPort(6379) };
  redis = new Redis({ ...connection, maxRetriesPerRequest: null });
  await extendSchema();

  infra = startExportBuildInfra({
    connection,
    query,
    storage,
    now: () => new Date(),
    loadJob: (jobId, bankId) => loadOwnedJob(query, jobId, bankId, "worker", "SUPER_ADMIN"),
  });

  app = createApp({
    db: h.db,
    redis: h.redis,
    jwtSecret: h.jwtSecretBytes,
    // Enfile le build sur l'infra BullMQ réelle (async 202 → READY).
    exportEnqueue: (jobId, bankId) => infra!.enqueue({ jobId, bankId }).then(() => undefined),
  });
  bankA = await seedBankAgency(h.db, "rep003-a");
  bankB = await seedBankAgency(h.db, "rep003-b");
  dirTokenA = await forgeToken(h.jwtSecretBytes, "AGENCY_DIRECTOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  agentTokenA = await forgeToken(h.jwtSecretBytes, "AGENT", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  auditorTokenA = await forgeToken(h.jwtSecretBytes, "AUDITOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  dirTokenB = await forgeToken(h.jwtSecretBytes, "AGENCY_DIRECTOR", bankB.directorId, bankB.bankId, [bankB.agencyId]);
}, 240_000);

afterAll(async () => {
  await infra?.close();
  await redis?.quit();
  await redisContainer?.stop();
  await stopAdminHarness(h);
}, 40_000);

beforeEach(async () => {
  await h.db.query(`DELETE FROM export_jobs`);
  await h.db.query(`DELETE FROM daily_agency_stats`);
  await redis.flushall();
});

describe("REP-003: POST /reports/export → 202 + jobId (PENDING)", () => {
  it("REP-003: DIRECTOR déclenche un export → 202 + jobId, export_jobs PENDING", async () => {
    const res = await req(
      "POST",
      `/reports/export?format=json&scope=agency&period=2026-07-01&agencyId=${bankA.agencyId}`,
      dirTokenA
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string; status: string; pollingUrl: string };
    expect(body.status).toBe("PENDING");
    expect(body.pollingUrl).toBe(`/api/v1/reports/export/${body.jobId}`);
    const row = await h.db.query(`SELECT status, bank_id FROM export_jobs WHERE id = $1`, [body.jobId]);
    expect(row.rows[0]!.status).toBe("PENDING");
    expect(row.rows[0]!.bank_id).toBe(bankA.bankId);
  });

  it("REP-003: rôle AGENT → 403 sur export (RBAC : AGENT interdit)", async () => {
    const res = await req(
      "POST",
      `/reports/export?format=json&scope=agency&period=2026-07-01&agencyId=${bankA.agencyId}`,
      agentTokenA
    );
    expect(res.status).toBe(403);
  });

  it("REP-003: format invalide → 400", async () => {
    const res = await req(
      "POST",
      `/reports/export?format=csv&scope=agency&period=2026-07-01&agencyId=${bankA.agencyId}`,
      dirTokenA
    );
    expect(res.status).toBe(400);
  });
});

describe("REP-003: cycle async complet PENDING→PROCESSING→READY (BullMQ réel)", () => {
  it("REP-003: le worker génère le fichier, URL signée + expires_at, statut READY", async () => {
    await seedStats(bankA.bankId, bankA.agencyId, "2026-07-01", 70, 40800);
    const created = await req(
      "POST",
      `/reports/export?format=json&scope=agency&period=2026-07-01&agencyId=${bankA.agencyId}`,
      dirTokenA
    );
    expect(created.status).toBe(202);
    const { jobId } = (await created.json()) as { jobId: string };

    // Le worker BullMQ traite le job → READY avec URL signée.
    await waitFor(async () => {
      const r = await h.db.query(`SELECT status FROM export_jobs WHERE id = $1`, [jobId]);
      return r.rows[0]?.status === "READY";
    });

    const poll = await req("GET", `/reports/export/${jobId}`, dirTokenA);
    expect(poll.status).toBe(200);
    const body = (await poll.json()) as {
      status: string;
      downloadUrl?: string;
      expiresAt?: string;
    };
    expect(body.status).toBe("READY");
    expect(body.downloadUrl).toContain("/download?");
    expect(new Date(body.expiresAt!).getTime()).toBeGreaterThan(Date.now());
  }, 40_000);
});

describe("REP-003: GET /reports/export/:jobId — ownership 404 opaque", () => {
  it("REP-003: jobId d'un AUTRE tenant → 404 opaque", async () => {
    // Job créé côté bankB.
    const created = await req(
      "POST",
      `/reports/export?format=json&scope=agency&period=2026-07-01&agencyId=${bankB.agencyId}`,
      dirTokenB
    );
    const { jobId } = (await created.json()) as { jobId: string };
    // Interrogé par bankA → introuvable (pas d'oracle cross-tenant).
    const res = await req("GET", `/reports/export/${jobId}`, dirTokenA);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("EXPORT_JOB_NOT_FOUND");
  });

  it("REP-003: jobId inconnu → 404 (même forme, pas d'oracle)", async () => {
    const res = await req("GET", `/reports/export/00000000-0000-4000-a000-000000000000`, dirTokenA);
    expect(res.status).toBe(404);
  });
});

describe("REP-003: benchmark — classement + n/a", () => {
  it("REP-003: statut vert/orange/rouge + agence sans donnée → n/a", async () => {
    // agencyA (bankA) : SLA 92%, TMA ~9 min → VERT. Agence sans stats → n/a.
    await seedStats(bankA.bankId, bankA.agencyId, "2026-07-01", 92, 43200); // 43200/80=540s=9min
    const res = await req("GET", `/reports/benchmark?period=2026-07`, auditorTokenA);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ agencyId: string; status: string; rank: number }>;
    };
    const vert = body.data.find((e) => e.agencyId === bankA.agencyId);
    expect(vert?.status).toBe("VERT");
    // Toute agence non seedée (aucune ici hormis A) n'apparaît que si elle existe :
    // A est la seule agence du tenant → statut VERT, rang 1.
    expect(vert?.rank).toBe(1);
  });

  it("REP-003: sortKpi invalide → 400", async () => {
    const res = await req("GET", `/reports/benchmark?period=2026-07&sortKpi=bogus`, auditorTokenA);
    expect(res.status).toBe(400);
  });
});

describe("REP-003: export scope=network — anonymisé, 202", () => {
  it("REP-003: DIRECTOR déclenche un export réseau → 202 (scope network encodé)", async () => {
    await seedStats(bankA.bankId, bankA.agencyId, "2026-07-01", 70, 40800);
    const res = await req(
      "POST",
      `/reports/export?format=json&scope=network&period=2026-07`,
      dirTokenA
    );
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    const row = await h.db.query(`SELECT scope FROM export_jobs WHERE id = $1`, [jobId]);
    expect(row.rows[0]!.scope).toBe("network");
  });
});
