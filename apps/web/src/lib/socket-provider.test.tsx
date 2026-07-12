/**
 * Tests for SocketProvider — RT-001b activation.
 *
 * Le provider est testé contre un VRAI serveur socket.io in-process + un vrai
 * client socket.io-client (aucune API réelle nécessaire). On couvre :
 *   - mode off/mock : inchangé (inactive) — non-régression F4
 *   - handshake OK → join:agency → réception ticket:called (forme contrat)
 *   - dashboards : queue:updated + counter:status
 *   - (re)connexion → sync:request / sync:state → convergence d'état (snapshot)
 *   - handshake refusé (UNAUTHORIZED) → état error + repli offline, pas de boucle infinie
 *   - error:forbidden → non-crash
 *
 * @module lib/socket-provider.test
 */
import { describe, it, expect, afterEach, afterAll, beforeEach, beforeAll } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server as IOServer, type Socket as ServerSocket } from "socket.io";
import React, { type ReactElement } from "react";
import { server } from "../test/msw-server";
import { SocketProvider, useSocket } from "./socket-provider";

// Le harnais démarre un VRAI serveur socket.io in-process sur un port aléatoire
// (127.0.0.1) et un vrai client socket.io-client — aucune API ni fetch MSW n'est
// nécessaire ici. Le setup global (`onUnhandledRequest:"error"` + interception
// WebSocket de MSW) casserait le handshake socket.io ; on stoppe donc MSW pour ce
// fichier et on le relance après (les autres suites le rouvrent via le setup).
beforeAll(() => {
  server.close();
});
afterAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

interface TestServer {
  io: IOServer;
  http: HttpServer;
  url: string;
  close: () => Promise<void>;
}

const AGENCY_ID = "cccccccc-cccc-4ccc-accc-cccccccccccc";

function contractTicketCalled(number: string, counterLabel: string): unknown {
  return {
    ticket: {
      id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      number,
      status: "CALLED",
      serviceId: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
      agencyId: AGENCY_ID,
      channel: "KIOSK",
      createdAt: "2026-07-12T09:30:00.000Z",
    },
    counter: { id: "dddddddd-dddd-4ddd-addd-dddddddddddd", label: counterLabel },
  };
}

function contractSyncState(): unknown {
  return {
    agencyId: AGENCY_ID,
    queues: [{ queueId: "eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee", length: 5, estimate: 0, status: "OPEN" }],
    counters: [{ counterId: "dddddddd-dddd-4ddd-addd-dddddddddddd", status: "OPEN" }],
    recentCalls: [
      { ticketNumber: "A099", displayNumber: "OC-099", counterLabel: "Guichet 9", calledAt: "2026-07-12T09:31:00.000Z" },
    ],
    timestamp: "2026-07-12T09:31:05.000Z",
  };
}

async function startServer(opts?: { reject?: boolean }): Promise<TestServer> {
  const http = createServer();
  const io = new IOServer(http, { cors: { origin: "*" } });
  io.use((_socket, next) => {
    if (opts?.reject) {
      next(new Error("UNAUTHORIZED"));
      return;
    }
    next();
  });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const port = (http.address() as AddressInfo).port;
  return {
    io,
    http,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        io.close();
        http.close(() => resolve());
      }),
  };
}

function Probe(): ReactElement {
  const s = useSocket();
  return (
    <div>
      <span data-testid="status">{s.status}</span>
      <span data-testid="connected">{String(s.connected)}</span>
      <span data-testid="hero">{s.tv.hero?.ticketNumber ?? ""}</span>
      <span data-testid="hero-counter">{s.tv.hero?.counterLabel ?? ""}</span>
      <span data-testid="previous-count">{String(s.tv.previous.length)}</span>
      <span data-testid="queue-length">{s.dashboard.lastQueueUpdate?.length ?? ""}</span>
      <span data-testid="counter-status">{s.dashboard.lastCounterStatus?.status ?? ""}</span>
    </div>
  );
}

let servers: TestServer[] = [];

beforeEach(() => {
  servers = [];
});

afterEach(async () => {
  for (const s of servers) await s.close();
  servers = [];
});

