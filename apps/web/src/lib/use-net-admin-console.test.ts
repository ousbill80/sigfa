/**
 * Tests for useNetAdminConsole (NET-001-WEB) — read-only cross-tenant fetch.
 *
 * Verifies the SINGLE canonical route GET /admin/network-overview is used,
 * that NO mutation route is ever requested, the 5 states, the client allow-list
 * (PII dropped), and offline freeze + resync.
 * @module lib/use-net-admin-console.test
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { createSigfaClient } from "@sigfa/contracts";
import { useNetAdminConsole } from "./use-net-admin-console";

const BASE = "http://localhost:4010";
const BANK_A = "11111111-1111-4111-a111-111111111111";
const BANK_B = "22222222-2222-4222-a222-222222222222";

const overviewBody = {
  period: "2026-07",
  generatedAt: "2026-07-12T09:00:00Z",
  aggregate: { totalTickets: 90000, avgTma: 13.4, avgTmt: 9.1, avgTts: 22.5, avgTauxAbandon: 6.2, avgTauxSLA: 79.8, avgOccupation: 66.3, agencyCount: 40, bankCount: 2 },
  banks: [
    { bankId: BANK_A, bankLabel: "Banque A", agencyCount: 24, kiosksOnline: 40, kiosksOffline: 2, totalTickets: 45230, uptimePercent: 99.4, health: "VERT" },
    { bankId: BANK_B, bankLabel: "Banque B", agencyCount: 16, kiosksOnline: 18, kiosksOffline: 6, totalTickets: 30100, uptimePercent: 91.2, health: "ROUGE" },
  ],
};

function makeConsole() {
  const reporting = createSigfaClient("reporting", BASE);
  return renderHook(() => useNetAdminConsole({ reporting, period: "2026-07" }));
}

describe("useNetAdminConsole — lecture seule cross-tenant", () => {
  beforeEach(() => {
    server.use(
      http.get(`${BASE}/admin/network-overview`, () => HttpResponse.json(overviewBody)),
    );
  });

  it("NET-001: appelle uniquement GET /admin/network-overview (aucune route de mutation)", async () => {
    const calls: { method: string; path: string }[] = [];
    server.use(
      http.all(`${BASE}/*`, ({ request }) => {
        calls.push({ method: request.method, path: new URL(request.url).pathname });
        return HttpResponse.json(overviewBody);
      }),
    );
    const { result } = makeConsole();
    await act(async () => {
      await result.current.refresh();
    });
    expect(calls).toEqual([{ method: "GET", path: "/admin/network-overview" }]);
    // Aucune méthode de mutation exposée par le hook.
    expect(result.current).not.toHaveProperty("createBank");
    expect(result.current).not.toHaveProperty("update");
    expect(result.current).not.toHaveProperty("mutate");
  });

  it("NET-001: état nominal (ready) — vue sanitizée par l'allow-list, zéro PII", async () => {
    const { result } = makeConsole();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("ready");
    expect(result.current.view?.banks).toHaveLength(2);
    expect(result.current.view?.synthesis.openIncidents).toBe(1);
    expect(JSON.stringify(result.current.view)).not.toContain("phone");
  });

  it("NET-001: allow-list — champ PII dans la réponse n'atteint jamais la vue", async () => {
    server.use(
      http.get(`${BASE}/admin/network-overview`, () =>
        HttpResponse.json({
          ...overviewBody,
          banks: [
            { bankId: BANK_A, bankLabel: "Banque A", agencyCount: 1, kiosksOnline: 1, kiosksOffline: 0, totalTickets: 5, uptimePercent: 100, health: "VERT", phone: "+2250700000000", trackingId: "trk_x", feedback: "secret" },
          ],
        }),
      ),
    );
    const { result } = makeConsole();
    await act(async () => {
      await result.current.refresh();
    });
    const serialized = JSON.stringify(result.current.view);
    expect(serialized).not.toContain("trk_x");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("2250700000000");
  });

  it("NET-001: état empty — aucune banque", async () => {
    server.use(
      http.get(`${BASE}/admin/network-overview`, () =>
        HttpResponse.json({ period: "2026-07", generatedAt: "z", aggregate: overviewBody.aggregate, banks: [] }),
      ),
    );
    const { result } = makeConsole();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("empty");
  });

  it("NET-001: état error — réponse 500", async () => {
    server.use(
      http.get(`${BASE}/admin/network-overview`, () => HttpResponse.json({ error: { code: "X", message: "y" } }, { status: 500 })),
    );
    const { result } = makeConsole();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("error");
  });

  it("NET-001: état offline — vue figée, puis resync recharge (reconnexion)", async () => {
    const { result } = makeConsole();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("ready");
    const frozen = result.current.view;
    act(() => {
      result.current.goOffline();
    });
    expect(result.current.load).toBe("offline");
    // La vue reste disponible (figée) pendant l'offline.
    expect(result.current.view).toBe(frozen);
    await act(async () => {
      await result.current.resync();
    });
    await waitFor(() => expect(result.current.load).toBe("ready"));
  });
});
