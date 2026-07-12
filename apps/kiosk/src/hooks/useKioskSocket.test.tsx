/**
 * Tests for KioskSocketProvider — RT-001b (kiosk créé).
 *
 * Même contrat que le provider web : testé contre un VRAI serveur socket.io
 * in-process + un vrai client socket.io-client. Surfaces borne/TV consomment
 * le réel (ticket:called / sync:state.recentCalls / queue:updated).
 *
 * @module hooks/useKioskSocket.test
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server as IOServer, type Socket as ServerSocket } from "socket.io";
import React, { type ReactElement } from "react";
import { KioskSocketProvider, useKioskSocket } from "./useKioskSocket";

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
  const s = useKioskSocket();
  return (
    <div>
      <span data-testid="status">{s.status}</span>
      <span data-testid="connected">{String(s.connected)}</span>
      <span data-testid="hero">{s.tv.hero?.ticketNumber ?? ""}</span>
      <span data-testid="hero-counter">{s.tv.hero?.counterLabel ?? ""}</span>
      <span data-testid="queue-length">{s.queue.length ?? ""}</span>
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

describe("KioskSocketProvider", () => {
  it("RT-001b: kiosk provider inactif en mode off/mock (aucune connexion)", () => {
    const { getByTestId } = render(
      <KioskSocketProvider mode="off" url="http://127.0.0.1:1" token="t" agencyId={AGENCY_ID}>
        <Probe />
      </KioskSocketProvider>
    );
    expect(getByTestId("status").textContent).toBe("inactive");
    expect(getByTestId("connected").textContent).toBe("false");
  });

  it("RT-001b: kiosk socket.io-client + provider créés — borne/TV consomment le réel (ticket:called)", async () => {
    const srv = await startServer();
    servers.push(srv);
    let joined: string | null = null;
    srv.io.on("connection", (socket: ServerSocket) => {
      socket.on("join:agency", (agencyId: string) => {
        joined = agencyId;
        void socket.join(`agency:${agencyId}`);
        socket.emit("ticket:called", contractTicketCalled("A047", "Guichet 3"));
        socket.emit("queue:updated", {
          queueId: "eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee",
          length: 8,
          estimate: 0,
        });
      });
    });

    const { getByTestId } = render(
      <KioskSocketProvider mode="real" url={srv.url} token="valid-jwt" agencyId={AGENCY_ID}>
        <Probe />
      </KioskSocketProvider>
    );

    await waitFor(() => expect(getByTestId("status").textContent).toBe("connected"));
    await waitFor(() => expect(getByTestId("hero").textContent).toBe("A047"));
    await waitFor(() => expect(getByTestId("queue-length").textContent).toBe("8"));
    expect(joined).toBe(AGENCY_ID);
    expect(getByTestId("hero-counter").textContent).toBe("Guichet 3");
  });

  it("RT-001b: kiosk (re)connexion → sync:request/sync:state → convergence d'état (snapshot)", async () => {
    const srv = await startServer();
    servers.push(srv);
    let syncRequests = 0;
    srv.io.on("connection", (socket: ServerSocket) => {
      socket.on("join:agency", (agencyId: string) => {
        void socket.join(`agency:${agencyId}`);
      });
      socket.on("sync:request", () => {
        syncRequests += 1;
        socket.emit("sync:state", contractSyncState());
      });
    });

    const { getByTestId } = render(
      <KioskSocketProvider mode="real" url={srv.url} token="valid-jwt" agencyId={AGENCY_ID}>
        <Probe />
      </KioskSocketProvider>
    );

    await waitFor(() => expect(getByTestId("hero").textContent).toBe("A099"));
    expect(syncRequests).toBeGreaterThanOrEqual(1);
  });

  it("RT-001b: kiosk handshake refusé (UNAUTHORIZED) → error + repli offline, pas de boucle infinie", async () => {
    const srv = await startServer({ reject: true });
    servers.push(srv);
    let connectAttempts = 0;
    srv.io.engine.on("connection", () => {
      connectAttempts += 1;
    });

    const { getByTestId } = render(
      <KioskSocketProvider mode="real" url={srv.url} token="revoked" agencyId={AGENCY_ID}>
        <Probe />
      </KioskSocketProvider>
    );

    await waitFor(() => expect(getByTestId("status").textContent).toBe("error"));
    await new Promise((r) => setTimeout(r, 400));
    expect(getByTestId("status").textContent).toBe("error");
    expect(connectAttempts).toBeLessThan(10);
  });

  it("RT-001b: kiosk error:forbidden → non-crash, état géré", async () => {
    const srv = await startServer();
    servers.push(srv);
    srv.io.on("connection", (socket: ServerSocket) => {
      socket.on("join:agency", () => {
        socket.emit("error:forbidden", { reason: "out-of-scope" });
      });
    });

    const { getByTestId } = render(
      <KioskSocketProvider mode="real" url={srv.url} token="valid-jwt" agencyId={AGENCY_ID}>
        <Probe />
      </KioskSocketProvider>
    );

    await waitFor(() => expect(getByTestId("status").textContent).toBe("error"));
    expect(getByTestId("connected")).toBeTruthy();
  });

  it("RT-001b: kiosk invalid ticket:called payload ignoré (affichage stable)", async () => {
    const srv = await startServer();
    servers.push(srv);
    srv.io.on("connection", (socket: ServerSocket) => {
      socket.on("join:agency", () => {
        socket.emit("ticket:called", { garbage: true });
      });
    });

    const { getByTestId } = render(
      <KioskSocketProvider mode="real" url={srv.url} token="valid-jwt" agencyId={AGENCY_ID}>
        <Probe />
      </KioskSocketProvider>
    );

    await waitFor(() => expect(getByTestId("status").textContent).toBe("connected"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(getByTestId("hero").textContent).toBe("");
  });

  it("RT-001b: kiosk défaut sans mode explicite = inactif", () => {
    const { getByTestId } = render(
      <KioskSocketProvider>
        <Probe />
      </KioskSocketProvider>
    );
    expect(getByTestId("status").textContent).toBe("inactive");
  });
});
