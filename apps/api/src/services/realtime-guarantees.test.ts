/**
 * RT-002 — Suite `realtime-guarantees` (bout-en-bout, sockets RÉELS).
 *
 * Testcontainers RÉELS PG16 + Redis7, transport websocket, loopback (127.0.0.1),
 * adapter Redis pub/sub ACTIF sur chaque instance (`createSocketServer` duplique
 * `redis` en pub/sub). Nommage strict : `RT-002: <description>`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROTOCOLE DE MESURE p95 NORMÉ (D8, RAPPEL LEÇON F3)
 * ─────────────────────────────────────────────────────────────────────────────
 *  - t0 = instant JUSTE AVANT `io.to(room).emit("ticket:called", payload)` côté
 *    SERVEUR (l'émission part par le VRAI `io`, adapter Redis actif) ;
 *  - t1 = instant d'entrée du HANDLER client `ticket:called` (socket.io-client
 *    réel) ;
 *  - latence échantillon = t1 - t0 (même hôte, horloge unique → pas de dérive) ;
 *  - ≥50 échantillons, WARM-UP exclu (5 premiers jetés) ;
 *  - transport = websocket, adapter Redis ACTIF (chemin réel, ≠ p95 API-006 qui
 *    tournait sans adapter).
 *
 *  SLA loopback DOCUMENTÉ : `TICKET_CALLED_SLA_MS` (500 ms). L'assertion est
 *  TOLÉRANTE (le p95 réel est LOGGÉ ; on n'assène JAMAIS d'horloge-murale dure
 *  par appel — c'est exactement le flake retiré en F3). Marge : le p95 loopback
 *  est typiquement < 30 ms ; on assert avec le SLA comme plafond souple et on
 *  laisse la trace du p95 mesuré pour diagnostic CI. En cas de flake CI, mettre
 *  ce `describe` en quarantaine/retry (documenté), pas d'assertion fragile.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Socket as ClientSocket } from "socket.io-client";
import { Redis } from "ioredis";
import { Client } from "pg";
import { logger } from "src/lib/logger.js";
import { TICKET_CALLED_SLA_MS } from "src/services/socket-server.js";
import { createSocketBus } from "src/services/socket-bus.js";
import {
  startRtHarness,
  stopRtHarness,
  bootRtInstance,
  forgeAgentToken,
  connectAndJoin,
  insertWaitingTicket,
  type RtHarness,
  type RtInstance,
} from "src/services/rt002-test-harness.js";

let h: RtHarness;
let primary: RtInstance;
let agentToken: string;

beforeAll(async () => {
  h = await startRtHarness();
  primary = await bootRtInstance({
    db: h.db,
    redis: h.redis,
    jwtSecret: h.jwtSecretBytes,
  });
  agentToken = await forgeAgentToken(h.jwtSecretBytes, h.ids.bankId, [h.ids.agencyId]);
}, 180_000);

afterAll(async () => {
  await primary.teardown();
  await stopRtHarness(h);
}, 60_000);

beforeEach(async () => {
  await h.redis.flushall();
  await h.db.query(`DELETE FROM tickets`);
  await h.db.query(`UPDATE queues SET current_ticket_number = 0`);
  await h.db.query(`UPDATE counters SET current_ticket_id = NULL`);
});

/** Construit un payload `ticket:called` conforme au CONTRAT (forme diffusée). */
function contractCalledPayload(agencyId: string): Record<string, unknown> {
  return {
    ticket: {
      id: "00000000-0000-4000-a000-000000000001",
      number: "A001",
      status: "CALLED",
      serviceId: "00000000-0000-4000-a000-000000000002",
      agencyId,
      channel: "KIOSK",
      createdAt: new Date().toISOString(),
    },
    counter: { id: "00000000-0000-4000-a000-000000000003", label: "Guichet 1" },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. p95 <500 ms — protocole normé (t0=io.emit serveur, t1=handler client)
// ─────────────────────────────────────────────────────────────────────────────

describe("RT-002: ticket:called p95 <500ms — protocole normé (t0=io.emit, t1=handler client, ≥50 échantillons warm-up exclu, loopback+adapter Redis)", () => {
  it(
    "RT-002: p95 réel loggé sous le SLA loopback documenté (adapter Redis actif, websocket)",
    async () => {
      const WARMUP = 5;
      const SAMPLES = 50;
      const room = `agency:${h.ids.agencyId}`;
      const client = await connectAndJoin(primary.url, agentToken, h.ids.agencyId);

      const latencies: number[] = [];
      for (let i = 0; i < WARMUP + SAMPLES; i++) {
        const latency = await measureOne(client, primary, room, h.ids.agencyId);
        if (i >= WARMUP) latencies.push(latency);
      }

      latencies.sort((a, b) => a - b);
      const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? latencies[latencies.length - 1] ?? 0;
      const max = latencies[latencies.length - 1] ?? 0;
      // TRACE diagnostic CI (protocole D8) : p95 réel loggé, jamais masqué.
      logger.info(
        { p95, max, samples: latencies.length, slaMs: TICKET_CALLED_SLA_MS, adapter: "redis" },
        "RT-002:p95-measured"
      );

      // Assertion TOLÉRANTE : le SLA loopback est un plafond souple (le p95
      // loopback est ~ord. ms). PAS d'assertion horloge-murale par appel.
      expect(latencies.length).toBe(SAMPLES);
      expect(p95).toBeLessThan(TICKET_CALLED_SLA_MS);

      client.disconnect();
    },
    180_000
  );
});

/** Un échantillon : t0 avant io.emit serveur, t1 dans le handler client. */
function measureOne(
  client: ClientSocket,
  instance: RtInstance,
  room: string,
  agencyId: string
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("échantillon p95 timeout")), 5_000);
    client.once("ticket:called", () => {
      const t1 = performance.now();
      clearTimeout(timeout);
      resolve(t1 - t0);
    });
    const t0 = performance.now();
    instance.io.to(room).emit("ticket:called", contractCalledPayload(agencyId));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Reconnexion → convergence d'ÉTAT (snapshot), pas de rejeu (D4)
// ─────────────────────────────────────────────────────────────────────────────

describe("RT-002: coupure WS puis reconnexion → sync:state → convergence d'état (files/guichets/recentCalls exacts, estimate hors scope), pas de rejeu", () => {
  it(
    "RT-002: après coupure/reprise réelle, l'état FINAL client (snapshot) == état serveur",
    async () => {
      // Sème un ticket CALLED → recentCalls non vide côté serveur.
      await h.db.query(
        `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, tracking_id, channel, status, display_number, counter_id, called_at)
         VALUES ($1,$2,$3,$4,1,$5,'KIOSK','CALLED','OC-001',$6,NOW())`,
        [h.ids.bankId, h.ids.agencyId, h.ids.queueId, h.ids.serviceId, "trackrt002resync0001", h.ids.counterId]
      );
      // Un ticket WAITING → files.length == 1.
      await insertWaitingTicket(h.db, h.ids);

      const client = await connectAndJoin(primary.url, agentToken, h.ids.agencyId, {
        reconnection: true,
      });

      // Un resynchro sur (re)connexion : re-join + sync:request.
      const requestSync = (): void => {
        client.emit("join:agency", { agencyId: h.ids.agencyId });
        client.emit("sync:request", { agencyId: h.ids.agencyId });
      };
      client.on("connect", requestSync);

      // COUPURE WS RÉELLE : on ferme le moteur de transport bas niveau — le
      // client détecte la perte et RECONNECTE tout seul (reconnection: true).
      await new Promise<void>((resolve) => {
        client.once("disconnect", () => resolve());
        client.io.engine.close();
      });

      // À la reconnexion, le client émet sync:request → reçoit sync:state (snapshot).
      const state = await new Promise<Record<string, unknown>>((resolve, reject) => {
        client.once("sync:state", (payload: unknown) => resolve(payload as Record<string, unknown>));
        setTimeout(() => reject(new Error("sync:state non reçu après reconnexion")), 15_000);
      });

      // Convergence d'ÉTAT : le snapshot client == état serveur (remplacement).
      expect(client.connected).toBe(true);
      expect(state["agencyId"]).toBe(h.ids.agencyId);
      const queues = state["queues"] as Array<{ length: number }>;
      expect(queues.reduce((n, q) => n + q.length, 0)).toBe(1); // 1 WAITING
      const counters = state["counters"] as unknown[];
      expect(counters.length).toBe(2); // 2 guichets semés
      const recentCalls = state["recentCalls"] as Array<{ ticketNumber: string }>;
      expect(recentCalls.length).toBe(1);
      expect(recentCalls[0]?.ticketNumber).toBe("A001"); // le CALLED semé (number=1)
      // estimate HORS scope (D5) : présent mais non asserté sur sa valeur exacte.

      client.disconnect();
    },
    60_000
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Course 2 agents bout-en-bout → un seul ticket:called pour le MÊME ticket
// ─────────────────────────────────────────────────────────────────────────────

describe("RT-002: course 2 agents réelle → un seul ticket:called par ticket, le perdant obtient le suivant", () => {
  it(
    "RT-002: 2 agents appellent le même ticket simultanément → un 200, un 409, exactement UN ticket:called reçu",
    async () => {
      const ticketId = await insertWaitingTicket(h.db, h.ids);

      // Client réel observateur abonné à la room (réception bout-en-bout).
      const observer = await connectAndJoin(primary.url, agentToken, h.ids.agencyId);
      const calledIds: string[] = [];
      observer.on("ticket:called", (payload: { ticket?: { id?: string } }) => {
        if (payload.ticket?.id) calledIds.push(payload.ticket.id);
      });

      // Course RÉELLE : 2 connexions PG isolées → 2 apps concurrentes appellent
      // le MÊME ticket. Verrou Redis SET NX PX + re-vérif transactionnelle tranche.
      const dbA = new Client({ connectionString: h.pgUrl });
      const dbB = new Client({ connectionString: h.pgUrl });
      await Promise.all([dbA.connect(), dbB.connect()]);
      const instA = await bootRtInstance({ db: dbA, redis: h.redis, jwtSecret: h.jwtSecretBytes });
      const instB = await bootRtInstance({ db: dbB, redis: h.redis, jwtSecret: h.jwtSecretBytes });

      try {
        const call = async (inst: RtInstance, counterId: string): Promise<number> => {
          const res = await inst.app.request(`/api/v1/tickets/${ticketId}/call`, {
            method: "POST",
            headers: { Authorization: `Bearer ${agentToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ counterId }),
          });
          return res.status;
        };

        const [sA, sB] = await Promise.all([
          call(instA, h.ids.counterId),
          call(instB, h.ids.counterId2),
        ]);

        // Un seul gagne (200), l'autre 409 (pas d'erreur serveur).
        expect([sA, sB].sort()).toEqual([200, 409]);

        // Laisse le temps à la diffusion socket (adapter Redis) d'arriver.
        await new Promise<void>((resolve) => setTimeout(resolve, 500));

        // JAMAIS deux ticket:called pour le MÊME ticket — exactement UN.
        const forThisTicket = calledIds.filter((id) => id === ticketId);
        expect(forThisTicket.length).toBe(1);

        // Un seul CALLED en base (zéro double-attribution).
        const row = await h.db.query(
          `SELECT count(*)::int AS n FROM tickets WHERE id = $1 AND status = 'CALLED'`,
          [ticketId]
        );
        expect((row.rows[0] as { n: number }).n).toBe(1);
      } finally {
        observer.disconnect();
        await instA.teardown();
        await instB.teardown();
        await dbA.end();
        await dbB.end();
      }
    },
    120_000
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Adapter Redis multi-instance — émission sur B reçue par client de A
// ─────────────────────────────────────────────────────────────────────────────

describe("RT-002: harnais multi-instance dédié (2× createSocketServer port:0, 1 Redis partagé) — émission instance B reçue par client instance A", () => {
  it(
    "RT-002: client abonné sur l'instance A reçoit un ticket:called diffusé via createSocketBus sur l'instance B",
    async () => {
      // 2 instances distinctes (port:0) partageant le MÊME Redis Testcontainer.
      // Chaque instance duplique redis en pub/sub (adapter) via createSocketServer.
      const redisA = new Redis(h.redisUrl, { maxRetriesPerRequest: null });
      const redisB = new Redis(h.redisUrl, { maxRetriesPerRequest: null });
      const dbA = new Client({ connectionString: h.pgUrl });
      const dbB = new Client({ connectionString: h.pgUrl });
      await Promise.all([dbA.connect(), dbB.connect()]);
      const instA = await bootRtInstance({ db: dbA, redis: redisA, jwtSecret: h.jwtSecretBytes });
      const instB = await bootRtInstance({ db: dbB, redis: redisB, jwtSecret: h.jwtSecretBytes });

      try {
        const client = await connectAndJoin(instA.url, agentToken, h.ids.agencyId);

        const received = new Promise<Record<string, unknown>>((resolve, reject) => {
          client.on("ticket:called", (payload: Record<string, unknown>) => resolve(payload));
          setTimeout(() => reject(new Error("ticket:called cross-instance non reçu")), 10_000);
        });

        // Laisse le temps aux abonnements pub/sub de l'adapter de s'établir.
        await new Promise<void>((resolve) => setTimeout(resolve, 300));

        // Émission via le VRAI createSocketBus de l'instance B → relais Redis → A.
        const busB = createSocketBus(instB.io);
        busB.emit("ticket:called", h.ids.agencyId, contractCalledPayload(h.ids.agencyId) as never);

        const payload = await received;
        const p = payload as { ticket: { agencyId: string } };
        expect(p.ticket.agencyId).toBe(h.ids.agencyId);

        client.disconnect();
      } finally {
        await instA.teardown();
        await instB.teardown();
        await redisA.quit();
        await redisB.quit();
        await dbA.end();
        await dbB.end();
      }
    },
    120_000
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Payload invalide non diffusé, sans impact sur la latence des valides
// ─────────────────────────────────────────────────────────────────────────────

describe("RT-002: payload invalide non diffusé, sans impact sur la latence des émissions valides", () => {
  it(
    "RT-002: un payload violant le payloadSchema n'est PAS diffusé; les valides passent vite",
    async () => {
      const room = `agency:${h.ids.agencyId}`;
      const client = await connectAndJoin(primary.url, agentToken, h.ids.agencyId);
      const bus = createSocketBus(primary.io);

      let invalidSeen = false;
      client.on("ticket:called", (payload: { ticket?: { id?: string } }) => {
        if (payload.ticket?.id === "INVALID") invalidSeen = true;
      });

      // Payload invalide (ticket.id non-uuid) → bloqué par createSocketBus (log, no throw).
      bus.emit(
        "ticket:called",
        h.ids.agencyId,
        { ticket: { id: "INVALID" }, counter: { id: "x", label: "" } } as never
      );

      // Une émission VALIDE juste après doit arriver rapidement (non impactée).
      const t0 = performance.now();
      await new Promise<void>((resolve, reject) => {
        client.once("ticket:called", () => resolve());
        primary.io.to(room).emit("ticket:called", contractCalledPayload(h.ids.agencyId));
        setTimeout(() => reject(new Error("émission valide non reçue")), 5_000);
      });
      const latency = performance.now() - t0;

      expect(invalidSeen).toBe(false);
      expect(latency).toBeLessThan(TICKET_CALLED_SLA_MS);

      client.disconnect();
    },
    60_000
  );
});
