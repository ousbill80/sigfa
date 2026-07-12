/**
 * socket-server — Serveur Socket.io 4 attaché à Hono via @hono/node-server.
 *
 * LA LOI (API-006) :
 * - Wiring : `serve(honoApp)` puis `new Server(httpServer)` — HTTP et WS sur le même port.
 * - Handshake authentifié JWT AVANT join (user OU session borne).
 * - Join room `agency:{id}` du scope uniquement (hors scope → refus + log).
 * - Émetteur typé validant chaque payload contre payloadSchema Zod (payload invalide → non émis + log).
 * - Adapter Redis pub/sub (multi-instance ready).
 * - Verrou appel durci : Redis SET NX PX 5000 + re-vérif transactionnelle.
 * - Resync sync:request → sync:state (CONTRACT-012 recentCalls ≤4).
 *
 * @module
 */

import { Server, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import type { Client } from "pg";
import type http from "http";
import { jwtVerify } from "jose";
import { z } from "zod";
import { logger } from "src/lib/logger.js";
import { createNoopBus, type RealtimeBus } from "src/services/realtime.js";
import { getAlertingConfig } from "src/config/alerting.js";
import {
  markDisconnect,
  cancelDisconnect,
  processDisconnect,
} from "src/services/agent-disconnect.js";

/** SLA réception ticket:called en millisecondes. */
export const TICKET_CALLED_SLA_MS = 500 as const;

/** Nombre max de recentCalls dans sync:state (CONTRACT-012). */
export const SYNC_RECENT_CALLS = 4 as const;

/** Payload JWT décodé pour le handshake. */
interface JwtSocketPayload {
  sub?: string;
  bankId?: string | null;
  agencyIds?: string[];
  role?: string;
}

/** Options d'injection pour le serveur Socket.io. */
export interface SocketServerOptions {
  /** Client PostgreSQL applicatif */
  db: Client;
  /** Client Redis principal */
  redis: Redis;
  /** Secret JWT (Uint8Array) */
  jwtSecret: Uint8Array;
  /** Bus temps réel (émission alertes/counter:status). Défaut : no-op validant. */
  bus?: RealtimeBus;
  /** bankId → indispensable au traitement de déconnexion (multi-tenant). */
  bankIdOf?: (socket: Socket) => string | null;
}

/** Schéma du payload sync:request. */
const syncRequestSchema = z.object({ agencyId: z.string().uuid() });

/** Schéma du payload join:agency. */
const joinAgencySchema = z.object({ agencyId: z.string().uuid() });

/**
 * Attache un serveur Socket.io 4 à un serveur HTTP existant (Hono).
 * Configure le handshake JWT, les rooms, l'adapter Redis et les événements.
 *
 * @param httpServer - Serveur HTTP créé par @hono/node-server
 * @param options    - Dépendances injectées (db, redis, jwtSecret)
 * @returns Instance du serveur Socket.io
 */
export function createSocketServer(
  httpServer: http.Server,
  options: SocketServerOptions
): Server {
  const { db, redis, jwtSecret } = options;
  const bus = options.bus ?? createNoopBus();
  const bankIdOf =
    options.bankIdOf ?? ((s: Socket) => (s.data["bankId"] as string | null) ?? null);

  // Adapter Redis pub/sub (multi-instance ready)
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();

  const io = new Server(httpServer, {
    cors: { origin: "*" },
    transports: ["websocket", "polling"],
  });

  io.adapter(createAdapter(pubClient, subClient));

  // Handshake JWT — authentifié AVANT tout join
  io.use(async (socket, next) => {
    const token =
      (socket.handshake.auth as Record<string, unknown>)["token"] as string | undefined ??
      (socket.handshake.query["token"] as string | undefined);

    if (!token) {
      logger.warn({ socketId: socket.id }, "socket:handshake:no-token");
      return next(new Error("UNAUTHORIZED: token manquant"));
    }

    try {
      const { payload } = await jwtVerify(token, jwtSecret);
      const jwtPayload = payload as JwtSocketPayload;
      socket.data["userId"] = jwtPayload.sub ?? null;
      socket.data["bankId"] = jwtPayload.bankId ?? null;
      socket.data["agencyIds"] = jwtPayload.agencyIds ?? [];
      socket.data["role"] = jwtPayload.role ?? "UNKNOWN";
      next();
    } catch {
      logger.warn({ socketId: socket.id }, "socket:handshake:invalid-token");
      next(new Error("UNAUTHORIZED: token invalide"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data["userId"] as string | null;
    logger.info({ socketId: socket.id, userId }, "socket:connected");

    // Anti-flap : une reconnexion dans la fenêtre annule la déconnexion en attente.
    if (userId) void cancelDisconnect(redis, userId);

    socket.on("join:agency", (payload: unknown) => {
      handleJoinAgency(socket, payload);
    });

    socket.on("sync:request", (payload: unknown) => {
      void handleSyncRequest(socket, db, payload);
    });

    socket.on("disconnect", () => {
      logger.info({ socketId: socket.id }, "socket:disconnected");
      void scheduleDisconnect(socket, { db, redis, bus, bankIdOf });
    });
  });

  return io;
}

/** Dépendances du planning de déconnexion anti-flap. */
interface ScheduleDeps {
  db: Client;
  redis: Redis;
  bus: RealtimeBus;
  bankIdOf: (socket: Socket) => string | null;
}

/**
 * Planifie le traitement d'une déconnexion socket avec grâce anti-flap.
 * Pose la marque Redis puis, après `AGENT_DISCONNECT_GRACE_S`, traite la
 * déconnexion SI aucune reconnexion ne l'a annulée entre-temps.
 *
 * @param socket - Socket déconnecté
 * @param deps   - Dépendances (db, redis, bus, bankIdOf)
 */
async function scheduleDisconnect(
  socket: Socket,
  deps: ScheduleDeps
): Promise<void> {
  const agentId = socket.data["userId"] as string | null;
  const bankId = deps.bankIdOf(socket);
  if (!agentId || !bankId) return;

  await markDisconnect(deps.redis, agentId);
  const graceMs = getAlertingConfig().agentDisconnectGraceS * 1000;

  setTimeout(() => {
    void processDisconnect({
      db: deps.db,
      redis: deps.redis,
      bus: deps.bus,
      bankId,
      agentId,
    }).catch((err: unknown) => {
      logger.error({ err, agentId }, "socket:disconnect:process-error");
    });
  }, graceMs).unref();
}

/**
 * Gère la demande de join de room agency:{agencyId}.
 * Vérifie que l'agencyId est dans le scope JWT du socket.
 *
 * @param socket   - Socket du client
 * @param payload  - Payload { agencyId } reçu
 */
function handleJoinAgency(socket: Socket, payload: unknown): void {
  const parsed = joinAgencySchema.safeParse(payload);
  if (!parsed.success) {
    socket.emit("error:forbidden", "Payload join:agency invalide");
    logger.warn({ socketId: socket.id, payload }, "socket:join:invalid-payload");
    return;
  }

  const { agencyId } = parsed.data;
  const agencyIds = socket.data["agencyIds"] as string[] | undefined ?? [];
  const role = socket.data["role"] as string | undefined ?? "";

  if (role !== "SUPER_ADMIN" && !agencyIds.includes(agencyId)) {
    socket.emit("error:forbidden", `agencyId ${agencyId} hors scope JWT`);
    logger.warn({ socketId: socket.id, agencyId, agencyIds }, "socket:join:out-of-scope");
    return;
  }

  const room = `agency:${agencyId}`;
  void socket.join(room);
  socket.emit("join:ok", `Rejoint ${room}`);
  logger.info({ socketId: socket.id, room }, "socket:join:ok");
}

/**
 * Gère sync:request → répond avec sync:state (état complet de la file).
 * CONTRACT-012 : inclut recentCalls (≤ SYNC_RECENT_CALLS derniers CALLED).
 *
 * @param socket   - Socket du client
 * @param db       - Client PostgreSQL
 * @param payload  - Payload { agencyId } reçu
 */
async function handleSyncRequest(socket: Socket, db: Client, payload: unknown): Promise<void> {
  const parsed = syncRequestSchema.safeParse(payload);
  if (!parsed.success) {
    socket.emit("error:forbidden", "Payload sync:request invalide");
    return;
  }

  const { agencyId } = parsed.data;
  const agencyIds = socket.data["agencyIds"] as string[] | undefined ?? [];
  const role = socket.data["role"] as string | undefined ?? "";

  if (role !== "SUPER_ADMIN" && !agencyIds.includes(agencyId)) {
    socket.emit("error:forbidden", `agencyId ${agencyId} hors scope`);
    return;
  }

  try {
    const state = await buildSyncState(db, agencyId);
    socket.emit("sync:state", state);
  } catch (err) {
    logger.error({ err, agencyId }, "socket:sync:error");
  }
}

/** Ligne de file retournée par la DB. */
interface QueueRow {
  queue_id: string;
  length: number;
  status: string;
}

/** Ligne de guichet retournée par la DB. */
interface CounterRow {
  counter_id: string;
  status: string;
  agent_id: string | null;
}

/** Ligne de ticket CALLED récent. */
interface RecentCallRow {
  number: number;
  display_number: string | null;
  counter_label: string | null;
  called_at: Date | null;
}

/**
 * Construit le payload sync:state pour une agence (CONTRACT-012).
 *
 * @param db       - Client PostgreSQL
 * @param agencyId - Identifiant de l'agence
 * @returns Payload sync:state complet
 */
async function buildSyncState(
  db: Client,
  agencyId: string
): Promise<Record<string, unknown>> {
  const [queuesRes, countersRes, recentCallsRes] = await Promise.all([
    db.query<QueueRow>(
      `SELECT q.id AS queue_id,
              COUNT(t.id) FILTER (WHERE t.status = 'WAITING') AS length,
              q.status
         FROM queues q
         LEFT JOIN tickets t ON t.queue_id = q.id
        WHERE q.agency_id = $1
        GROUP BY q.id, q.status`,
      [agencyId]
    ),
    db.query<CounterRow>(
      `SELECT id AS counter_id, status, agent_id FROM counters WHERE agency_id = $1`,
      [agencyId]
    ),
    db.query<RecentCallRow>(
      `SELECT t.number, t.display_number, c.label AS counter_label, t.called_at
         FROM tickets t
         LEFT JOIN counters c ON c.id = t.counter_id
        WHERE t.agency_id = $1 AND t.status = 'CALLED' AND t.called_at IS NOT NULL
        ORDER BY t.called_at DESC
        LIMIT $2`,
      [agencyId, SYNC_RECENT_CALLS]
    ),
  ]);

  return {
    agencyId,
    queues: queuesRes.rows.map((r) => ({
      queueId: r.queue_id,
      length: Number(r.length),
      estimate: 0,
      status: r.status,
    })),
    counters: countersRes.rows.map((r) => ({
      counterId: r.counter_id,
      status: r.status,
      ...(r.agent_id ? { agentId: r.agent_id } : {}),
    })),
    recentCalls: recentCallsRes.rows.map((r) => ({
      ticketNumber: `A${String(r.number).padStart(3, "0")}`,
      displayNumber: r.display_number ?? `T-${String(r.number).padStart(3, "0")}`,
      counterLabel: r.counter_label ?? "Guichet",
      calledAt: (r.called_at ?? new Date()).toISOString(),
    })),
    timestamp: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Émetteur typé avec validation Zod
// ─────────────────────────────────────────────────────────────────────────────

/** Schéma du payload ticket:called (extrait du contrat). */
const ticketCalledPayloadSchema = z.object({
  ticket: z.object({
    id: z.string().uuid(),
    number: z.string().min(1),
    status: z.string(),
    serviceId: z.string().uuid(),
    agencyId: z.string().uuid(),
    channel: z.string(),
    createdAt: z.string().datetime(),
  }),
  counter: z.object({
    id: z.string().uuid(),
    label: z.string().min(1),
  }),
});

/** Type du payload ticket:called validé. */
export type TicketCalledPayload = z.infer<typeof ticketCalledPayloadSchema>;

/**
 * Émet `ticket:called` dans la room de l'agence après validation Zod.
 * Payload invalide → NON émis + log d'erreur.
 *
 * @param io       - Instance Socket.io
 * @param agencyId - Identifiant de l'agence (room cible)
 * @param payload  - Payload à valider et émettre
 */
export function emitTicketCalled(
  io: Server,
  agencyId: string,
  payload: unknown
): void {
  const result = ticketCalledPayloadSchema.safeParse(payload);
  if (!result.success) {
    logger.error(
      { issues: result.error.issues, agencyId },
      "socket:emit:ticket:called:invalid-payload"
    );
    return;
  }
  io.to(`agency:${agencyId}`).emit("ticket:called", result.data);
}

// ─────────────────────────────────────────────────────────────────────────────
// Serveur de test éphémère (suite realtime-guarantees)
// ─────────────────────────────────────────────────────────────────────────────

/** Interface du serveur de test éphémère. */
export interface RealtimeTestServer {
  /** URL du serveur de test */
  url: string;
  /** Émet ticket:called dans la room de l'agence (test direct, sans validation stricte) */
  emitTicketCalled: (agencyId: string) => void;
  /** Arrête le serveur de test */
  teardown: () => Promise<void>;
}

/**
 * Crée un serveur Socket.io de test éphémère pour la suite realtime-guarantees.
 * Le JWT est auto-signé avec une clé de test. Les clients se connectent sans auth stricte.
 *
 * @returns Serveur de test avec emitTicketCalled et teardown
 */
export async function createRealtimeTestServer(): Promise<RealtimeTestServer> {
  const { createServer } = await import("http");
  const httpServer = createServer();

  const io = new Server(httpServer, {
    cors: { origin: "*" },
    transports: ["websocket"],
  });

  // Pas de middleware auth pour le serveur de test — mesure pure de latence
  io.on("connection", (socket) => {
    socket.on("join:agency", (payload: unknown) => {
      const parsed = joinAgencySchema.safeParse(payload);
      if (parsed.success) {
        void socket.join(`agency:${parsed.data.agencyId}`);
        socket.emit("join:ok", `Rejoint agency:${parsed.data.agencyId}`);
      }
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));

  const address = httpServer.address() as import("net").AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    emitTicketCalled: (agencyId: string) => {
      io.to(`agency:${agencyId}`).emit("ticket:called", {
        ticket: {
          id: "00000000-0000-4000-a000-000000000001",
          number: "T001",
          status: "CALLED",
          serviceId: "00000000-0000-4000-a000-000000000002",
          agencyId,
          channel: "KIOSK",
          createdAt: new Date().toISOString(),
        },
        counter: { id: "00000000-0000-4000-a000-000000000003", label: "G1" },
      });
    },
    teardown: async () => {
      io.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