describe("SocketProvider", () => {
  it("RT-001b: mode off/mock — provider inactive, aucune connexion (non-régression F4)", () => {
    const { getByTestId } = render(
      <SocketProvider mode="off" url="http://127.0.0.1:1" token="t" agencyId={AGENCY_ID}>
        <Probe />
      </SocketProvider>
    );
    expect(getByTestId("status").textContent).toBe("inactive");
    expect(getByTestId("connected").textContent).toBe("false");
  });

  it("RT-001b: web SocketProvider activé — handshake OK → join:agency → ticket:called (forme contrat) met à jour l'état TV", async () => {
    const srv = await startServer();
    servers.push(srv);
    let joined: string | null = null;
    srv.io.on("connection", (socket: ServerSocket) => {
      socket.on("join:agency", (payload: { agencyId: string }) => {
        joined = payload.agencyId;
        void socket.join(`agency:${payload.agencyId}`);
        socket.emit("ticket:called", contractTicketCalled("A047", "Guichet 3"));
      });
    });

    const { getByTestId } = render(
      <SocketProvider mode="real" url={srv.url} token="valid-jwt" agencyId={AGENCY_ID}>
        <Probe />
      </SocketProvider>
    );

    await waitFor(() => expect(getByTestId("status").textContent).toBe("connected"));
    await waitFor(() => expect(getByTestId("hero").textContent).toBe("A047"));
    expect(joined).toBe(AGENCY_ID);
    expect(getByTestId("connected").textContent).toBe("true");
    expect(getByTestId("hero-counter").textContent).toBe("Guichet 3");
  });

  it("RT-001b: dashboards consomment queue:updated + counter:status (forme contrat)", async () => {
    const srv = await startServer();
    servers.push(srv);
    srv.io.on("connection", (socket: ServerSocket) => {
      socket.on("join:agency", () => {
        socket.emit("queue:updated", {
          queueId: "eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee",
          length: 7,
          estimate: 0,
        });
        socket.emit("counter:status", {
          counterId: "dddddddd-dddd-4ddd-addd-dddddddddddd",
          status: "PAUSED",
        });
      });
    });

    const { getByTestId } = render(
      <SocketProvider mode="real" url={srv.url} token="valid-jwt" agencyId={AGENCY_ID}>
        <Probe />
      </SocketProvider>
    );

    await waitFor(() => expect(getByTestId("queue-length").textContent).toBe("7"));
    await waitFor(() => expect(getByTestId("counter-status").textContent).toBe("PAUSED"));
  });

  it("RT-001b: (re)connexion → sync:request/sync:state → convergence d'état (snapshot recentCalls)", async () => {
    const srv = await startServer();
    servers.push(srv);
    let syncRequests = 0;
    srv.io.on("connection", (socket: ServerSocket) => {
      socket.on("join:agency", (payload: { agencyId: string }) => {
        void socket.join(`agency:${payload.agencyId}`);
      });
      socket.on("sync:request", () => {
        syncRequests += 1;
        socket.emit("sync:state", contractSyncState());
      });
    });

    const { getByTestId } = render(
      <SocketProvider mode="real" url={srv.url} token="valid-jwt" agencyId={AGENCY_ID}>
        <Probe />
      </SocketProvider>
    );

    // Le client émet sync:request au connect ET applique le snapshot (remplacement d'état).
    await waitFor(() => expect(getByTestId("hero").textContent).toBe("A099"));
    expect(syncRequests).toBeGreaterThanOrEqual(1);
    expect(getByTestId("hero-counter").textContent).toBe("Guichet 9");
  });

  it("RT-001b: handshake refusé (UNAUTHORIZED) → état error + repli offline, pas de boucle infinie", async () => {
    const srv = await startServer({ reject: true });
    servers.push(srv);
    let connectAttempts = 0;
    srv.io.engine.on("connection", () => {
      connectAttempts += 1;
    });

    const { getByTestId } = render(
      <SocketProvider mode="real" url={srv.url} token="revoked" agencyId={AGENCY_ID}>
        <Probe />
      </SocketProvider>
    );

    await waitFor(() => expect(getByTestId("status").textContent).toBe("error"));
    expect(getByTestId("connected").textContent).toBe("false");

    // Attendre pour prouver l'absence de boucle de reconnexion infinie (attempts bornés).
    await new Promise((r) => setTimeout(r, 400));
    expect(getByTestId("status").textContent).toBe("error");
    expect(connectAttempts).toBeLessThan(10);
  });

  it("RT-001b: error:forbidden (join/sync hors scope) → non-crash, état géré", async () => {
    const srv = await startServer();
    servers.push(srv);
    srv.io.on("connection", (socket: ServerSocket) => {
      socket.on("join:agency", () => {
        socket.emit("error:forbidden", { reason: "out-of-scope" });
      });
    });

    const { getByTestId } = render(
      <SocketProvider mode="real" url={srv.url} token="valid-jwt" agencyId={AGENCY_ID}>
        <Probe />
      </SocketProvider>
    );

    await waitFor(() => expect(getByTestId("status").textContent).toBe("error"));
    // non-crash : le composant reste monté et rend l'état.
    expect(getByTestId("connected")).toBeTruthy();
  });

  it("RT-001b: invalid ticket:called payload ignoré (affichage stable)", async () => {
    const srv = await startServer();
    servers.push(srv);
    srv.io.on("connection", (socket: ServerSocket) => {
      socket.on("join:agency", () => {
        socket.emit("ticket:called", { garbage: true });
      });
    });

    const { getByTestId } = render(
      <SocketProvider mode="real" url={srv.url} token="valid-jwt" agencyId={AGENCY_ID}>
        <Probe />
      </SocketProvider>
    );

    await waitFor(() => expect(getByTestId("status").textContent).toBe("connected"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(getByTestId("hero").textContent).toBe("");
  });

  it("RT-001b: défaut sans mode explicite = inactif (env off par défaut)", () => {
    const { getByTestId } = render(
      <SocketProvider>
        <Probe />
      </SocketProvider>
    );
    expect(getByTestId("status").textContent).toBe("inactive");
  });
});
