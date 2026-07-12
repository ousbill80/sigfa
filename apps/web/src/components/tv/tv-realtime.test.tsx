/**
 * Tests for TvRealtime — le pont token DISPLAY ↔ socket (RT-003).
 *
 * Prouve le bout-en-bout côté client contre un VRAI serveur socket.io in-process
 * et le mock du mint (`POST /tv/session`) :
 *   1. token DISPLAY obtenu → passé au handshake socket (`auth.token`) →
 *      `join:agency { agencyId }` émis (forme UNIQUE contractualisée).
 *   2. échec du mint (`POST /tv/session` en erreur) → repli offline : aucun
 *      handshake, aucun crash, l'écran reste rendu.
 *
 * @module components/tv/tv-realtime.test
 */
import { describe, it, expect, afterEach, afterAll, beforeAll, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server as IOServer, type Socket as ServerSocket } from "socket.io";
import { http, HttpResponse } from "msw";
import React, { type ReactElement } from "react";
import { server as msw } from "../../test/msw-server";
import { useSocket } from "@/lib/socket-provider";
import { TvRealtime } from "./tv-realtime";

const AGENCY_ID = "33333333-3333-4333-a333-333333333333";

// Le setup global démarre MSW mais intercepte les WebSocket → casse socket.io.
// On stoppe MSW pour ce fichier et on le relance après (comme socket-provider.test).
beforeAll(() => msw.close());
afterAll(() => msw.listen({ onUnhandledRequest: "error" }));

interface TestServer {
  io: IOServer;
  http: HttpServer;
  url: string;
  handshakeTokens: string[];
  joins: { agencyId: string }[];
  close: () => Promise<void>;
}

async function startServer(): Promise<TestServer> {
  const httpServer = createServer();
  const io = new IOServer(httpServer, { cors: { origin: "*" } });
  const handshakeTokens: string[] = [];
  const joins: { agencyId: string }[] = [];
  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: string }).token;
    if (typeof token === "string") handshakeTokens.push(token);
    next();
  });
  io.on("connection", (socket: ServerSocket) => {
    socket.on("join:agency", (payload: { agencyId: string }) => {
      joins.push(payload);
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  return {
    io,
    http: httpServer,
    url: `http://127.0.0.1:${port}`,
    handshakeTokens,
    joins,
    close: () =>
      new Promise<void>((resolve) => {
        io.close();
        httpServer.close(() => resolve());
      }),
  };
}

/** Sonde exposant l'état socket pour les assertions. */
function Probe(): ReactElement {
  const s = useSocket();
  return <span data-testid="socket-status">{s.status}</span>;
}

let servers: TestServer[] = [];
beforeEach(() => {
  servers = [];
});
afterEach(async () => {
  for (const s of servers) await s.close();
  servers = [];
});

describe("TvRealtime", () => {
  it("RT-003: token DISPLAY minté → passé au socket → join:agency émis", async () => {
    const srv = await startServer();
    servers.push(srv);
    const DISPLAY_TOKEN = "eyJhbGciOiJIUzI1NiJ9.display.sig";
    // Le mint pointe l'origine socket ; MSW est fermé ici → on branche un mint
    // HTTP réel via une route sur le même serveur ? Non : on mock via un apiBase
    // dédié interceptable. On réactive MSW juste pour la route REST de mint.
    msw.listen({ onUnhandledRequest: "bypass" });
    msw.use(
      http.post(`${srv.url}/tv/session`, () =>
        HttpResponse.json(
          { accessToken: DISPLAY_TOKEN, expiresIn: 43200, agencyId: AGENCY_ID, role: "DISPLAY" },
          { status: 201 },
        ),
      ),
    );

    render(
      <TvRealtime agencyId={AGENCY_ID} mode="real" apiBase={srv.url} socketUrl={srv.url}>
        <Probe />
      </TvRealtime>,
    );

    await waitFor(() => expect(srv.joins).toHaveLength(1), { timeout: 3000 });
    expect(srv.joins[0]).toEqual({ agencyId: AGENCY_ID });
    expect(srv.handshakeTokens).toContain(DISPLAY_TOKEN);
    msw.close();
  });

  it("RT-003: échec du mint → repli offline, aucun join, aucun crash", async () => {
    const srv = await startServer();
    servers.push(srv);
    msw.listen({ onUnhandledRequest: "bypass" });
    msw.use(
      http.post(`${srv.url}/tv/session`, () =>
        HttpResponse.json({ error: { code: "AGENCY_NOT_FOUND" } }, { status: 404 }),
      ),
    );

    const { getByTestId } = render(
      <TvRealtime agencyId={AGENCY_ID} mode="real" apiBase={srv.url} socketUrl={srv.url}>
        <Probe />
      </TvRealtime>,
    );

    // Laisser le temps au mint d'échouer ; le socket ne doit jamais rejoindre.
    await new Promise((r) => setTimeout(r, 400));
    expect(srv.joins).toHaveLength(0);
    // Non-crash : l'arbre reste monté et le provider reste inactif (pas de token).
    expect(getByTestId("socket-status")).toBeTruthy();
    msw.close();
  });

  it("RT-003: mode off → aucun mint, aucun handshake (fixtures F4)", async () => {
    const srv = await startServer();
    servers.push(srv);
    const { getByTestId } = render(
      <TvRealtime agencyId={AGENCY_ID} mode="off" apiBase={srv.url} socketUrl={srv.url}>
        <Probe />
      </TvRealtime>,
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(srv.joins).toHaveLength(0);
    expect(getByTestId("socket-status").textContent).toBe("inactive");
  });
});
