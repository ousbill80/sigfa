/**
 * Tests for useBenchmark (REP-003b) — GET /reports/benchmark via MSW.
 * Verifies sortKpi forwarding + server re-rank, bankId RBAC filter, n/a
 * relegation (never client re-categorisation), and the 4 fetch states.
 * @module lib/use-benchmark.test
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { createSigfaClient } from "@sigfa/contracts";
import { useBenchmark } from "./use-benchmark";

const BASE = "http://localhost:4010";
const BANK_ID = "bank-ci-001";
const A = "11111111-1111-4111-a111-111111111111";
const B = "22222222-2222-4222-a222-222222222222";
const C = "33333333-3333-4333-a333-333333333333";
const OTHER = "44444444-4444-4444-a444-444444444444";

const body = {
  period: "2026-07",
  data: [
    { rank: 2, agencyId: B, agencyName: "Agence Cocody", bankId: BANK_ID, status: "ORANGE", tauxSLA: 71.5, tma: 18.2 },
    { rank: 1, agencyId: A, agencyName: "Agence Plateau", bankId: BANK_ID, status: "VERT", tauxSLA: 92.1, tma: 9.3 },
    { rank: 99, agencyId: C, agencyName: "Agence Sans Donnée", bankId: BANK_ID, status: "n/a", tauxSLA: 0, tma: 0 },
    { rank: 3, agencyId: OTHER, agencyName: "Autre Banque", bankId: "bank-other", status: "ROUGE", tauxSLA: 52, tma: 28 },
  ],
  meta: { page: 1, limit: 20, total: 4 },
};

function makeHook(bankId = BANK_ID) {
  const reporting = createSigfaClient("reporting", BASE);
  return renderHook(() => useBenchmark({ reporting, bankId, period: "2026-07" }));
}

describe("REP-003b: benchmarking — fetch + tri + statut serveur", () => {
  beforeEach(() => {
    server.use(http.get(`${BASE}/reports/benchmark`, () => HttpResponse.json(body)));
  });

  it("REP-003b: refresh → GET /reports/benchmark, rangs serveur préservés, n/a en fin", async () => {
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("ready");
    expect(result.current.rows.map((r) => r.agencyId)).toEqual([A, B, C]);
    expect(result.current.rows.at(-1)?.status).toBe("n/a");
  });

  it("REP-003b: sortKpi transmis au serveur (le serveur re-classe, pas le client)", async () => {
    let query = "";
    server.use(
      http.get(`${BASE}/reports/benchmark`, ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json(body);
      }),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh("nps");
    });
    expect(query).toContain("sortKpi=nps");
    expect(result.current.sortKpi).toBe("nps");
  });

  it("REP-003b: RBAC — lignes filtrées sur bankId du JWT (autre banque exclue)", async () => {
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh();
    });
    const ids = result.current.rows.map((r) => r.agencyId);
    expect(ids).toContain(A);
    expect(ids).not.toContain(OTHER);
  });

  it("REP-003b: statut serveur conservé tel quel (aucune re-catégorisation client)", async () => {
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh();
    });
    const byId = Object.fromEntries(result.current.rows.map((r) => [r.agencyId, r.status]));
    expect(byId[A]).toBe("VERT");
    expect(byId[B]).toBe("ORANGE");
    expect(byId[C]).toBe("n/a");
  });

  it("REP-003b: statut inconnu du serveur coercé en n/a (jamais rouge par défaut)", async () => {
    server.use(
      http.get(`${BASE}/reports/benchmark`, () =>
        HttpResponse.json({ period: "2026-07", data: [{ rank: 1, agencyId: A, agencyName: "X", status: "WAT" }], meta: {} }),
      ),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.rows[0]?.status).toBe("n/a");
  });
});

describe("REP-003b: benchmarking — 4 états", () => {
  it("REP-003b: état loading initial", () => {
    server.use(http.get(`${BASE}/reports/benchmark`, () => HttpResponse.json(body)));
    const { result } = makeHook();
    expect(result.current.load).toBe("loading");
  });

  it("REP-003b: état empty — aucune agence de la banque", async () => {
    server.use(http.get(`${BASE}/reports/benchmark`, () => HttpResponse.json({ ...body, data: [] })));
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("empty");
  });

  it("REP-003b: état error — 500 serveur", async () => {
    server.use(http.get(`${BASE}/reports/benchmark`, () => HttpResponse.json({ error: "boom" }, { status: 500 })));
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("error");
  });

  it("REP-003b: exception réseau → état error", async () => {
    server.use(http.get(`${BASE}/reports/benchmark`, () => HttpResponse.error()));
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("error");
  });

  it("REP-003b: data non-tableau → empty (aucun crash)", async () => {
    server.use(http.get(`${BASE}/reports/benchmark`, () => HttpResponse.json({ period: "2026-07", meta: {} })));
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.load).toBe("empty");
  });
});
