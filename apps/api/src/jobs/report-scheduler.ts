/**
 * REP-002 — Planificateur BullMQ des rapports auto (journalier/hebdo/mensuel).
 *
 * LA LOI (REP-002) :
 *  - Trois jobs BullMQ REPEATABLE en cron **fuseau `Africa/Abidjan`**
 *    (option `repeat.tz` — jamais l'heure locale du serveur).
 *  - À chaque tir : pour CHAQUE tenant, dérive les KPI via REP-001, construit le
 *    payload, enfile un envoi email NOTIF-004 par destinataire (idempotent).
 *  - **Misfire** : au démarrage du worker, si un tir a été manqué (downtime), on le
 *    rattrape UNE SEULE FOIS dans une fenêtre bornée ; sinon on skippe (journalisé).
 *    L'idempotence `(tenant,reportType,periodKey,recipient)` empêche tout doublon.
 *
 * Le module wire BullMQ ; la logique testable sans BullMQ vit dans
 * `report-build.job.ts` et `report-schedule.ts`.
 *
 * @module
 */

import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import {
  ABIDJAN_TZ,
  REPORT_CRONS,
  REPORT_TYPES,
  decideMisfire,
  type ReportType,
} from "src/reporting/report-schedule.js";
import {
  buildAndEnqueueReport,
  type BuildReportDeps,
  type BuildReportResult,
} from "src/jobs/report-build.job.js";

/** Nom de la file BullMQ des rapports planifiés. */
export const REPORT_QUEUE_NAME = "sigfa-reports";

/** Nom du job repeatable par type de rapport. */
export const REPORT_JOB_NAME: Record<ReportType, string> = {
  DAILY: "daily-report",
  WEEKLY: "weekly-report",
  MONTHLY: "monthly-report",
};

/** Fenêtre de rattrapage misfire par défaut (2 h) — bornée, injectable. */
export const DEFAULT_MISFIRE_GRACE_MS = 2 * 60 * 60 * 1000;

/** Charge utile portée par un job de rapport planifié. */
export interface ReportJobData {
  /** Type de rapport. */
  reportType: ReportType;
}

/** Résout la liste des tenants (banques) à traiter à chaque tir. */
export type ListTenantsFn = () => Promise<string[]>;

/** Dépendances du planificateur de rapports. */
export interface ReportSchedulerDeps
  extends Omit<BuildReportDeps, "log"> {
  /** Connexion BullMQ (host/port Redis). */
  connection: ConnectionOptions;
  /** Résout les tenants à traiter à chaque tir. */
  listTenants: ListTenantsFn;
  /** Fenêtre de rattrapage misfire (ms) — défaut `DEFAULT_MISFIRE_GRACE_MS`. */
  misfireGraceMs?: number;
  /** Horloge injectable (défaut `Date.now`) — testabilité fake-timers. */
  now?: () => Date;
  /** Journalisation d'orchestration (skip, misfire, alerte). */
  log?: BuildReportDeps["log"];
}

/** Handle du planificateur de rapports (file + worker). */
export interface ReportScheduler {
  /** File BullMQ portant les 3 jobs repeatable. */
  queue: Queue<ReportJobData>;
  /** Worker exécutant l'assemblage des rapports. */
  worker: Worker<ReportJobData>;
  /** Traite un tir (exposé pour tests unitaires sans passer par BullMQ). */
  runReport: (
    reportType: ReportType,
    firedAt: Date
  ) => Promise<BuildReportResult[]>;
  /** Arrêt propre (worker puis file). */
  close: () => Promise<void>;
}

/**
 * Traite un tir de rapport : pour CHAQUE tenant, assemble et enfile le rapport.
 * Un échec sur un tenant ne bloque pas les autres (isolation) mais est journalisé.
 *
 * @param reportType - Type de rapport
 * @param firedAt    - Instant de déclenchement (horloge injectée)
 * @param deps       - Dépendances (tenants, build, log)
 * @returns Résultats d'assemblage par tenant (traités avec succès)
 */
