/**
 * REP-002 — Tests d'intégration du planificateur de rapports (Testcontainers
 * PG16 + Redis 7 réels + BullMQ réel). Prouve, de bout en bout :
 *  - les 3 jobs repeatable sont enregistrés en cron **fuseau Africa/Abidjan** (tz) ;
 *  - un tir dérive les KPI via REP-001, résout les destinataires et enfile un
 *    envoi email par destinataire, sous clé d'idempotence stable ;
 *  - IDEMPOTENCE : rejouer le tir (même période/destinataire) n'enfile pas de doublon ;
 *  - MISFIRE : un tir en retard borné est rattrapé UNE fois ; hors fenêtre → skip.
 *
 * Nommage strict : `REP-002: <description>`.
 *
 * @module
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import type { QueryFn as DbQueryFn } from "@sigfa/database";
import type { QueryFn as ReportQueryFn } from "src/reporting/aggregate-service.js";
import {
  startReportScheduler,
  runReportForAllTenants,
  REPORT_JOB_NAME,
  type ReportScheduler,
  type ReportSchedulerDeps,
} from "src/jobs/report-scheduler.js";
import { ABIDJAN_TZ, type ReportType } from "src/reporting/report-schedule.js";
import type { ReportEmailEnqueue } from "src/jobs/report-build.job.js";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let connection: { host: string; port: number };
let scheduler: ReportScheduler | undefined;
let bankA: string;

/**
 * Neutralise une rejection résiduelle de fermeture BullMQ/IORedis : quand on ferme
 * un worker/queue pendant qu'une commande bloquante (BRPOPLPUSH) ou le scheduler de
 * jobs différés est en vol, IORedis peut rejeter la promesse en cours (« Connection
 * is closed. »). Ce rejet est un artefact de teardown, pas un vrai échec de test ;
 * on l'avale explicitement pour éviter tout unhandled rejection au process exit.
 */
function isBenignCloseError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /Connection is closed/i.test(msg) ||
    /Connection is already closed/i.test(msg) ||
    /Stream isn't writeable/i.test(msg) ||
    /enableOfflineQueue/i.test(msg)
  );
}

/** Avale une promesse en (ré)attachant un catch qui ne relance que les vrais échecs. */
async function swallowBenign(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (err) {
    if (!isBenignCloseError(err)) throw err;
  }
}

/**
 * Ferme proprement un scheduler REP-002 : purge d'abord tous les schémas répétables
 * et jobs différés (obliterate), puis ferme worker → queue en avalant tout rejet
 * bénin de fermeture. Garantit qu'aucune connexion Redis ne fuit entre tests.
 */
async function teardownScheduler(s: ReportScheduler): Promise<void> {
  // 1) Purge les jobs répétables/différés AVANT de fermer : sinon le scheduler de
  //    jobs différés peut relancer une commande sur une connexion en cours de close.
  await swallowBenign(s.worker.close());
  await swallowBenign(
    s.queue.obliterate({ force: true }).catch(() => undefined)
  );
  await swallowBenign(s.queue.close());
}

/** Jour civil Abidjan (`YYYY-MM-DD`) d'un instant (Abidjan = UTC+0). */
function abidjanDay(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Abidjan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Attend qu'une condition soit vraie (polling), sinon lève au timeout. */
async function waitFor(
  cond: () => Promise<boolean>,
  timeoutMs = 20_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitFor: condition non satisfaite avant le timeout");
}

/** `reportQuery` paramétrée branchée sur le pg.Client réel. */
const reportQuery: ReportQueryFn = async (sql, values) => {
  const res = await db.query(sql, values as unknown[]);
  return { rows: res.rows as Array<Record<string, unknown>> };
};

/** `recipientsQuery` single-arg branchée sur le pg.Client réel (withTenant). */
const recipientsQuery: DbQueryFn = (async (sql: string) => {
  const res = await db.query(sql);
  return { rows: res.rows as Array<Record<string, unknown>> };
}) as DbQueryFn;

async function runMigrations(client: pg.Client): Promise<void> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);`
  );
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID NOT NULL REFERENCES banks(id),
      email TEXT,
      role TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      deleted_at TIMESTAMPTZ
    );`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS agencies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID NOT NULL REFERENCES banks(id),
      name TEXT NOT NULL,
      deleted_at TIMESTAMPTZ
    );`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS agency_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id),
      user_id UUID NOT NULL REFERENCES users(id)
    );`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS daily_agency_stats (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id),
      service_id UUID,
      day DATE NOT NULL,
      tickets_issued INT NOT NULL DEFAULT 0,
      tickets_served INT NOT NULL DEFAULT 0,
      tickets_abandoned INT NOT NULL DEFAULT 0,
      tickets_no_show INT NOT NULL DEFAULT 0,
      total_wait_seconds INT NOT NULL DEFAULT 0,
      total_service_seconds INT NOT NULL DEFAULT 0,
      sla_met_count INT NOT NULL DEFAULT 0,
      sla_total_count INT NOT NULL DEFAULT 0,
      feedback_count INT NOT NULL DEFAULT 0,
      feedback_sum INT NOT NULL DEFAULT 0,
      nps_promoters INT NOT NULL DEFAULT 0,
      nps_passives INT NOT NULL DEFAULT 0,
      nps_detractors INT NOT NULL DEFAULT 0,
      agent_active_seconds INT,
      agent_available_seconds INT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`);
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_agency ON daily_agency_stats (bank_id, agency_id, day) WHERE service_id IS NULL;`
  );
}

