/**
 * Tests for KiosksPageClient (ADM-003b) — fetches the CANONICAL status route via
 * the typed admin client (mock mode, no socket → poll), gates the network view
 * by role, and renders the supervision screen.
 * @module app/admin/kiosks/kiosks-page-client.test
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { KiosksPageClient } from "./kiosks-page-client";

// No socket in mock mode → the shell never opens io(); mock it defensively so
// an accidental real connection can't leak into the test.
vi.mock("socket.io-client", () => ({
  io: (): { on: () => void; emit: () => void; removeAllListeners: () => void; disconnect: () => void; connected: boolean } => ({
    on: () => {},
    emit: () => {},
    removeAllListeners: () => {},
    disconnect: () => {},
    connected: false,
  }),
}));

const BASE = "http://localhost:4010";
const AGENCY = "33333333-3333-4333-a333-333333333333";
const K1 = "14141414-1414-4141-a141-141414141414";
const K2 = "15151515-1515-4151-a151-151515151515";

function statusHandler(kiosks: unknown[]) {
  return http.get(`${BASE}/agencies/:id/kiosks/status`, () =>
    HttpResponse.json({ kiosks }),
  );
}

afterEach(() => {
  server.resetHandlers();
});

describe("ADM-003b: shell supervision (mode mock, repli poll)", () => {
  it("ADM-003b: lit GET /agencies/{id}/kiosks/status et rend la grille", async () => {
    server.use(
      statusHandler([
        { kioskId: K1, agencyId: AGENCY, status: "ONLINE", lastSeen: "2026-07-12T09:59:30Z" },
        { kioskId: K2, agencyId: AGENCY, status: "SILENT", lastSeen: "2026-07-12T09:40:00Z" },
      ]),
    );
    render(
      <KiosksPageClient apiBase={BASE} agencyId={AGENCY} role="AGENCY_DIRECTOR" realtime={false} />,
    );
    await waitFor(() => expect(screen.getByTestId("kiosk-grid")).toBeInTheDocument());
    expect(screen.getAllByTestId("kiosk-card")).toHaveLength(2);
  });

  it("ADM-003b: AGENCY_DIRECTOR → pas d'onglet vue réseau (RBAC)", async () => {
    server.use(statusHandler([{ kioskId: K1, agencyId: AGENCY, status: "ONLINE", lastSeen: null }]));
    render(
      <KiosksPageClient apiBase={BASE} agencyId={AGENCY} role="AGENCY_DIRECTOR" realtime={false} />,
    );
    await waitFor(() => expect(screen.getByTestId("kiosk-grid")).toBeInTheDocument());
    expect(screen.queryByRole("radio", { name: "Vue réseau" })).not.toBeInTheDocument();
  });

  it("ADM-003b: BANK_ADMIN → onglet vue réseau disponible", async () => {
    server.use(statusHandler([{ kioskId: K1, agencyId: AGENCY, status: "SILENT", lastSeen: "2026-07-12T09:40:00Z" }]));
    render(
      <KiosksPageClient apiBase={BASE} agencyId={AGENCY} role="BANK_ADMIN" realtime={false} />,
    );
    await waitFor(() => expect(screen.getByRole("radio", { name: "Vue réseau" })).toBeInTheDocument());
  });

  it("ADM-003b: route en erreur (500) au premier appel → état error", async () => {
    server.use(
      http.get(`${BASE}/agencies/:id/kiosks/status`, () => new HttpResponse(null, { status: 500 })),
    );
    render(
      <KiosksPageClient apiBase={BASE} agencyId={AGENCY} role="AGENCY_DIRECTOR" realtime={false} />,
    );
    await waitFor(() => expect(screen.getByTestId("supervision-error")).toBeInTheDocument());
  });
});
