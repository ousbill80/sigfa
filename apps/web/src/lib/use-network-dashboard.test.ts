/**
 * Tests for useNetworkDashboard (WEB-004) — canonical routes via MSW.
 *
 * Verifies GET /reports/benchmark + GET /admin/network-overview are called and
 * that /reports/network (rejected invention) is NEVER requested, bankId
 * filtering, the 5 states, and simulated events.
 * @module lib/use-network-dashboard.test
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { createSigfaClient } from "@sigfa/contracts";
import { useNetworkDashboard } from "./use-network-dashboard";

const BASE = "http://localhost:4010";
const BANK_ID = "bank-ci-001";

// Valid UUIDs — agency:offline is contract-validated (uuid required).
const A_PLATEAU = "11111111-1111-4111-a111-111111111111";
const A_BOUAKE = "22222222-2222-4222-a222-222222222222";
const A_KORHOGO = "33333333-3333-4333-a333-333333333333";
const A_OTHER = "44444444-4444-4444-a444-444444444444";

const benchmarkBody = {
  period: "2026-07",
  thresholds: { sla: { vert: 80, orange: 60 }, tma: { vert: 15, orange: 25 } },
  data: [
    { rank: 1, agencyId: A_PLATEAU, agencyName: "Agence Plateau", bankId: BANK_ID, city: "Abidjan", status: "VERT", tauxSLA: 92.1, tma: 9.3 },
    { rank: 2, agencyId: A_BOUAKE, agencyName: "Agence Bouaké", bankId: BANK_ID, city: "Bouaké", status: "ORANGE", tauxSLA: 71.5, tma: 22.0 },
    { rank: 3, agencyId: A_KORHOGO, agencyName: "Agence Korhogo", bankId: BANK_ID, city: "Korhogo", status: "ROUGE", tauxSLA: 52.0, tma: 34.0 },
    // Agence d'une AUTRE banque — doit être filtrée par bankId.
    { rank: 4, agencyId: A_OTHER, agencyName: "Agence Autre Banque", bankId: "bank-other", city: "Man", status: "VERT", tauxSLA: 90, tma: 8 },
  ],
  meta: { page: 1, limit: 20, total: 4 },
};

const overviewBody = {
  period: "2026-07",
  generatedAt: "2026-07-12T09:00:00Z",
  aggregate: { totalTickets: 284560, avgTma: 13.4, avgTmt: 9.1, avgTts: 22.5, avgTauxAbandon: 6.2, avgTauxSLA: 79.8, avgOccupation: 66.3, agencyCount: 3, bankCount: 1 },
};

function makeDashboard(bankId = BANK_ID) {
  const reporting = createSigfaClient("reporting", BASE);
  return renderHook(() => useNetworkDashboard({ reporting, bankId, period: "2026-07", slaMinutes: 15 }));
}

describe("useNetworkDashboard — routes canoniques", () => {
  beforeEach(() => {
    server.use(
      http.get(`${BASE}/reports/benchmark`, () => HttpResponse.json(benchmarkBody)),
      http.get(`${BASE}/admin/network-overview`, () => HttpResponse.json(overviewBody)),
      http.get(`${BASE}/reports/network`, () => HttpResponse.json({ error: "rejected invention" }, { status: 404 })),
    );
  });

  it("WEB-004: routes canoniques — GET /reports/benchmark et /admin/network-overview appelées (jamais /reports/network)", async () => {
    const called: string[] = [];
    server.use(
      http.get(`${BASE}/reports/benchmark`, ({ request }) => {
        called.push(new URL(request.url).pathname);
        return HttpResponse.json(benchmarkBody);
      }),
      http.get(`${BASE}/admin/network-overview`, ({ request }) => {
        called.push(new URL(request.url).pathname);
        return HttpResponse.json(overviewBody);
      }),
      http.get(`${BASE}/reports/network`, ({ request }) => {
        called.push(new URL(request.url).pathname);
        return HttpResponse.json({}, { status: 404 });
      }),
    );
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    expect(called).toContain("/reports/benchmark");
    expect(called).toContain("/admin/network-overview");
    expect(called).not.toContain("/reports/network");
    expect(result.current.load).toBe("ready");
  });

  it("WEB-004: RBAC BANK_ADMIN — données filtrées sur bankId du JWT", async () => {
    const { result } = makeDashboard(BANK_ID);
    await act(async () => {
      await result.current.refresh();
    });
    const ids = result.current.state.agencies.map((a) => a.agencyId);
    expect(ids).toContain(A_PLATEAU);
    expect(ids).not.toContain(A_OTHER);
    expect(result.current.state.agencies).toHaveLength(3);
  });

  it("WEB-004: classement trié par TMA décroissant après fetch", async () => {
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    const tmas = result.current.state.agencies.map((a) => a.tma);
    expect(tmas).toEqual([...tmas].sort((x, y) => y - x));
    expect(result.current.state.agencies[0]?.agencyId).toBe(A_KORHOGO);
  });

  it("WEB-004: overview réseau exposé (network-overview aggregate)", async () => {
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.overview?.agencyCount).toBe(3);
  });

  it("WEB-004: lignes malformées coercées défensivement (id manquant ignoré, champs par défaut)", async () => {
    server.use(
      http.get(`${BASE}/reports/benchmark`, () =>
        HttpResponse.json({
          period: "2026-07",
          data: [
            { rank: 1, agencyName: "Sans id" }, // agencyId manquant → ignorée
            { rank: 2, agencyId: A_PLATEAU, agencyName: "Champs partiels" }, // city/tma/tauxSLA absents → défauts
          ],
          meta: { page: 1, limit: 20, total: 2 },
        }),
      ),
      http.get(`${BASE}/admin/network-overview`, () => HttpResponse.json(overviewBody)),
    );
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.state.agencies).toHaveLength(1);
    const only = result.current.state.agencies[0]!;
    expect(only.agencyId).toBe(A_PLATEAU);
    expect(only.city).toBe("");
    expect(only.tma).toBe(0);
    expect(only.tauxSLA).toBe(0);
  });

  it("WEB-004: data non-tableau → empty (aucun crash)", async () => {
    server.use(
      http.get(`${BASE}/reports/benchmark`, () => HttpResponse.json({ period: "2026-07", meta: {} })),
      http.get(`${BASE}/admin/network-overview`, () => HttpResponse.json(overviewBody)),
    );
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("empty");
  });

  it("WEB-004: overview aux champs manquants → défauts 0 (pas de NaN)", async () => {
    server.use(
      http.get(`${BASE}/reports/benchmark`, () => HttpResponse.json(benchmarkBody)),
      http.get(`${BASE}/admin/network-overview`, () => HttpResponse.json({ period: "2026-07", aggregate: {} })),
    );
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.overview).toEqual({ agencyCount: 0, avgTma: 0, avgTauxSLA: 0 });
  });

  it("WEB-004: overview absent (pas d'aggregate) → overview reste null", async () => {
    server.use(
      http.get(`${BASE}/reports/benchmark`, () => HttpResponse.json(benchmarkBody)),
      http.get(`${BASE}/admin/network-overview`, () => HttpResponse.json({ period: "2026-07" })),
    );
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.overview).toBeNull();
  });
});

describe("useNetworkDashboard — 5 états", () => {
  it("WEB-004: état loading — skeleton classement + carte vide (état initial)", () => {
    const { result } = makeDashboard();
    expect(result.current.load).toBe("loading");
  });

  it("WEB-004: état empty — aucune agence de la banque (lien vers WEB-006)", async () => {
    server.use(
      http.get(`${BASE}/reports/benchmark`, () => HttpResponse.json({ ...benchmarkBody, data: [] })),
      http.get(`${BASE}/admin/network-overview`, () => HttpResponse.json(overviewBody)),
    );
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("empty");
  });

  it("WEB-004: état error — message humain si /reports/benchmark échoue", async () => {
    server.use(
      http.get(`${BASE}/reports/benchmark`, () => HttpResponse.json({ error: "boom" }, { status: 500 })),
      http.get(`${BASE}/admin/network-overview`, () => HttpResponse.json(overviewBody)),
    );
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("error");
  });

  it("WEB-004: exception réseau → état error", async () => {
    server.use(
      http.get(`${BASE}/reports/benchmark`, () => HttpResponse.error()),
      http.get(`${BASE}/admin/network-overview`, () => HttpResponse.json(overviewBody)),
    );
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("error");
  });
});

describe("useNetworkDashboard — événements simulés & offline", () => {
  beforeEach(() => {
    server.use(
      http.get(`${BASE}/reports/benchmark`, () => HttpResponse.json(benchmarkBody)),
      http.get(`${BASE}/admin/network-overview`, () => HttpResponse.json(overviewBody)),
    );
  });

  it("WEB-004: agency:offline → marqueur carte + ligne classement passent en état hors ligne", async () => {
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    act(() => {
      result.current.applyOffline({ agencyId: A_PLATEAU, since: "2026-07-12T09:00:00Z" });
    });
    const row = result.current.state.agencies.find((a) => a.agencyId === A_PLATEAU);
    expect(row?.offline).toBe(true);
  });

  it("WEB-004: alert:manager reçu d'une agence → panneau alertes, source agence identifiée", async () => {
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    act(() => {
      result.current.applyAlert(A_BOUAKE, { type: "SLA_BREACH", payload: {} }, "al-1");
    });
    expect(result.current.state.alerts).toHaveLength(1);
    expect(result.current.state.alerts[0]?.agencyName).toBe("Agence Bouaké");
  });

  it("WEB-004: état offline — reconnexion resync (connection connected)", async () => {
    const { result } = makeDashboard();
    act(() => result.current.setConnection("offline"));
    expect(result.current.state.connection).toBe("offline");
    act(() => result.current.setConnection("connected"));
    expect(result.current.state.connection).toBe("connected");
  });
});