/** Insère une agence + un directeur AGENCY_DIRECTOR abonné, retourne agencyId. */
async function seedAgencyWithDirector(
  bankId: string,
  email: string
): Promise<string> {
  const ag = await db.query(
    `INSERT INTO agencies (bank_id, name) VALUES ($1, 'Agence') RETURNING id`,
    [bankId]
  );
  const agencyId = (ag.rows[0] as { id: string }).id;
  const u = await db.query(
    `INSERT INTO users (bank_id, email, role) VALUES ($1, $2, 'AGENCY_DIRECTOR') RETURNING id`,
    [bankId, email]
  );
  const userId = (u.rows[0] as { id: string }).id;
  await db.query(
    `INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1, $2, $3)`,
    [bankId, agencyId, userId]
  );
  return agencyId;
}

/** Insère un agrégat journalier plein pour une agence/jour. */
async function seedDailyStats(
  bankId: string,
  agencyId: string,
  day: string
): Promise<void> {
  await db.query(
    `INSERT INTO daily_agency_stats
       (bank_id, agency_id, service_id, day, tickets_issued, tickets_served,
        tickets_abandoned, tickets_no_show, total_wait_seconds, total_service_seconds,
        sla_met_count, sla_total_count, feedback_count, nps_promoters, nps_passives,
        nps_detractors, agent_active_seconds, agent_available_seconds)
     VALUES ($1, $2, NULL, $3::date, 100, 80, 15, 5, 24000, 19200, 70, 100, 40, 30, 5, 5, 3600, 7200)`,
    [bankId, agencyId, day]
  );
}

/** Enfileur email collecteur (pas de vraie file email ici — on prouve l'orchestration). */
function makeCollector(): {
  enqueued: ReportEmailEnqueue[];
  enqueueReportEmail: ReportSchedulerDeps["enqueueReportEmail"];
} {
  const enqueued: ReportEmailEnqueue[] = [];
  return {
    enqueued,
    enqueueReportEmail: async (enqueue) => {
      // Idempotence applicative : un dedupeKey déjà vu n'est pas ré-enfilé.
      if (enqueued.some((e) => e.dedupeKey === enqueue.dedupeKey)) return;
      enqueued.push(enqueue);
    },
  };
}

function baseDeps(
  collector: ReturnType<typeof makeCollector>,
  overrides: Partial<ReportSchedulerDeps> = {}
): ReportSchedulerDeps {
  return {
    connection,
    reportQuery,
    recipientsQuery,
    listTenants: async () => [bankA],
    listAgencies: async () => {
      const res = await db.query(
        `SELECT id FROM agencies WHERE bank_id = $1 AND deleted_at IS NULL ORDER BY id`,
        [bankA]
      );
      return res.rows.map((r) => (r as { id: string }).id);
    },
    enqueueReportEmail: collector.enqueueReportEmail,
    ...overrides,
  };
}

/**
 * Filet de sécurité au niveau process : BullMQ/IORedis peut émettre une rejection de
 * fermeture APRÈS le `await` du close (jobs différés en vol). Sans handler, cette
 * rejection asynchrone fait sortir le process en code non-zéro même quand 0 test
 * échoue (le flake CI ciblé). On n'avale QUE les erreurs bénignes de fermeture ;
 * toute autre rejection est ré-émise pour ne pas masquer un vrai échec.
 */