export async function runReportForAllTenants(
  reportType: ReportType,
  firedAt: Date,
  deps: ReportSchedulerDeps
): Promise<BuildReportResult[]> {
  const tenants = await deps.listTenants();
  const buildDeps: BuildReportDeps = {
    reportQuery: deps.reportQuery,
    recipientsQuery: deps.recipientsQuery,
    listAgencies: deps.listAgencies,
    enqueueReportEmail: deps.enqueueReportEmail,
    ...(deps.log ? { log: deps.log } : {}),
  };
  const results: BuildReportResult[] = [];
  for (const bankId of tenants) {
    try {
      results.push(
        await buildAndEnqueueReport(reportType, bankId, firedAt, buildDeps)
      );
    } catch (err) {
      // Un tenant en échec est journalisé (pas de perte silencieuse) sans faire
      // échouer le tir global : les autres tenants doivent être servis.
      deps.log?.({
        level: "warn",
        message: "Échec d'assemblage de rapport pour un tenant — ignoré.",
        context: {
          bankId,
          reportType,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
  return results;
}

/**
 * Démarre les 3 jobs repeatable (cron Abidjan) et le worker qui les exécute.
 * Chaque job est créé avec `repeat.tz = Africa/Abidjan` — l'heure planifiée est
 * TOUJOURS interprétée en fuseau Abidjan, jamais en heure locale serveur.
 *
 * @param deps - Connexion BullMQ, tenants, build, misfire, horloge, log
 * @returns Handle avec `runReport` et `close`
 */
export async function startReportScheduler(
  deps: ReportSchedulerDeps
): Promise<ReportScheduler> {
  const { connection } = deps;
  const now = deps.now ?? (() => new Date());
  const graceMs = deps.misfireGraceMs ?? DEFAULT_MISFIRE_GRACE_MS;
  const queue = new Queue<ReportJobData>(REPORT_QUEUE_NAME, { connection });

  // Enregistre les 3 jobs repeatable en cron Abidjan (LA LOI).
  for (const reportType of REPORT_TYPES) {
    await queue.add(
      REPORT_JOB_NAME[reportType],
      { reportType },
      {
        repeat: { pattern: REPORT_CRONS[reportType], tz: ABIDJAN_TZ },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
  }

  const runReport = (
    reportType: ReportType,
    firedAt: Date
  ): Promise<BuildReportResult[]> =>
    runReportForAllTenants(reportType, firedAt, deps);

  const worker = new Worker<ReportJobData>(
    REPORT_QUEUE_NAME,
    async (job: Job<ReportJobData>) => {
      const reportType = job.data.reportType;
      // Instant planifié du tir : BullMQ pose `timestamp`/`processedOn`. En cas de
      // retard (downtime couvrant l'heure planifiée), on décide d'un rattrapage
      // UNIQUE dans la fenêtre bornée ; au-delà, on skippe (journalisé).
      const scheduledAt = new Date(job.timestamp);
      const current = now();
      const decision = decideMisfire(scheduledAt, current, graceMs);
      if (decision.lateBy > graceMs) {
        // Tir manqué hors fenêtre de rattrapage : skip journalisé, aucun envoi.
        deps.log?.({
          level: "warn",
          message: "Tir de rapport manqué hors fenêtre de rattrapage — skip.",
          context: {
            reportType,
            scheduledAt: scheduledAt.toISOString(),
            lateBy: decision.lateBy,
            graceMs,
          },
        });
        return { skipped: true, reportType };
      }
      // Tir à l'heure OU rattrapage unique borné : l'idempotence (dedupeKey) garantit
      // qu'un rattrapage ne produit jamais de doublon.
      const results = await runReport(reportType, scheduledAt);
      return {
        skipped: false,
        reportType,
        recovered: decision.recover,
        tenants: results.length,
      };
    },
    { connection, concurrency: 1 }
  );

  return {
    queue,
    worker,
    runReport,
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
