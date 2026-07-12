/**
 * alert-scheduler — orchestration BullMQ des scans d'alertes manager (API-007).
 *
 * LA LOI (API-007 critères 6, 7, 8) :
 *  - Deux jobs BullMQ REPEATABLE : `inactive-agent-scan` et `sla-scan`, dont les
 *    intervalles proviennent de `config/alerting.ts` (injectables via env).
 *  - Workers en `concurrency: 1` + verrou distribué Redis (`runLockedScan`) :
 *    même déployé en N instances, chaque passe n'émet qu'UNE alerte par sujet.
 *
 * Le module wire BullMQ ; la logique de scan (testable sans BullMQ) vit dans
 * `alert-jobs.ts`.
 *
 * @module
 */

import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import type { RealtimeBus } from "src/services/realtime.js";
import { getAlertingConfig } from "src/config/alerting.js";
import {
  scanInactiveAgents,
  scanSlaBreaches,
  runLockedScan,
  INACTIVE_SCAN_LOCK,
  SLA_SCAN_LOCK,
} from "src/services/alert-jobs.js";

/** Nom de la file BullMQ des alertes manager. */
export const ALERT_QUEUE_NAME = "sigfa-alerts";

/** Nom du job repeatable de scan d'agents inactifs. */
export const INACTIVE_SCAN_JOB = "inactive-agent-scan";

/** Nom du job repeatable de scan SLA. */
export const SLA_SCAN_JOB = "sla-scan";

/** Dépendances injectées du planificateur d'alertes. */
export interface AlertSchedulerDeps {
  /** Connexion BullMQ (host/port Redis). */
  connection: ConnectionOptions;
  /** Client Redis applicatif (verrous + flags). */
  redis: Redis;
  /** Client PostgreSQL applicatif. */
  db: Client;
  /** Bus temps réel (émission des alertes). */
  bus: RealtimeBus;
}

/** Handle du planificateur d'alertes (jobs + worker). */
export interface AlertScheduler {
  /** File BullMQ portant les jobs repeatable. */
  queue: Queue;
  /** Worker exécutant les scans (concurrency=1). */
  worker: Worker;
  /** Arrête proprement worker + file. */
  close: () => Promise<void>;
}

/**
 * Démarre les jobs repeatable `inactive-agent-scan` et `sla-scan` et le worker
 * qui les exécute sous verrou distribué (concurrency=1).
 *
 * @param deps - Connexion BullMQ, Redis, PG et bus
 * @returns Handle avec `close()` pour l'arrêt propre
 */
export async function startAlertScheduler(
  deps: AlertSchedulerDeps
): Promise<AlertScheduler> {
  const { connection, redis, db, bus } = deps;
  const config = getAlertingConfig();
  const queue = new Queue(ALERT_QUEUE_NAME, { connection });

  await queue.add(
    INACTIVE_SCAN_JOB,
    {},
    {
      repeat: { every: config.agentInactiveScanIntervalS * 1000 },
      removeOnComplete: true,
      removeOnFail: true,
    }
  );
  await queue.add(
    SLA_SCAN_JOB,
    {},
    {
      repeat: { every: config.slaScanIntervalS * 1000 },
      removeOnComplete: true,
      removeOnFail: true,
    }
  );

  const worker = new Worker(
    ALERT_QUEUE_NAME,
    async (job) => {
      if (job.name === INACTIVE_SCAN_JOB) {
        return runLockedScan(redis, INACTIVE_SCAN_LOCK, () =>
          scanInactiveAgents(db, redis, bus)
        );
      }
      if (job.name === SLA_SCAN_JOB) {
        return runLockedScan(redis, SLA_SCAN_LOCK, () =>
          scanSlaBreaches(db, redis, bus)
        );
      }
      return 0;
    },
    { connection, concurrency: 1 }
  );

  return {
    queue,
    worker,
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