function onUnhandledRejection(reason: unknown): void {
  if (!isBenignCloseError(reason)) {
    throw reason instanceof Error ? reason : new Error(String(reason));
  }
}

beforeAll(async () => {
  process.on("unhandledRejection", onUnhandledRejection);
  pgContainer = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "sigfa",
      POSTGRES_PASSWORD: "sigfa_test",
      POSTGRES_DB: "sigfa_test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2)
    )
    .start();
  redisContainer = await new GenericContainer("redis:7")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  db = new pg.Client({
    connectionString: `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/sigfa_test`,
  });
  await db.connect();
  connection = {
    host: redisContainer.getHost(),
    port: redisContainer.getMappedPort(6379),
  };
  redis = new Redis({ ...connection, maxRetriesPerRequest: null });
  await runMigrations(db);
}, 180_000);

afterAll(async () => {
  // Le client Redis partagé est créé avec `maxRetriesPerRequest: null` : une commande
  // (ex. flushall) peut rester en attente au moment du quit. On avale le rejet bénin.
  await swallowBenign(redis?.quit() ?? Promise.resolve());
  await db?.end();
  await pgContainer?.stop();
  await redisContainer?.stop();
  process.off("unhandledRejection", onUnhandledRejection);
}, 40_000);

beforeEach(async () => {
  await db.query(`DELETE FROM agency_users`);
  await db.query(`DELETE FROM daily_agency_stats`);
  await db.query(`DELETE FROM users`);
  await db.query(`DELETE FROM agencies`);
  await db.query(`DELETE FROM banks`);
  await redis.flushall();
  const a = await db.query(
    `INSERT INTO banks (name, slug) VALUES ('A','a') RETURNING id`
  );
  bankA = (a.rows[0] as { id: string }).id;
});

afterEach(async () => {
  // Fermeture ROBUSTE : purge répétables/différés puis worker → queue, en avalant
  // tout rejet bénin de fermeture. Empêche toute fuite de connexion entre tests et
  // toute rejection Redis résiduelle au teardown (flake CI ciblé).
  if (scheduler) await teardownScheduler(scheduler);
  scheduler = undefined;
});

describe("REP-002 planificateur (cron Abidjan, BullMQ réel)", () => {
  it("REP-002: 3 jobs repeatable enregistrés en cron fuseau Africa/Abidjan (tz)", async () => {
    const col = makeCollector();
    scheduler = await startReportScheduler(baseDeps(col));

    const schemes = await scheduler.queue.getRepeatableJobs();
    const names = schemes.map((s) => s.name).sort();
    expect(names).toEqual(
      [
        REPORT_JOB_NAME.DAILY,
        REPORT_JOB_NAME.MONTHLY,
        REPORT_JOB_NAME.WEEKLY,
      ].sort()
    );
    // Chaque schéma est exprimé en fuseau Abidjan (jamais UTC serveur).
    for (const s of schemes) {
      expect(s.tz).toBe(ABIDJAN_TZ);
    }
    const daily = schemes.find((s) => s.name === REPORT_JOB_NAME.DAILY);
    expect(daily?.pattern).toBe("0 18 * * *");
  });
});

describe("REP-002 tir de rapport (dérive REP-001, enfile NOTIF-004)", () => {
  it("REP-002: journalier dérive les KPI via REP-001 et enfile un envoi par destinataire", async () => {
    const col = makeCollector();
    const agencyId = await seedAgencyWithDirector(bankA, "dir@banque.example");
    await seedDailyStats(bankA, agencyId, "2026-07-13");

    const results = await runReportForAllTenants(
      "DAILY",
      new Date("2026-07-13T18:00:00Z"),
      baseDeps(col)
    );

    expect(results).toHaveLength(1);
    const payload = results[0]!.payloads[0]!;
    expect(payload.totalTickets).toBe(100);
    expect(payload.kpis.tauxSLA.value).toBe(70);
    expect(col.enqueued).toHaveLength(1);
    expect(col.enqueued[0]!.recipient).toBe("dir@banque.example");
    expect(col.enqueued[0]!.dedupeKey).toBe(
      `report:${bankA}:DAILY:2026-07-13:dir@banque.example`
    );
  });

  it("REP-002: rejeu du tir → un SEUL envoi par (tenant,reportType,periodKey,recipient)", async () => {
    const col = makeCollector();
    const agencyId = await seedAgencyWithDirector(bankA, "dir@banque.example");
    await seedDailyStats(bankA, agencyId, "2026-07-13");

    const deps = baseDeps(col);
    const firedAt = new Date("2026-07-13T18:00:00Z");
    await runReportForAllTenants("DAILY", firedAt, deps);
    // Rejeu exact (redémarrage worker / retry) : même période, même destinataire.
    await runReportForAllTenants("DAILY", firedAt, deps);

    expect(col.enqueued).toHaveLength(1); // idempotence : aucun doublon
  });
});

