/**
 * Tests for useReportExport (REP-003b) — trigger + polling via MSW against the
 * REP-003 contract. Verifies GET /reports/export → 202 + jobId, polling until
 * READY/FAILED, expired-URL relaunch, error state. No invented route.
 * @module lib/use-report-export.test
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { createSigfaClient } from "@sigfa/contracts";
import { useReportExport } from "./use-report-export";

const BASE = "http://localhost:4010";
const JOB = "job_export_01";

function makeHook() {
  const reporting = createSigfaClient("reporting", BASE);
  // Fast poll so the test does not idle on the default 1.5s interval.
  return renderHook(() => useReportExport({ reporting, pollIntervalMs: 5 }));
}

const REQ = { format: "pdf", scope: "agency", period: "2026-07", agencyId: "a-1" } as const;

describe("REP-003b: déclenchement + polling", () => {
  beforeEach(() => {
    server.use(
      http.get(`${BASE}/reports/export`, () =>
        HttpResponse.json({ jobId: JOB, status: "PENDING", pollingUrl: `/reports/export/${JOB}` }, { status: 202 }),
      ),
    );
  });

  it("REP-003b: launch → GET /reports/export retourne jobId, jamais de route inventée", async () => {
    const called: string[] = [];
    server.use(
      http.get(`${BASE}/reports/export`, ({ request }) => {
        called.push(new URL(request.url).pathname);
        return HttpResponse.json({ jobId: JOB, status: "PENDING" }, { status: 202 });
      }),
      http.get(`${BASE}/reports/export/${JOB}`, () =>
        HttpResponse.json({ jobId: JOB, status: "READY", downloadUrl: "https://s/e.pdf?sig=a", expiresAt: "2999-01-01T00:00:00Z" }),
      ),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.launch(REQ);
    });
    expect(called).toContain("/reports/export");
    expect(result.current.job?.jobId).toBe(JOB);
  });

  it("REP-003b: PENDING→PROCESSING→READY — poll jusqu'au statut terminal, bouton download actif", async () => {
    const statuses = ["PENDING", "PROCESSING", "READY"];
    let i = 0;
    server.use(
      http.get(`${BASE}/reports/export/${JOB}`, () => {
        const status = statuses[Math.min(i, statuses.length - 1)];
        i += 1;
        return HttpResponse.json(
          status === "READY"
            ? { jobId: JOB, status, downloadUrl: "https://s/e.pdf?sig=a", expiresAt: "2999-01-01T00:00:00Z" }
            : { jobId: JOB, status },
        );
      }),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.launch(REQ);
    });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.job?.status).toBe("READY");
    expect(result.current.downloadable).toBe(true);
    expect(result.current.job?.downloadUrl).toBe("https://s/e.pdf?sig=a");
  });

  it("REP-003b: FAILED → phase failed (jamais un fichier corrompu servi)", async () => {
    server.use(
      http.get(`${BASE}/reports/export/${JOB}`, () =>
        HttpResponse.json({ jobId: JOB, status: "FAILED", error: { code: "GEN", message: "boom" } }),
      ),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.launch(REQ);
    });
    await waitFor(() => expect(result.current.phase).toBe("failed"));
    expect(result.current.downloadable).toBe(false);
  });

  it("REP-003b: READY mais URL expirée → non téléchargeable (relance proposée, pas de lien mort)", async () => {
    server.use(
      http.get(`${BASE}/reports/export/${JOB}`, () =>
        HttpResponse.json({ jobId: JOB, status: "READY", downloadUrl: "https://s/e.pdf?sig=a", expiresAt: "2000-01-01T00:00:00Z" }),
      ),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.launch(REQ);
    });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.downloadable).toBe(false);
  });

  it("REP-003b: échec du déclenchement (500) → phase error", async () => {
    server.use(
      http.get(`${BASE}/reports/export`, () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.launch(REQ);
    });
    expect(result.current.phase).toBe("error");
  });

  it("REP-003b: exception réseau au déclenchement → phase error", async () => {
    server.use(http.get(`${BASE}/reports/export`, () => HttpResponse.error()));
    const { result } = makeHook();
    await act(async () => {
      await result.current.launch(REQ);
    });
    expect(result.current.phase).toBe("error");
  });

  it("REP-003b: poll en erreur → phase error", async () => {
    server.use(
      http.get(`${BASE}/reports/export/${JOB}`, () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.launch(REQ);
    });
    await waitFor(() => expect(result.current.phase).toBe("error"));
  });

  it("REP-003b: reset → retour idle, job effacé", async () => {
    server.use(
      http.get(`${BASE}/reports/export/${JOB}`, () =>
        HttpResponse.json({ jobId: JOB, status: "READY", downloadUrl: "https://s/e.pdf", expiresAt: "2999-01-01T00:00:00Z" }),
      ),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.launch(REQ);
    });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.reset());
    expect(result.current.phase).toBe("idle");
    expect(result.current.job).toBeNull();
  });

  it("REP-003b: scope network omet agencyId (anonymisation amont respectée)", async () => {
    let query = "";
    server.use(
      http.get(`${BASE}/reports/export`, ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json({ jobId: JOB, status: "PENDING" }, { status: 202 });
      }),
      http.get(`${BASE}/reports/export/${JOB}`, () =>
        HttpResponse.json({ jobId: JOB, status: "READY", downloadUrl: "https://s/e.pdf", expiresAt: "2999-01-01T00:00:00Z" }),
      ),
    );
    const { result } = makeHook();
    await act(async () => {
      await result.current.launch({ format: "json", scope: "network", period: "2026-07" });
    });
    expect(query).toContain("scope=network");
    expect(query).not.toContain("agencyId");
  });
});

// Silence expected act warnings from late timer flushes after terminal state.
vi.spyOn(console, "error").mockImplementation(() => undefined);
