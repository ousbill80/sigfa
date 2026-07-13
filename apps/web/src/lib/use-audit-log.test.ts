/**
 * Tests for useAuditLog (SEC-001b) — read-only audit trail via MSW.
 *
 * Verifies: consumes ONLY GET /audit-logs (never a mutation), forwards filters
 * (entityType/entityId/actorId/from/to) + pagination (page/limit) as contract
 * query params, drives the 5 states, and issues ZERO POST/PATCH/DELETE.
 * @module lib/use-audit-log.test
 */
import { describe, it, expect } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { createSigfaClient } from "@sigfa/contracts";
import { useAuditLog } from "./use-audit-log";

const BASE = "http://localhost:4010";

/** A minimal contract-shaped audit entry. */
function entry(action: string) {
  return {
    actor: { id: "55555555-5555-4555-a555-555555555555", role: "MANAGER", email: "m@bnci.ci" },
    action,
    entityType: "queue",
    entityId: "11111111-1111-4111-a111-111111111111",
    timestamp: "2026-07-11T09:00:00Z",
    ip: "41.67.128.1",
    diff: { before: { status: "OPEN" }, after: { status: "PAUSED" } },
  };
}

function makeHook() {
  const admin = createSigfaClient("admin", BASE);
  return renderHook(() => useAuditLog({ admin }));
}

describe("SEC-001b: useAuditLog — lecture seule via GET /audit-logs", () => {
  it("SEC-001b: charge la page 1 → état ready + entrées mappées", async () => {
    server.use(
      http.get(`${BASE}/audit-logs`, () =>
        HttpResponse.json({ data: [entry("PATCH /queues/:id")], meta: { page: 1, limit: 20, total: 1 } }),
      ),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh({ filters: {}, page: 1 });
    });
    expect(result.current.load).toBe("ready");
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]!.action).toBe("PATCH /queues/:id");
    expect(result.current.total).toBe(1);
  });

  it("SEC-001b: aucune donnée → état empty", async () => {
    server.use(
      http.get(`${BASE}/audit-logs`, () => HttpResponse.json({ data: [], meta: { page: 1, limit: 20, total: 0 } })),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh({ filters: {}, page: 1 });
    });
    expect(result.current.load).toBe("empty");
  });

  it("SEC-001b: 500 serveur → état error (jamais de crash)", async () => {
    server.use(http.get(`${BASE}/audit-logs`, () => new HttpResponse(null, { status: 500 })));
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh({ filters: {}, page: 1 });
    });
    expect(result.current.load).toBe("error");
  });

  it("SEC-001b: transmet les filtres qui/quoi/quand au serveur (query params du contrat)", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get(`${BASE}/audit-logs`, ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json({ data: [entry("POST /tickets")], meta: { page: 2, limit: 20, total: 40 } });
      }),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh({
        filters: {
          entityType: "ticket",
          entityId: "22222222-2222-4222-a222-222222222222",
          actorId: "55555555-5555-4555-a555-555555555555",
          from: "2026-07-01T00:00:00Z",
          to: "2026-07-31T23:59:59Z",
        },
        page: 2,
      });
    });
    expect(seen).not.toBeNull();
    const q = seen!;
    expect(q.get("entityType")).toBe("ticket");
    expect(q.get("entityId")).toBe("22222222-2222-4222-a222-222222222222");
    expect(q.get("actorId")).toBe("55555555-5555-4555-a555-555555555555");
    expect(q.get("from")).toBe("2026-07-01T00:00:00Z");
    expect(q.get("to")).toBe("2026-07-31T23:59:59Z");
    expect(q.get("page")).toBe("2");
    expect(q.get("limit")).toBe("20");
  });

  it("SEC-001b: n'émet JAMAIS de mutation (POST/PATCH/DELETE) — read-only strict", async () => {
    const methods: string[] = [];
    server.use(
      http.all(`${BASE}/*`, ({ request }) => {
        methods.push(request.method);
        if (request.method === "GET") {
          return HttpResponse.json({ data: [], meta: { page: 1, limit: 20, total: 0 } });
        }
        return new HttpResponse(null, { status: 405 });
      }),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh({ filters: { entityType: "queue" }, page: 1 });
      await result.current.refresh({ filters: {}, page: 2 });
    });
    await waitFor(() => expect(methods.length).toBeGreaterThan(0));
    // Toutes les requêtes émises sont des lectures.
    expect(methods.every((m) => m === "GET")).toBe(true);
    expect(methods).not.toContain("POST");
    expect(methods).not.toContain("PATCH");
    expect(methods).not.toContain("DELETE");
  });

  it("SEC-001b: valeurs de filtre vides ne sont pas envoyées comme paramètres", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get(`${BASE}/audit-logs`, ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json({ data: [entry("POST /tickets")], meta: { page: 1, limit: 20, total: 1 } });
      }),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.refresh({ filters: { entityType: "  ", entityId: "" }, page: 1 });
    });
    expect(seen!.has("entityType")).toBe(false);
    expect(seen!.has("entityId")).toBe(false);
  });
});
