/**
 * realtime-bootstrap — câblage temps réel TESTABLE (extrait de `index.ts`).
 *
 * `index.ts::startServer` vit dans un bloc exclu de la couverture v8 (câblage
 * prod non couvrable). La logique décidable — mode de bascule, ordre `real`,
 * graceful shutdown, bus différé — est isolée ici et testée avec des doubles.
 *
 * Bascule (D2) : `REALTIME_MODE ∈ {off, real}`, défaut `off` (y compris tests).
 * Ordre `real` (D6) : PG/Redis connectés (fail-fast, dans index.ts) → `serve()`
 * capture le httpServer → `createSocketServer(httpServer)` → `createSocketBus(io)`
 * → `startAlertScheduler(...)`. Shutdown (SIGTERM/SIGINT) : `io.close()` →
 * workers BullMQ drainés → PG/Redis fermés. Zéro orphelin.
 *
 * @module
 */

import type { Server as SocketServer } from "socket.io";
import type { ConnectionOptions } from "bullmq";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import type http from "http";
import type { SocketServerOptions } from "src/services/socket-server.js";
import type { AlertScheduler, AlertSchedulerDeps } from "src/services/alert-scheduler.js";
import {
  createNoopBus,
  type EventName,
  type EventPayload,
  type RealtimeBus,
} from "src/services/realtime.js";

/** Mode de bascule temps réel côté serveur (LA LOI D2). */
export type RealtimeMode = "off" | "real";

/**
 * Résout le mode temps réel depuis la variable d'environnement.
 * Toute valeur autre que `real` (insensible à la casse) → `off` (sûr par défaut).
 *
 * @param value - Valeur brute de `REALTIME_MODE`
 * @returns Mode résolu
 */
export function resolveRealtimeMode(value: string | undefined): RealtimeMode {
  return value?.toLowerCase() === "real" ? "real" : "off";
}

/**
 * Bus différé : noop validant tant qu'aucun bus réel n'est branché, puis délègue.
 * Permet à `createApp({ bus })` de recevoir un bus AVANT que `io` n'existe
 * (chicken-and-egg serve()↔io), puis de brancher le socket bus après build.
 */
export interface DeferredBus extends RealtimeBus {
  /** Branche le bus délégué (socket bus) — remplace le noop. */
  bind(delegate: RealtimeBus): void;
}

/**
 * Crée un bus différé. Avant `bind`, valide via `createNoopBus` (ne transporte
 * pas). Après `bind`, délègue chaque `emit` au bus branché.
 *
 * @returns Bus différé bindable
 */
export function createDeferredBus(): DeferredBus {
  let delegate: RealtimeBus = createNoopBus();
  return {
    emit<E extends EventName>(event: E, agencyId: string, payload: EventPayload<E>): void {
      delegate.emit(event, agencyId, payload);
    },
    bind(next: RealtimeBus): void {
      delegate = next;
    },
  };
}

/** Dépendances injectées du bootstrap temps réel `real` (doubles en test). */
export interface RealtimeDeps {
  /** Serveur HTTP capturé depuis `serve()` (cast `as unknown as http.Server`). */
  httpServer: http.Server;
  /** Client PostgreSQL applicatif (fermé au shutdown). */
  db: Client;
  /** Client Redis applicatif (fermé au shutdown). */
  redis: Redis;
  /** Connexion BullMQ (host/port Redis) pour le scheduler d'alertes. */
  connection: ConnectionOptions;
  /** Secret JWT (Uint8Array). */
  jwtSecret: Uint8Array;
  /** Fabrique du serveur Socket.io (injectable pour test). */
  createSocketServer: (httpServer: http.Server, options: SocketServerOptions) => SocketServer;
  /** Fabrique du bus adaptateur socket (injectable pour test). */
  createSocketBus: (io: SocketServer) => RealtimeBus;
  /** Démarreur du scheduler d'alertes BullMQ (injectable pour test). */
  startAlertScheduler: (deps: AlertSchedulerDeps) => Promise<AlertScheduler>;
}

/** Handle du temps réel démarré (mode `real`). */
export interface RealtimeHandle {
  /** Serveur Socket.io. */
  io: SocketServer;
  /** Bus adaptateur socket branché. */
  bus: RealtimeBus;
  /** Scheduler d'alertes BullMQ. */
  scheduler: AlertScheduler;
}

/** Timeout (ms) du drain borné des workers au shutdown (documenté). */
export const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000 as const;

/**
 * Construit le temps réel en mode `real` dans l'ORDRE D6 :
 *   createSocketServer(httpServer) → createSocketBus(io) → startAlertScheduler.
 * Branche le socket bus sur le bus différé (celui donné à `createApp`).
 *
 * @param deps - Dépendances injectées
 * @param bus  - Bus différé à brancher sur le socket bus
 * @returns Handle du temps réel démarré
 */
export async function buildRealtime(
  deps: RealtimeDeps,
  bus: DeferredBus
): Promise<RealtimeHandle> {
  const io = deps.createSocketServer(deps.httpServer, {
    db: deps.db,
    redis: deps.redis,
    jwtSecret: deps.jwtSecret,
    // Le bus du socket-server (déconnexions) est le socket bus branché ci-dessous.
    bus,
  });
  const socketBus = deps.createSocketBus(io);
  bus.bind(socketBus);

  const scheduler = await deps.startAlertScheduler({
    connection: deps.connection,
    redis: deps.redis,
    db: deps.db,
    bus,
  });

  return { io, bus: socketBus, scheduler };
}

/**
 * Arrêt propre (SIGTERM/SIGINT) : `io.close()` → workers BullMQ drainés (borné)
 * → PG/Redis fermés. Chaque étape est isolée (une erreur n'empêche pas les
 * suivantes) — objectif : zéro worker/socket/connexion orphelin.
 *
 * @param handle - Handle du temps réel démarré
 * @param deps   - Dépendances (db/redis à fermer)
 */
export async function shutdownRealtime(
  handle: RealtimeHandle,
  deps: RealtimeDeps
): Promise<void> {
  // 1. Fermer le serveur socket (plus de nouvelles connexions/émissions).
  await closeQuietly(() => handle.io.close());
  // 2. Drainer + fermer les workers BullMQ (borné par SHUTDOWN_DRAIN_TIMEOUT_MS).
  await closeQuietly(() =>
    withTimeout(handle.scheduler.close(), SHUTDOWN_DRAIN_TIMEOUT_MS)
  );
  // 3. Fermer PG puis Redis.
  await closeQuietly(() => deps.db.end());
  await closeQuietly(() => deps.redis.quit());
}

/** Exécute une fermeture en avalant toute erreur (best-effort, log-free ici). */
async function closeQuietly(fn: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // Une étape de shutdown fautive ne doit pas empêcher les suivantes.
  }
}

/** Borne une promesse par un timeout (drain BullMQ borné au shutdown). */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
    timer.unref();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
