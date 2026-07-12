/**
 * Tests for useAdminConsole (WEB-006) — canonical contract routes via MSW.
 *
 * Verifies: real contract routes (never the story's non-existent
 * /agencies/{id}/agents/import), the X-Idempotency-Key decision (NOT sent on
 * admin CRUD/config mutations because the contract does not declare it), 409 →
 * human message, offline blocking, and the CSV import summary.
 * @module lib/use-admin-console.test
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { createSigfaClient } from "@sigfa/contracts";
import { useAdminConsole } from "./use-admin-console";

const BASE = "http://localhost:4010";
const BANK_ID = "11111111-1111-4111-a111-111111111111";
const AGENCY_ID = "33333333-3333-4333-a333-333333333333";

function makeConsole() {
  const core = createSigfaClient("core", BASE);
  const admin = createSigfaClient("admin", BASE);
  const agents = createSigfaClient("agents", BASE);
  return renderHook(() => useAdminConsole({ core, admin, agents, bankId: BANK_ID, agencyId: AGENCY_ID }));
}

describe("useAdminConsole — routes canoniques", () => {
  it("WEB-006: CRUD agence — création, modification, désactivation PASS mock admin.yaml", async () => {
    const paths: { method: string; path: string }[] = [];
    server.use(
      http.post(`${BASE}/agencies`, async ({ request }) => {
        paths.push({ method: "POST", path: new URL(request.url).pathname });
        return HttpResponse.json({ id: "ag-1", name: "Cocody", bankId: BANK_ID, active: true, createdAt: "2026-01-01T00:00:00Z" }, { status: 201 });
      }),
      http.patch(`${BASE}/agencies/:id`, ({ request }) => {
        paths.push({ method: "PATCH", path: new URL(request.url).pathname });
        return HttpResponse.json({ id: "ag-1", name: "Cocody", bankId: BANK_ID, active: false, createdAt: "2026-01-01T00:00:00Z" });
      }),
      http.delete(`${BASE}/agencies/:id`, ({ request }) => {
        paths.push({ method: "DELETE", path: new URL(request.url).pathname });
        return HttpResponse.json({ success: true });
      }),
    );
    const { result } = makeConsole();
    let created!: { ok: boolean };
    await act(async () => {
      created = await result.current.createAgency({ name: "Cocody" });
    });
    expect(created.ok).toBe(true);
    await act(async () => {
      await result.current.updateAgency("ag-1", { active: false });
    });
    await act(async () => {
      await result.current.deleteAgency("ag-1");
    });
    expect(paths).toContainEqual({ method: "POST", path: "/agencies" });
    expect(paths).toContainEqual({ method: "PATCH", path: "/agencies/ag-1" });
    expect(paths).toContainEqual({ method: "DELETE", path: "/agencies/ag-1" });
  });

  it("WEB-006: import CSV via route contractuelle POST /agents/import (jamais /agencies/{id}/agents/import)", async () => {
    const seen: string[] = [];
    server.use(
      http.post(`${BASE}/agents/import`, ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json({ created: 3, skipped: 1, errors: [{ line: 5, field: "email", code: "DUPLICATE_EMAIL", message: "email déjà pris" }] });
      }),
      http.post(`${BASE}/agencies/:id/agents/import`, ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json({}, { status: 404 });
      }),
    );
    const { result } = makeConsole();
    let out!: { ok: boolean; summary?: { created: number; skipped: number; errorCount: number } };
    await act(async () => {
      out = await result.current.importAgents(new File(["email\nx@y.z"], "agents.csv", { type: "text/csv" }));
    });
    expect(out.ok).toBe(true);
    expect(out.summary).toEqual(expect.objectContaining({ created: 3, skipped: 1, errorCount: 1 }));
    // Route canonique appelée, route inventée jamais touchée.
    expect(seen).toContain("/agents/import");
    expect(seen.some((p) => p.endsWith("/agents/import") && p.startsWith("/agencies/"))).toBe(false);
  });

  it("WEB-006: X-Idempotency-Key ABSENT des mutations admin (contrat ne le déclare pas)", async () => {
    const headers: Record<string, string | null> = {};
    server.use(
      http.patch(`${BASE}/banks/:id/thresholds`, ({ request }) => {
        headers.thresholds = request.headers.get("x-idempotency-key");
        return HttpResponse.json({ queueCriticalThreshold: 100, agentInactivityMinutes: 15, noShowTimeoutMinutes: 5 });
      }),
      http.patch(`${BASE}/banks/:id/theme`, ({ request }) => {
        headers.theme = request.headers.get("x-idempotency-key");
        return HttpResponse.json({ requestedColors: { primary: "#003f7f", secondary: "#e8a000", background: "#ffffff" }, appliedColors: { primary: "#003f7f", secondary: "#c07800", background: "#ffffff" }, welcomeMessages: { fr: "x" } });
      }),
      http.post(`${BASE}/services`, ({ request }) => {
        headers.services = request.headers.get("x-idempotency-key");
        return HttpResponse.json({ id: "s1", name: "V", code: "OC", agencyId: AGENCY_ID, slaMinutes: 10, active: true, order: 1 }, { status: 201 });
      }),
    );
    const { result } = makeConsole();
    await act(async () => {
      await result.current.saveThresholds({ queueCriticalThreshold: 100 });
      await result.current.saveThemeColors({ primary: "#003f7f", secondary: "#e8a000", background: "#ffffff" });
      await result.current.createService({ name: "Virements", code: "OC", slaMinutes: 10, order: 1 });
    });
    // Le contrat ne déclare pas IdempotencyKeyParam sur ces routes → header absent.
    expect(headers.thresholds).toBeNull();
    expect(headers.theme).toBeNull();
    expect(headers.services).toBeNull();
  });

  it("WEB-006: 409 API → message humain sans code d'erreur (désactivation agence tickets ouverts)", async () => {
    server.use(
      http.delete(`${BASE}/agencies/:id`, () =>
        HttpResponse.json({ error: { code: "AGENCY_HAS_OPEN_TICKETS", message: "raw" } }, { status: 409 }),
      ),
    );
    const { result } = makeConsole();
    let res!: { ok: boolean; message?: string };
    await act(async () => {
      res = await result.current.deleteAgency("ag-1");
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("tickets ouverts");
    expect(res.message).not.toContain("AGENCY_HAS_OPEN_TICKETS");
  });

  it("WEB-006: état offline — mutations bloquées + message 'Connexion requise pour configurer'", async () => {
    const { result } = makeConsole();
    act(() => result.current.setConnection("offline"));
    let res!: { ok: boolean; message?: string };
    await act(async () => {
      res = await result.current.createService({ name: "V", code: "OC", slaMinutes: 10, order: 1 });
    });
    expect(res.ok).toBe(false);
    expect(res.message).toBe("Connexion requise pour configurer");
    // L'import est aussi bloqué hors ligne.
    let imp!: { ok: boolean; message?: string };
    await act(async () => {
      imp = await result.current.importAgents(new File(["x"], "a.csv"));
    });
    expect(imp.ok).toBe(false);
    expect(imp.message).toBe("Connexion requise pour configurer");
  });

  it("WEB-006: QR d'installation — POST /agencies/{id}/kiosk-access renvoie qrCodeDataUrl", async () => {
    server.use(
      http.post(`${BASE}/agencies/:id/kiosk-access`, () =>
        HttpResponse.json({ kioskId: "k1", clientId: "c", clientSecret: "s", qrCodeDataUrl: "data:image/png;base64,AAA", label: "Borne", agencyId: AGENCY_ID, createdAt: "2026-07-11T10:05:00Z" }, { status: 201 }),
      ),
    );
    const { result } = makeConsole();
    let out!: { ok: boolean; qrCodeDataUrl?: string };
    await act(async () => {
      out = await result.current.generateKioskAccess("Borne entrée");
    });
    expect(out.ok).toBe(true);
    expect(out.qrCodeDataUrl).toContain("data:image/png");
  });

  it("WEB-006: état error — mutation service échoue (500) → message inline humain", async () => {
    server.use(http.post(`${BASE}/services`, () => HttpResponse.json({ error: { code: "X" } }, { status: 500 })));
    const { result } = makeConsole();
    let res!: { ok: boolean; message?: string };
    await act(async () => {
      res = await result.current.createService({ name: "V", code: "OC", slaMinutes: 10, order: 1 });
    });
    expect(res.ok).toBe(false);
    expect(res.message).toBeTruthy();
    expect(res.message).not.toContain("X");
  });

  it("WEB-006: liste agences — GET /agencies (état empty si aucune)", async () => {
    server.use(http.get(`${BASE}/agencies`, () => HttpResponse.json({ data: [], meta: { page: 1, limit: 20, total: 0 } })));
    const { result } = makeConsole();
    let list!: unknown[];
    await act(async () => {
      list = await result.current.listAgencies();
    });
    expect(list).toEqual([]);
  });

  it("WEB-006: liste agences — erreur serveur → liste vide (défensif)", async () => {
    server.use(http.get(`${BASE}/agencies`, () => HttpResponse.json({ error: { code: "X" } }, { status: 500 })));
    const { result } = makeConsole();
    let list!: unknown[];
    await act(async () => {
      list = await result.current.listAgencies();
    });
    expect(list).toEqual([]);
  });

  it("WEB-006: mutations service/guichet/templates — routes canoniques core.yaml/admin.yaml", async () => {
    const seen: { method: string; path: string }[] = [];
    server.use(
      http.patch(`${BASE}/services/:id`, ({ request }) => {
        seen.push({ method: "PATCH", path: new URL(request.url).pathname });
        return HttpResponse.json({ id: "s1", name: "V", agencyId: AGENCY_ID, slaMinutes: 15, active: false, order: 2 });
      }),
      http.post(`${BASE}/counters`, ({ request }) => {
        seen.push({ method: "POST", path: new URL(request.url).pathname });
        return HttpResponse.json({ id: "c1", label: "Guichet 9", agencyId: AGENCY_ID, status: "OPEN" }, { status: 201 });
      }),
      http.patch(`${BASE}/banks/:id/sms-templates`, ({ request }) => {
        seen.push({ method: "PATCH", path: new URL(request.url).pathname });
        return HttpResponse.json({ templates: [{ type: "TICKET_CONFIRMATION", content: "Ticket {{number}}" }] });
      }),
    );
    const { result } = makeConsole();
    const results: { ok: boolean }[] = [];
    await act(async () => {
      results.push(await result.current.updateService("s1", { slaMinutes: 15, active: false, order: 2 }));
      results.push(await result.current.createCounter({ label: "Guichet 9", serviceIds: [] }));
      results.push(await result.current.saveSmsTemplates([{ type: "TICKET_CONFIRMATION", content: "Ticket {{number}}" }]));
    });
    expect(results.every((r) => r.ok)).toBe(true);
    expect(seen).toContainEqual({ method: "PATCH", path: "/services/s1" });
    expect(seen).toContainEqual({ method: "POST", path: "/counters" });
    expect(seen).toContainEqual({ method: "PATCH", path: `/banks/${BANK_ID}/sms-templates` });
  });
});

describe("useAdminConsole — opérations (MODEL-WEB-A, routes canoniques)", () => {
  it("MODEL-WEB-A: CRUD opérations sur routes canoniques (POST/GET /services/{id}/operations, PATCH/DELETE /operations/{id})", async () => {
    const seen: { method: string; path: string }[] = [];
    server.use(
      http.get(`${BASE}/services/:sid/operations`, ({ request }) => {
        seen.push({ method: "GET", path: new URL(request.url).pathname });
        return HttpResponse.json({
          data: [{ id: "op-1", serviceId: "svc-1", code: "DEP", name: "Dépôt", slaMinutes: null, displayOrder: 1, isActive: true }],
          meta: { page: 1, limit: 20, total: 1 },
        });
      }),
      http.post(`${BASE}/services/:sid/operations`, ({ request }) => {
        seen.push({ method: "POST", path: new URL(request.url).pathname });
        return HttpResponse.json({ id: "op-2", serviceId: "svc-1", code: "RET", name: "Retrait", slaMinutes: 5, displayOrder: 2, isActive: true }, { status: 201 });
      }),
      http.patch(`${BASE}/operations/:id`, ({ request }) => {
        seen.push({ method: "PATCH", path: new URL(request.url).pathname });
        return HttpResponse.json({ id: "op-2", serviceId: "svc-1", code: "RET", name: "Retrait", slaMinutes: null, displayOrder: 2, isActive: true });
      }),
      http.delete(`${BASE}/operations/:id`, ({ request }) => {
        seen.push({ method: "DELETE", path: new URL(request.url).pathname });
        return HttpResponse.json({ success: true });
      }),
    );
    const { result } = makeConsole();
    let list!: unknown[];
    const results: { ok: boolean }[] = [];
    await act(async () => {
      list = await result.current.listOperations("svc-1");
      results.push(await result.current.createOperation("svc-1", { code: "RET", name: "Retrait", slaMinutes: 5, displayOrder: 2, isActive: true }));
      results.push(await result.current.updateOperation("op-2", { slaMinutes: null }));
      results.push(await result.current.deleteOperation("op-2"));
    });
    expect(list).toHaveLength(1);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(seen).toContainEqual({ method: "GET", path: "/services/svc-1/operations" });
    expect(seen).toContainEqual({ method: "POST", path: "/services/svc-1/operations" });
    expect(seen).toContainEqual({ method: "PATCH", path: "/operations/op-2" });
    expect(seen).toContainEqual({ method: "DELETE", path: "/operations/op-2" });
  });

  it("MODEL-WEB-A: code dupliqué (409 OPERATION_CODE_DUPLICATE) → message humain, jamais le code brut", async () => {
    server.use(
      http.post(`${BASE}/services/:sid/operations`, () =>
        HttpResponse.json({ error: { code: "OPERATION_CODE_DUPLICATE", message: "raw" } }, { status: 409 }),
      ),
    );
    const { result } = makeConsole();
    let res!: { ok: boolean; message?: string };
    await act(async () => {
      res = await result.current.createOperation("svc-1", { code: "DEP", name: "Dépôt", displayOrder: 1, isActive: true });
    });
    expect(res.ok).toBe(false);
    expect(res.message).toBe("Ce code d'opération existe déjà pour ce service.");
    expect(res.message).not.toContain("OPERATION_CODE_DUPLICATE");
  });

  it("MODEL-WEB-A: liste opérations — erreur serveur → liste vide (défensif)", async () => {
    server.use(http.get(`${BASE}/services/:sid/operations`, () => HttpResponse.json({ error: { code: "X" } }, { status: 500 })));
    const { result } = makeConsole();
    let list!: unknown[];
    await act(async () => {
      list = await result.current.listOperations("svc-1");
    });
    expect(list).toEqual([]);
  });

  it("MODEL-WEB-A: liste services — GET /services (route canonique parente)", async () => {
    server.use(
      http.get(`${BASE}/services`, () =>
        HttpResponse.json({ data: [{ id: "svc-1", name: "OC", code: "OC", agencyId: AGENCY_ID, slaMinutes: 15, active: true, order: 1 }], meta: { page: 1, limit: 20, total: 1 } }),
      ),
    );
    const { result } = makeConsole();
    let list!: unknown[];
    await act(async () => {
      list = await result.current.listServices();
    });
    expect(list).toHaveLength(1);
  });

  it("MODEL-WEB-A: état offline — mutations opérations bloquées", async () => {
    const { result } = makeConsole();
    act(() => result.current.setConnection("offline"));
    let create!: { ok: boolean; message?: string };
    let del!: { ok: boolean; message?: string };
    await act(async () => {
      create = await result.current.createOperation("svc-1", { code: "DEP", name: "Dépôt", displayOrder: 1, isActive: true });
      del = await result.current.deleteOperation("op-1");
    });
    expect(create.ok).toBe(false);
    expect(create.message).toBe("Connexion requise pour configurer");
    expect(del.ok).toBe(false);
  });
});