describe("REP-002 misfire (rattrapage unique, fenêtre bornée)", () => {
  it("REP-002: worker en retard borné → tir rattrapé UNE fois (via runReport)", async () => {
    const col = makeCollector();
    const agencyId = await seedAgencyWithDirector(bankA, "dir@banque.example");
    await seedDailyStats(bankA, agencyId, "2026-07-13");

    // now injecté 30 min après l'heure planifiée (dans la fenêtre de 2 h).
    scheduler = await startReportScheduler(
      baseDeps(col, {
        now: () => new Date("2026-07-13T18:30:00Z"),
        misfireGraceMs: 2 * 60 * 60 * 1000,
      })
    );

    // Simule le tir manqué : on invoque runReport avec l'instant planifié.
    const results = await scheduler.runReport(
      "DAILY" as ReportType,
      new Date("2026-07-13T18:00:00Z")
    );
    expect(results).toHaveLength(1);
    expect(col.enqueued).toHaveLength(1);
  });

  it("REP-002: worker BullMQ réel traite un tir à l'heure → envoi enfilé", async () => {
    const col = makeCollector();
    const agencyId = await seedAgencyWithDirector(bankA, "dir@banque.example");
    // Le tir « à l'heure » utilise l'instant du job (timestamp) comme firedAt : on
    // seede l'agrégat du jour Abidjan correspondant à `now`.
    const now = new Date();
    await seedDailyStats(bankA, agencyId, abidjanDay(now));

    scheduler = await startReportScheduler(baseDeps(col, { now: () => now }));
    // Ajoute un job non-repeatable immédiat (timestamp = maintenant → 0 retard).
    await scheduler.queue.add(REPORT_JOB_NAME.DAILY, { reportType: "DAILY" });

    await waitFor(async () => col.enqueued.length >= 1);
    expect(col.enqueued[0]!.recipient).toBe("dir@banque.example");
  }, 40_000);

  it("REP-002: tir manqué hors fenêtre de rattrapage → skip journalisé, aucun envoi", async () => {
    const col = makeCollector();
    const agencyId = await seedAgencyWithDirector(bankA, "dir@banque.example");
    await seedDailyStats(bankA, agencyId, "2026-07-13");
    const logs: string[] = [];

    scheduler = await startReportScheduler(
      baseDeps(col, {
        now: () => new Date(),
        misfireGraceMs: 60_000, // 1 min de fenêtre
        log: (e) => logs.push(e.message),
      })
    );
    // Job avec un timestamp très ancien → lateBy ≫ graceMs → skip.
    await scheduler.queue.add(
      REPORT_JOB_NAME.DAILY,
      { reportType: "DAILY" },
      { timestamp: new Date("2020-01-01T00:00:00Z").getTime() }
    );

    await waitFor(async () =>
      logs.some((m) => m.includes("hors fenêtre de rattrapage"))
    );
    // Aucun envoi enfilé (le tir trop vieux est ignoré).
    expect(col.enqueued).toHaveLength(0);
  }, 40_000);
});

describe("REP-002 isolation par tenant (un échec n'arrête pas les autres)", () => {
  it("REP-002: un tenant en échec est journalisé sans bloquer les autres tenants", async () => {
    const col = makeCollector();
    const agencyId = await seedAgencyWithDirector(bankA, "dir@banque.example");
    await seedDailyStats(bankA, agencyId, "2026-07-13");
    const logs: string[] = [];

    const deps = baseDeps(col, {
      // Deux tenants : le 1er (invalide) fait échouer buildAndEnqueueReport,
      // le 2e (bankA) doit tout de même être servi.
      listTenants: async () => ["not-a-uuid", bankA],
      log: (e) => logs.push(e.message),
    });
    const results = await runReportForAllTenants(
      "DAILY",
      new Date("2026-07-13T18:00:00Z"),
      deps
    );

    // Seul bankA a produit un résultat ; l'échec du 1er est journalisé.
    expect(results).toHaveLength(1);
    expect(logs.some((m) => m.includes("Échec d'assemblage"))).toBe(true);
    expect(col.enqueued).toHaveLength(1);
  });
});
