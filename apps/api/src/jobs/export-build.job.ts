/**
 * REP-003 — Build d'un export asynchrone (logique testable SANS BullMQ) + wiring
 * BullMQ (réutilise l'infra NOTIF-001 : file dédiée, retry/backoff, dead-letter).
 *
 * Cycle (`runExportBuild`) :
 *  1. Passe le job en `PROCESSING`.
 *  2. **Dérive** le modèle d'export EXCLUSIVEMENT via REP-001 (agrégats + `computeKpiSet`)
 *     — jamais de recalcul de formule ; réseau = agrégat anonymisé (zéro PII).
 *  3. **Rend** le fichier au format demandé (`renderExport`) puis l'écrit dans le
 *     stockage objet MOCK.
 *  4. **Signe** l'URL de téléchargement (TTL 24 h, horloge injectée) et passe le job
 *     en `READY` (`file_url` + `expires_at`). En cas d'échec → `FAILED` (jamais de
 *     fichier corrompu servi ; retry/dead-letter délégués à l'infra BullMQ).
 *
 * @module
 */

import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import type { QueryFn } from "src/reporting/aggregate-service.js";
import {
  loadAgencyAggregate,
  mapRowToAggregate,
  type DailyStatsRow,
} from "src/reporting/aggregate-service.js";
import {
  sumAggregates,
  isDayPartial,
  type DailyStatsAggregate,
} from "src/reporting/sla-engine.js";
import { parsePeriod } from "src/reporting/period.js";
import {
  renderExport,
  type ExportModel,
} from "src/reporting/export-content.js";
import type { ObjectStorage, ExportFormat } from "src/reporting/export-storage.js";
import {
  decodeScope,
  markProcessing,
  markReady,
  markFailed,
  type ExportJobRow,
} from "src/reporting/export-job-service.js";

/** Nom de la file BullMQ des builds d'export. */
export const EXPORT_QUEUE_NAME = "sigfa-exports";

/** Nom du job de build d'export. */
export const EXPORT_JOB_NAME = "export-build";

/** Charge utile d'un job de build d'export. */
export interface ExportJobData {
  /** Identifiant du job `export_jobs`. */
  jobId: string;
  /** Tenant propriétaire. */
  bankId: string;
}

/** Dépendances du build d'un export (injection, testabilité sans BullMQ). */
export interface ExportBuildDeps {
  /** Requête reporting paramétrée (lectures d'agrégats REP-001). */
  query: QueryFn;
  /** Stockage objet (MOCK en périmètre F7) + signature d'URL. */
  storage: ObjectStorage;
  /** Horloge injectée (détermine `partial`, `expires_at`). */
  now: () => Date;
}

/** Charge l'agrégat RÉSEAU (toutes agences) + le nombre d'agences (anonymisé). */
async function loadNetworkAggregate(
  query: QueryFn,
  bankId: string,
  dayStart: string,
  dayEnd: string
): Promise<{ aggregate: DailyStatsAggregate; agencyCount: number }> {
  const res = await query(
    `SELECT tickets_issued, tickets_served, tickets_abandoned, tickets_no_show,
            total_wait_seconds, total_service_seconds, sla_met_count, sla_total_count,
            feedback_count, nps_promoters, nps_passives, nps_detractors,
            agent_active_seconds, agent_available_seconds, agency_id
       FROM daily_agency_stats
      WHERE bank_id = $1 AND service_id IS NULL
        AND day >= $2::date AND day <= $3::date`,
    [bankId, dayStart, dayEnd]
  );
  const rows = res.rows as Array<Record<string, unknown>>;
  const aggregate = sumAggregates(
    rows.map((r) => mapRowToAggregate(r as unknown as DailyStatsRow))
  );
  const agencyCount = new Set(rows.map((r) => String(r["agency_id"]))).size;
  return { aggregate, agencyCount };
}

/**
 * Construit le `ExportModel` d'un job À PARTIR DE REP-001 (agrégats matérialisés).
 * Réseau = agrégat anonymisé (aucun `agencyId`, aucune PII).
 *
 * @param deps - Requête + horloge
 * @param job  - Ligne `export_jobs` (portée/période encodées)
 * @returns Modèle d'export prêt à sérialiser
 */
