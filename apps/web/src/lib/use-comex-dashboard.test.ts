/**
 * Tests for useComexDashboard (WEB-005) — canonical route via MSW.
 *
 * Verifies GET /reports/kpis?scope=network is the ONLY reporting call (current +
 * previous period), that /reports/comex (rejected invention) is NEVER requested,
 * exactly 3 KPIs are exploited, and the 4 load states.
 * @module lib/use-comex-dashboard.test
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { createSigfaClient } from "@sigfa/contracts";
import { useComexDashboard } from "./use-comex-dashboard";

const BASE = "http://localhost:4010";
const SLA = 15;

function networkBody(over: Record<string, unknown> = {}) {
  return {
    scope: "network",
    period: "2026-07",
    aggregate: {
      totalTickets: 45230,
      avgTma: 11.2,
      avgTmt: 7.8,
      avgTts: 19.0,
      avgTauxAbandon: 5.1,
      avgTauxSLA: 84.3,
      avgOccupation: 69.7,
      agencyCount: 42,
      nps: 40,
      ...over,
    },
  };
}

function makeDashboard() {
  const reporting = createSigfaClient("reporting", BASE);
  return renderHook(() =>
    useComexDashboard({ reporting, period: "2026-07", previousPeriod: "2026-06", slaMinutes: SLA }),
  );
}

describe("useComexDashboard — route canonique", () => {
  beforeEach(() => {
    server.use(
      http.get(`${BASE}/reports/kpis`, ({ request }) => {
        const period = new URL(request.url).searchParams.get("period");
        return HttpResponse.json(networkBody(period === "2026-06" ? { totalTickets: 40000, nps: 30, avgTma: 14 } : {}));
      }),
      http.get(`${BASE}/reports/comex`, () => HttpResponse.json({ error: "invention rejetée" }, { status: 404 })),
    );
  });

  it("WEB-005: route canonique — GET /reports/kpis?scope=network appelée avec exactement 3 KPIs (jamais /reports/comex — vérification mock Prism)", async () => {
    const calls: { path: string; scope: string | null }[] = [];
    server.use(
      http.get(`${BASE}/reports/kpis`, ({ request }) => {
        const url = new URL(request.url);
        calls.push({ path: url.pathname, scope: url.searchParams.get("scope") });
        return HttpResponse.json(networkBody(url.searchParams.get("period") === "2026-06" ? { totalTickets: 40000, nps: 30 } : {}));
      }),
      http.get(`${BASE}/reports/comex`, ({ request }) => {
        calls.push({ path: new URL(request.url).pathname, scope: null });
        return HttpResponse.json({}, { status: 404 });
      }),
    );
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    // Toutes les requêtes reporting visent la route canonique, scope=network.
    expect(calls.every((c) => c.path === "/reports/kpis")).toBe(true);
    expect(calls.every((c) => c.scope === "network")).toBe(true);
    // La route inventée /reports/comex n'est JAMAIS appelée.
    expect(calls.some((c) => c.path === "/reports/comex")).toBe(false);
    // Exactement 3 KPIs exploités.
    expect(result.current.kpis && Object.keys(result.current.kpis).sort()).toEqual(["nps", "tma", "volume"]);
    expect(result.current.load).toBe("ready");
  });

  it("WEB-005: scope=network exclusivement — jamais scope=agency depuis le COMEX", async () => {
    const scopes: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/reports/kpis`, ({ request }) => {
        const url = new URL(request.url);
        scopes.push(url.searchParams.get("scope"));
        return HttpResponse.json(networkBody(url.searchParams.get("period") === "2026-06" ? { totalTickets: 40000, nps: 30 } : {}));
      }),
    );
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    expect(scopes.every((s) => s === "network")).toBe(true);
    expect(scopes).not.toContain("agency");
  });

  it("WEB-005: KPIs dérivés de l'agrégat réseau — TMA, Volume, NPS avec deltas mois précédent", async () => {
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    const k = result.current.kpis!;
    expect(k.tma.value).toBe(11.2);
    expect(k.volume.value).toBe(45230);
    expect(k.nps.value).toBe(40);
    // Deltas depuis le mois précédent (nps 40 vs 30).
    expect(k.nps.delta).toBe(10);
    expect(k.volume.deltaPct).not.toBeNull();
  });
});

describe("useComexDashboard — 4 états", () => {
  it("WEB-005: état loading — état initial avant fetch", () => {
    server.use(http.get(`${BASE}/reports/kpis`, () => HttpResponse.json(networkBody())));
    const { result } = makeDashboard();
    expect(result.current.load).toBe("loading");
  });

  it("WEB-005: état error — /reports/kpis?scope=network échoue → message humain", async () => {
    server.use(http.get(`${BASE}/reports/kpis`, () => HttpResponse.json({ error: "boom" }, { status: 500 })));
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("error");
  });

  it("WEB-005: exception réseau → état error", async () => {
    server.use(http.get(`${BASE}/reports/kpis`, () => HttpResponse.error()));
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("error");
  });

  it("WEB-005: aggregate absent → état empty", async () => {
    server.use(http.get(`${BASE}/reports/kpis`, () => HttpResponse.json({ scope: "network", period: "2026-07" })));
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("empty");
  });

  it("WEB-005: mois précédent indisponible → KPIs sans deltas (pas d'erreur)", async () => {
    server.use(
      http.get(`${BASE}/reports/kpis`, ({ request }) => {
        const period = new URL(request.url).searchParams.get("period");
        if (period === "2026-06") return HttpResponse.json({ error: "no data" }, { status: 404 });
        return HttpResponse.json(networkBody());
      }),
    );
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("ready");
    expect(result.current.kpis!.nps.delta).toBeNull();
    expect(result.current.kpis!.volume.deltaPct).toBeNull();
  });

  it("WEB-005: agrégat aux champs non numériques → coercition défensive (défauts 0, NPS null)", async () => {
    server.use(
      http.get(`${BASE}/reports/kpis`, () =>
        HttpResponse.json({
          scope: "network",
          period: "2026-07",
          // Champs présents mais de mauvais type → coercés vers défauts.
          aggregate: { totalTickets: "45000", avgTma: null, avgTauxSLA: "x", agencyCount: undefined, nps: "40" },
        }),
      ),
    );
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    const k = result.current.kpis!;
    expect(k.tma.value).toBe(0);
    expect(k.volume.value).toBe(0);
    // NPS non numérique → null → KPI partiel.
    expect(k.nps.value).toBeNull();
    expect(k.nps.partial).toBe(true);
    // Volume à 0 (coercé) → marqué partiel, jamais 0 brut.
    expect(k.volume.partial).toBe(true);
  });

  it("WEB-005: mois précédent malformé (aggregate absent) → deltas null sans erreur", async () => {
    server.use(
      http.get(`${BASE}/reports/kpis`, ({ request }) => {
        const period = new URL(request.url).searchParams.get("period");
        if (period === "2026-06") return HttpResponse.json({ scope: "network", period: "2026-06" });
        return HttpResponse.json(networkBody());
      }),
    );
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("ready");
    expect(result.current.kpis!.nps.delta).toBeNull();
    expect(result.current.kpis!.volume.deltaPct).toBeNull();
  });

  it("WEB-005: connexion offline/reconnexion — resync", async () => {
    server.use(http.get(`${BASE}/reports/kpis`, () => HttpResponse.json(networkBody())));
    const { result } = makeDashboard();
    act(() => result.current.setConnection("offline"));
    expect(result.current.connection).toBe("offline");
    act(() => result.current.setConnection("connected"));
    expect(result.current.connection).toBe("connected");
  });
});
