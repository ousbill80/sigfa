/**
 * Tests for useManagerDashboard (WEB-003) — KPIs + counter PATCH via MSW.
 * @module lib/use-manager-dashboard.test
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { createSigfaClient } from "@sigfa/contracts";
import { useManagerDashboard } from "./use-manager-dashboard";
import type { AgentRow } from "./manager-state";

const BASE = "http://localhost:4010";
const AGENCY_ID = "33333333-3333-4333-a333-333333333333";
const COUNTER_ID = "cccccccc-cccc-4ccc-accc-cccccccccccc";

const seedAgents: AgentRow[] = [
  { counterId: COUNTER_ID, label: "Guichet 1", agentName: "Koné A.", status: "OPEN", ticketNumber: "A047", alerted: false },
];

function makeDashboard(readOnly = false) {
  const reporting = createSigfaClient("reporting", BASE);
  const core = createSigfaClient("core", BASE);
  return renderHook(() =>
    useManagerDashboard({ reporting, core, agencyId: AGENCY_ID, period: "2026-07", seedAgents, readOnly }),
  );
}

const kpiBody = {
  scope: "agency",
  period: "2026-07",
  agencyId: AGENCY_ID,
  kpis: {
    tma: { value: 12.5, unit: "minutes" },
    tmt: { value: 8.3, unit: "minutes" },
    tts: { value: 20.8, unit: "minutes" },
    tauxAbandon: { value: 4.2, unit: "percent" },
    tauxSLA: { value: 87.5, unit: "percent" },
    nps: 42,
    occupation: { value: 73.1, unit: "percent" },
  },
};

describe("useManagerDashboard — KPIs (route canonique)", () => {
  it("WEB-003: appelle GET /reports/kpis?scope=agency (jamais /reports/live)", async () => {
    let calledUrl = "";
    server.use(
      http.get(`${BASE}/reports/kpis`, ({ request }) => {
        calledUrl = request.url;
        return HttpResponse.json(kpiBody);
      }),
      http.get(`${BASE}/reports/live`, () => HttpResponse.json({ error: "rejected" }, { status: 404 })),
    );
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refreshKpis();
    });
    expect(calledUrl).toContain("/reports/kpis");
    expect(calledUrl).toContain("scope=agency");
    expect(calledUrl).not.toContain("/reports/live");
    expect(result.current.load).toBe("ready");
    expect(result.current.state.kpis?.tma.value).toBe(12.5);
  });

  it("WEB-003: état error si le fetch KPIs échoue", async () => {
    server.use(http.get(`${BASE}/reports/kpis`, () => HttpResponse.json({ error: "boom" }, { status: 500 })));
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refreshKpis();
    });
    expect(result.current.load).toBe("error");
  });

  it("WEB-003: état empty si aucune donnée (pas de KPI à zéro trompeur)", async () => {
    server.use(http.get(`${BASE}/reports/kpis`, () => HttpResponse.json({ scope: "agency", period: "2026-07" })));
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refreshKpis();
    });
    expect(result.current.load).toBe("empty");
    expect(result.current.state.kpis).toBeNull();
  });

  it("WEB-003: exception réseau sur le fetch KPIs → état error", async () => {
    server.use(http.get(`${BASE}/reports/kpis`, () => HttpResponse.error()));
    const { result } = makeDashboard();
    await act(async () => {
      await result.current.refreshKpis();
    });
    expect(result.current.load).toBe("error");
  });
});

describe("useManagerDashboard — MANAGER OPEN/PAUSED", () => {
  beforeEach(() => {
    server.use(
      http.patch(`${BASE}/counters/${COUNTER_ID}`, () =>
        HttpResponse.json({ id: COUNTER_ID, label: "Guichet 1", agencyId: AGENCY_ID, status: "PAUSED" }),
      ),
    );
  });

  it("WEB-003: MANAGER — bascule → PATCH /counters/:id, reflété dans la grille", async () => {
    let method = "";
    server.use(
      http.patch(`${BASE}/counters/${COUNTER_ID}`, ({ request }) => {
        method = request.method;
        return HttpResponse.json({ id: COUNTER_ID, label: "Guichet 1", agencyId: AGENCY_ID, status: "PAUSED" });
      }),
    );
    const { result } = makeDashboard(false);
    await act(async () => {
      await result.current.toggleCounter(COUNTER_ID, "PAUSED");
    });
    expect(method).toBe("PATCH");
    expect(result.current.state.agents[0]?.status).toBe("PAUSED");
  });

  it("WEB-003: toggleCounter en erreur serveur → grille inchangée (pas de reflet)", async () => {
    server.use(
      http.patch(`${BASE}/counters/${COUNTER_ID}`, () => HttpResponse.json({ error: { code: "CONFLICT" } }, { status: 409 })),
    );
    const { result } = makeDashboard(false);
    await act(async () => {
      await result.current.toggleCounter(COUNTER_ID, "PAUSED");
    });
    expect(result.current.state.agents[0]?.status).toBe("OPEN");
  });

  it("WEB-003: toggleCounter exception réseau → best-effort, aucun crash", async () => {
    server.use(http.patch(`${BASE}/counters/${COUNTER_ID}`, () => HttpResponse.error()));
    const { result } = makeDashboard(false);
    await act(async () => {
      await result.current.toggleCounter(COUNTER_ID, "PAUSED");
    });
    expect(result.current.state.agents[0]?.status).toBe("OPEN");
  });

  it("WEB-003: AUDITOR (read-only) — toggleCounter ne fait aucun appel", async () => {
    let called = false;
    server.use(
      http.patch(`${BASE}/counters/${COUNTER_ID}`, () => {
        called = true;
        return HttpResponse.json({ id: COUNTER_ID, label: "Guichet 1", agencyId: AGENCY_ID, status: "PAUSED" });
      }),
    );
    const { result } = makeDashboard(true);
    await act(async () => {
      await result.current.toggleCounter(COUNTER_ID, "PAUSED");
    });
    expect(called).toBe(false);
    expect(result.current.state.agents[0]?.status).toBe("OPEN");
  });
});

describe("useManagerDashboard — événements & offline", () => {
  it("WEB-003: applyEvent queue:updated met à jour la file", () => {
    const { result } = makeDashboard();
    act(() => {
      result.current.applyEvent("queue:updated", { queueId: "13131313-1313-4131-a131-131313131313", length: 9, estimate: 900 });
    });
    expect(result.current.state.queues[0]?.length).toBe(9);
  });

  it("WEB-003: applyEvent counter:status met à jour la grille", () => {
    const { result } = makeDashboard();
    act(() => {
      result.current.applyEvent("counter:status", { counterId: COUNTER_ID, status: "CLOSED" });
    });
    expect(result.current.state.agents[0]?.status).toBe("CLOSED");
  });

  it("WEB-003: alert:manager SLA_BREACH → card, acquittement la retire", () => {
    const { result } = makeDashboard();
    act(() => {
      result.current.applyEvent("alert:manager", { type: "SLA_BREACH", payload: { counterId: COUNTER_ID } }, "al1");
    });
    expect(result.current.state.alerts).toHaveLength(1);
    act(() => result.current.acknowledge("al1"));
    expect(result.current.state.alerts).toHaveLength(0);
  });

  it("WEB-003: offline fige la connexion", () => {
    const { result } = makeDashboard();
    act(() => result.current.setConnection("offline"));
    expect(result.current.state.connection).toBe("offline");
  });
});