export async function buildExportModel(
  deps: ExportBuildDeps,
  job: ExportJobRow
): Promise<ExportModel> {
  const bounds = parsePeriod(job.period);
  if (!bounds) {
    throw new Error(`Période d'export invalide : ${job.period}`);
  }
  const { scope, agencyId } = decodeScope(job.scope);
  const partial = isDayPartial(bounds.dayEnd, deps.now());
  if (scope === "network") {
    const { aggregate, agencyCount } = await loadNetworkAggregate(
      deps.query,
      job.bankId,
      bounds.dayStart,
      bounds.dayEnd
    );
    return {
      scope: "network",
      periodKey: bounds.periodKey,
      aggregate,
      agencyCount,
      partial,
    };
  }
  const aggregate = await loadAgencyAggregate(
    deps.query,
    job.bankId,
    agencyId as string,
    bounds.dayStart,
    bounds.dayEnd
  );
  return {
    scope: "agency",
    periodKey: bounds.periodKey,
    agencyId: agencyId as string,
    aggregate,
    partial,
  };
}

/** Clé objet de stockage d'un export (déterministe par tenant/job/format). */
export function exportObjectKey(
  bankId: string,
  jobId: string,
  format: ExportFormat
): string {
  return `exports/${bankId}/${jobId}.${format}`;
}

/**
 * Exécute le build complet d'un job d'export : PROCESSING → rendu → stockage →
 * URL signée → READY. Toute exception passe le job en FAILED (jamais de fichier
 * corrompu servi) puis est relancée pour laisser l'infra BullMQ gérer retry/DLQ.
 *
 * @param deps - Requête, stockage, horloge
 * @param job  - Ligne `export_jobs` à construire
 * @returns URL signée + expiration écrites sur le job (pour observabilité/tests)
 */
export async function runExportBuild(
  deps: ExportBuildDeps,
  job: ExportJobRow
): Promise<{ fileUrl: string; expiresAt: Date }> {
  const now = deps.now();
  await markProcessing(deps.query, job.id, job.bankId, now);
  try {
    const model = await buildExportModel(deps, job);
    const format = job.format as ExportFormat;
    const object = renderExport(format, model);
    const key = exportObjectKey(job.bankId, job.id, format);
    await deps.storage.put(key, object);
    const signedAt = deps.now();
    const { url, expiresAt } = deps.storage.signUrl(key, signedAt);
    await markReady(deps.query, job.id, job.bankId, url, expiresAt, signedAt);
    return { fileUrl: url, expiresAt };
  } catch (err) {
    await markFailed(deps.query, job.id, job.bankId, deps.now());
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/** Handle de l'infrastructure de build d'export (file + worker). */
export interface ExportBuildInfra {
  /** File BullMQ des builds d'export. */
  queue: Queue<ExportJobData>;
  /** Worker exécutant les builds. */
  worker: Worker<ExportJobData>;
  /**
   * Enfile un build : `jobId` BullMQ = jobId `export_jobs` (idempotence — un même
   * job n'est jamais construit deux fois en parallèle).
   */
  enqueue: (data: ExportJobData) => Promise<Job<ExportJobData>>;
  /** Arrêt propre (worker puis file). */
  close: () => Promise<void>;
}

/** Dépendances de l'infra BullMQ de build d'export. */
export interface ExportBuildInfraDeps extends ExportBuildDeps {
  /** Connexion BullMQ (host/port Redis). */
  connection: ConnectionOptions;
  /** Charge la ligne `export_jobs` d'un jobId/tenant (au traitement du worker). */
  loadJob: (jobId: string, bankId: string) => Promise<ExportJobRow | null>;
  /** Nombre max de tentatives (retry/DLQ NOTIF-001) — défaut 3. */
  maxAttempts?: number;
}

/**
 * Démarre l'infra BullMQ de build d'export (réutilise le modèle NOTIF-001 : retry
 * borné + removeOnFail pour dead-letter). Le worker charge la ligne `export_jobs`
 * puis exécute `runExportBuild`.
 *
 * @param deps - Connexion, requête, stockage, horloge, chargeur de job
 * @returns Handle avec `enqueue` et `close`
 */
export function startExportBuildInfra(deps: ExportBuildInfraDeps): ExportBuildInfra {
  const { connection } = deps;
  const maxAttempts = deps.maxAttempts ?? 3;
  const queue = new Queue<ExportJobData>(EXPORT_QUEUE_NAME, { connection });

  const worker = new Worker<ExportJobData>(
    EXPORT_QUEUE_NAME,
    async (job: Job<ExportJobData>) => {
      const row = await deps.loadJob(job.data.jobId, job.data.bankId);
      /* v8 ignore next 3 — garde défensive : la ligne est créée avant l'enfilement. */
      if (!row) {
        throw new Error(`Job d'export introuvable : ${job.data.jobId}`);
      }
      return runExportBuild(deps, row);
    },
    { connection, concurrency: 2 }
  );

  return {
    queue,
    worker,
    enqueue: (data: ExportJobData) =>
      queue.add(EXPORT_JOB_NAME, data, {
        jobId: data.jobId,
        attempts: maxAttempts,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false,
      }),
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
