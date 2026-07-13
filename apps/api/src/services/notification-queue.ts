/**
 * notification-queue — wiring BullMQ de l'infrastructure de notification (NOTIF-001).
 *
 * LA LOI (NOTIF-001) :
 *  - 4 files de CANAL distinctes (`notifications:sms|whatsapp|email|push`) +
 *    1 dead-letter queue (`notifications:dlq`), toutes prefixées par environnement.
 *  - Retry backoff exponentiel + full jitter borné via une `backoffStrategy`
 *    custom (délégué à `computeBackoffDelay`, D3), max tentatives configurable.
 *  - Idempotence : `jobId = dedupe_key` (BullMQ refuse un doublon de jobId) +
 *    garde applicative dans le worker (`processNotificationJob`).
 *  - Dead-letter : à l'épuisement des tentatives, le payload complet + la raison
 *    énumérée sont copiés dans la DLQ et le log passe `FAILED`.
 *  - Worker `noop` (aucun adaptateur fournisseur ici) : la fonction `send`
 *    injectée simule l'envoi et prouve retry/backoff/DLQ/dedupe/idempotence.
 *
 * La logique testable sans BullMQ (dedupe, backoff, garde tenant D5, health) vit
 * dans `notification-jobs.ts` ; ce module ne fait QUE le câblage BullMQ.
 *
 * @module
 */

import {
  Queue,
  Worker,
  UnrecoverableError,
  type ConnectionOptions,
  type Job,
} from "bullmq";
import type { QueryFn } from "@sigfa/database";
import { getNotificationConfig } from "src/config/notifications.js";
import {
  computeBackoffDelay,
  markNotificationFailed,
  processNotificationJob,
  NotificationSendError,
  type NotificationChannel,
  type NotificationFailureReason,
  type NotificationJobData,
  type SendFn,
  getQueueHealth,
  type QueueHealth,
} from "src/services/notification-jobs.js";

/** Nom de la stratégie de backoff custom (référencée par job). */
export const NOTIF_BACKOFF_STRATEGY = "notif-full-jitter" as const;

/** Canaux ordonnés (une file par canal). */
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  "SMS",
  "WHATSAPP",
  "EMAIL",
  "PUSH",
] as const;

/**
 * Nom de file BullMQ d'un canal : `notifications-sms` etc.
 *
 * BullMQ v5 interdit le `:` dans un nom de file (séparateur de clés Redis interne),
 * on utilise donc `-`. L'isolation logique `notifications:*` du contrat est portée
 * par le prefix Redis d'environnement + ce préfixe de nom.
 *
 * @param channel - Canal de notification
 * @returns Nom de file en minuscules préfixé `notifications-`
 */
export function channelQueueName(channel: NotificationChannel): string {
  return `notifications-${channel.toLowerCase()}`;
}

/** Nom de la dead-letter queue. */
export const DLQ_NAME = "notifications-dlq" as const;

/** Payload d'un job DLQ : le job original + la raison énumérée. */
export interface DlqJobData {
  /** Payload complet du job d'origine (conservé pour rejeu). */
  original: NotificationJobData;
  /** Raison d'échec énumérée (LA LOI). */
  failureReason: NotificationFailureReason;
  /** Nom de la file d'origine. */
  fromQueue: string;
}

/** Dépendances de l'infrastructure de notification. */
export interface NotificationInfraDeps {
  /** Connexion BullMQ (host/port Redis). */
  connection: ConnectionOptions;
  /** Fonction de requête SQL applicative (sigfa_app, hors RLS de session). */
  queryFn: QueryFn;
  /** Fonction d'envoi injectée (noop/mock en NOTIF-001). */
  send: SendFn;
}

/** Handle de l'infrastructure de notification (files + workers). */
export interface NotificationInfra {
  /** Files de canal indexées par canal. */
  queues: Map<NotificationChannel, Queue>;
  /** Dead-letter queue. */
  dlq: Queue;
  /** Workers de canal. */
  workers: Worker[];
  /**
   * Enfile un envoi : `jobId = dedupeKey` (idempotence BullMQ). Le producteur a
   * déjà créé la ligne `notification_log` en `QUEUED` avant cet appel.
   *
   * @param data - Données du job (bankId = source de vérité, dedupeKey = jobId)
   * @returns Le job créé (ou l'existant si dedupeKey déjà présent)
   */
  enqueue: (data: NotificationJobData) => Promise<Job<NotificationJobData>>;
  /** Santé agrégée des files (canaux + DLQ), prête pour /health. */
  health: () => Promise<QueueHealth>;
  /** Arrêt propre (workers puis files). */
  close: () => Promise<void>;
}

/**
 * Résout la raison d'échec énumérée à partir de l'erreur remontée par `send`.
 * Toute erreur non typée retombe sur `UNKNOWN` (jamais de chaîne libre en DLQ).
 *
 * @param err - Erreur capturée
 * @returns Raison énumérée (LA LOI)
 */
export function toFailureReason(err: unknown): NotificationFailureReason {
  if (err instanceof NotificationSendError) return err.reason;
  // Raison énumérée stashée sur un UnrecoverableError (faute définitive préservée
  // par le worker — ex. bounce dur email NOTIF-004).
  if (
    typeof err === "object" &&
    err !== null &&
    "failureReason" in err &&
    typeof (err as { failureReason: unknown }).failureReason === "string"
  ) {
    return (err as { failureReason: NotificationFailureReason }).failureReason;
  }
  return "UNKNOWN";
}

/**
 * Démarre l'infrastructure de notification : 4 files de canal + DLQ + workers
 * `noop`. Chaque file applique le backoff full-jitter borné et route en DLQ à
 * l'épuisement des tentatives.
 *
 * @param deps - Connexion BullMQ, requête SQL applicative, fonction d'envoi
 * @returns Handle avec `enqueue`, `health` et `close`
 */
export function startNotificationInfra(
  deps: NotificationInfraDeps
): NotificationInfra {
  const { connection, queryFn, send } = deps;
  const config = getNotificationConfig();
  const prefix = config.queuePrefix;

  const dlq = new Queue<DlqJobData>(DLQ_NAME, { connection, prefix });

  const queues = new Map<NotificationChannel, Queue>();
  const workers: Worker[] = [];

  for (const channel of NOTIFICATION_CHANNELS) {
    const name = channelQueueName(channel);
    const queue = new Queue<NotificationJobData>(name, { connection, prefix });
    queues.set(channel, queue);

    const worker = new Worker<NotificationJobData>(
      name,
      async (job) => {
        try {
          return await processNotificationJob(job.data, { queryFn, send });
        } catch (err) {
          // Garde tenant (D5) OU faute fournisseur définitive (bounce dur email
          // NOTIF-004) = non retriable : ne pas boucler, aller en DLQ. On préserve
          // la raison ÉNUMÉRÉE (`toFailureReason`) en la stashant sur l'erreur
          // UnrecoverableError, sinon la DLQ retomberait sur `UNKNOWN`.
          if (isNonRetryable(err)) {
            const fatal = new UnrecoverableError(
              err instanceof Error ? err.message : "non-retryable"
            );
            (fatal as { failureReason?: NotificationFailureReason }).failureReason =
              toFailureReason(err);
            throw fatal;
          }
          throw err;
        }
      },
      {
        connection,
        prefix,
        concurrency: config.channelConcurrency,
        settings: {
          // Stratégie de backoff custom : full jitter borné (D3).
          backoffStrategy: (attemptsMade: number): number =>
            computeBackoffDelay(attemptsMade, {
              baseMs: config.backoffBaseMs,
              capMs: config.backoffCapMs,
            }),
        },
      }
    );

    // Épuisement des tentatives (ou faute non retriable) → DLQ + log FAILED.
    worker.on("failed", (job, err) => {
      if (!job) return;
      const exhausted =
        err instanceof UnrecoverableError ||
        (job.attemptsMade ?? 0) >= (job.opts.attempts ?? config.maxAttempts);
      if (!exhausted) return;
      void routeToDlq(dlq, name, job.data, err, queryFn);
    });

    workers.push(worker);
  }

  return {
    queues,
    dlq,
    workers,
    enqueue: (data: NotificationJobData) => {
      const channel = data.channel;
      const queue = queues.get(channel);
      /* v8 ignore next 3 — garde défensive : canal toujours dans NOTIFICATION_CHANNELS. */
      if (!queue) {
        throw new Error(`Canal de notification inconnu : ${channel}`);
      }
      return queue.add(data.type, data, {
        // jobId = dedupeKey → BullMQ refuse tout doublon (idempotence d'enfilement).
        jobId: data.dedupeKey,
        attempts: config.maxAttempts,
        backoff: { type: NOTIF_BACKOFF_STRATEGY },
        removeOnComplete: true,
        removeOnFail: false,
      });
    },
    health: () => getQueueHealth([...queues.values()], dlq),
    close: async () => {
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all([...queues.values()].map((q) => q.close()));
      await dlq.close();
    },
  };
}

/** Vrai si l'erreur ne doit PAS être retentée (garde tenant, déjà unrecoverable). */
function isNonRetryable(err: unknown): boolean {
  if (err instanceof UnrecoverableError) return true;
  // Adaptateur fournisseur signalant une faute DÉFINITIVE (ex. bounce dur email
  // NOTIF-004) via `retryable === false` : router en DLQ sans retry infini, tout
  // en préservant la raison énumérée (l'erreur reste un NotificationSendError).
  if (
    typeof err === "object" &&
    err !== null &&
    "retryable" in err &&
    (err as { retryable: unknown }).retryable === false
  ) {
    return true;
  }
  // TenantMismatchError et consorts : la faute est structurelle, pas transitoire.
  return err instanceof Error && err.name === "TenantMismatchError";
}

/**
 * Déplace un job épuisé vers la DLQ (payload complet + raison énumérée) et passe
 * le log en `FAILED`. Best-effort : une panne DLQ ne doit pas masquer l'échec.
 *
 * @param dlq       - Dead-letter queue
 * @param fromQueue - Nom de la file d'origine
 * @param data      - Payload du job d'origine
 * @param err       - Erreur finale
 * @param queryFn   - Requête SQL applicative (pour marquer le log FAILED)
 */
async function routeToDlq(
  dlq: Queue<DlqJobData>,
  fromQueue: string,
  data: NotificationJobData,
  err: unknown,
  queryFn: QueryFn
): Promise<void> {
  const failureReason = toFailureReason(err);
  await dlq.add(
    "dead-letter",
    { original: data, failureReason, fromQueue },
    { jobId: `dlq-${data.dedupeKey}`, removeOnComplete: false, removeOnFail: false }
  );
  await markNotificationFailed(data, failureReason, queryFn);
}
