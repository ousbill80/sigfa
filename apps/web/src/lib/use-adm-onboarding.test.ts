/**
 * Tests for useAdmOnboarding (ADM-002b) — the NEW clone/provision/onboarding
 * routes via MSW, using the typed @sigfa/contracts admin client.
 *
 * Verifies: POST /banks/{id}/agencies:clone (template XOR source), 422
 * CLONE_SOURCE_REQUIRED surfaced as a human message, POST
 * /agencies/{id}/kiosks:provision returns the enrollment QR (never the raw
 * token to the UI), GET /agencies/{id}/onboarding/{id} for resume, and the
 * offline guard blocking mutations.
 * @module lib/use-adm-onboarding.test
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { createSigfaClient } from "@sigfa/contracts";
import { useAdmOnboarding } from "./use-adm-onboarding";

const BASE = "http://localhost:4010";
const BANK_ID = "11111111-1111-4111-a111-111111111111";
const AGENCY_ID = "66666666-6666-4666-a666-666666666666";
const ONBOARDING_ID = "77777777-7777-4777-a777-777777777777";

function makeHook() {
  const admin = createSigfaClient("admin", BASE);
  return renderHook(() => useAdmOnboarding({ admin, bankId: BANK_ID }));
}

describe("ADM-002b: useAdmOnboarding — clone", () => {
  it("ADM-002b: clone POST /banks/{id}/agencies:clone avec templateId", async () => {
    let seenPath = "";
    let seenBody: unknown = null;
    server.use(
      http.post(`${BASE}/banks/:id/agencies:clone`, async ({ request }) => {
        seenPath = new URL(request.url).pathname;
        seenBody = await request.json();
        return HttpResponse.json(
          { agencyId: AGENCY_ID, onboardingId: ONBOARDING_ID, createdAt: "2026-07-12T10:00:00Z" },
          { status: 201 },
        );
      }),
    );
    const { result } = makeHook();
    let res!: Awaited<ReturnType<typeof result.current.cloneAgency>>;
    await act(async () => {
      res = await result.current.cloneAgency({ name: "Agence Marcory", templateId: "tpl-1" });
    });
    expect(res.ok).toBe(true);
    expect(res.agencyId).toBe(AGENCY_ID);
    expect(res.onboardingId).toBe(ONBOARDING_ID);
    expect(seenPath).toBe(`/banks/${BANK_ID}/agencies:clone`);
    expect(seenBody).toEqual({ name: "Agence Marcory", templateId: "tpl-1" });
  });

  it("ADM-002b: clone 422 CLONE_SOURCE_REQUIRED → message humain, jamais le code brut", async () => {
    server.use(
      http.post(`${BASE}/banks/:id/agencies:clone`, () =>
        HttpResponse.json(
          { error: { code: "CLONE_SOURCE_REQUIRED", message: "source requise" } },
          { status: 422 },
        ),
      ),
    );
    const { result } = makeHook();
    let res!: Awaited<ReturnType<typeof result.current.cloneAgency>>;
    await act(async () => {
      res = await result.current.cloneAgency({ name: "X", templateId: "tpl-1" });
    });
    expect(res.ok).toBe(false);
    expect(res.message).toBeTruthy();
    expect(res.message).not.toContain("CLONE_SOURCE_REQUIRED");
  });

  it("ADM-002b: offline bloque le clone avant tout appel réseau", async () => {
    let called = false;
    server.use(
      http.post(`${BASE}/banks/:id/agencies:clone`, () => {
        called = true;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const { result } = makeHook();
    act(() => result.current.setConnection("offline"));
    let res!: Awaited<ReturnType<typeof result.current.cloneAgency>>;
    await act(async () => {
      res = await result.current.cloneAgency({ name: "X", templateId: "tpl-1" });
    });
    expect(res.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe("ADM-002b: useAdmOnboarding — provision borne", () => {
  it("ADM-002b: provision POST /agencies/{id}/kiosks:provision → enrollment (jamais le token brut)", async () => {
    let seenPath = "";
    server.use(
      http.post(`${BASE}/agencies/:id/kiosks:provision`, ({ request }) => {
        seenPath = new URL(request.url).pathname;
        return HttpResponse.json(
          {
            kioskId: "14141414-1414-4141-a141-141414141414",
            enrollmentToken: "enr_secret_never_shown",
            enrollmentQrUrl: "https://app.sigfa.ci/enroll/14141414-1414-4141-a141-141414141414",
            expiresAt: "2026-07-12T10:30:00Z",
          },
          { status: 201 },
        );
      }),
    );
    const { result } = makeHook();
    let res!: Awaited<ReturnType<typeof result.current.provisionKiosk>>;
    await act(async () => {
      res = await result.current.provisionKiosk(AGENCY_ID);
    });
    expect(res.ok).toBe(true);
    expect(seenPath).toBe(`/agencies/${AGENCY_ID}/kiosks:provision`);
    expect(res.enrollment?.enrollmentQrUrl).toContain("enroll/");
    // The raw enrollment token must NEVER surface to the UI layer.
    expect(JSON.stringify(res.enrollment)).not.toContain("enr_secret_never_shown");
  });

  it("ADM-002b: provision 409 → message humain + jamais d'enrollment", async () => {
    server.use(
      http.post(`${BASE}/agencies/:id/kiosks:provision`, () =>
        HttpResponse.json({ error: { code: "CONFLICT", message: "x" } }, { status: 409 }),
      ),
    );
    const { result } = makeHook();
    let res!: Awaited<ReturnType<typeof result.current.provisionKiosk>>;
    await act(async () => {
      res = await result.current.provisionKiosk(AGENCY_ID);
    });
    expect(res.ok).toBe(false);
    expect(res.enrollment).toBeUndefined();
    expect(res.message).toBeTruthy();
  });
});

describe("ADM-002b: useAdmOnboarding — reprise", () => {
  it("ADM-002b: getOnboarding GET /agencies/{id}/onboarding/{id} pour la reprise", async () => {
    let seenPath = "";
    server.use(
      http.get(`${BASE}/agencies/:id/onboarding/:onboardingId`, ({ request }) => {
        seenPath = new URL(request.url).pathname;
        return HttpResponse.json({
          onboardingId: ONBOARDING_ID,
          agencyId: AGENCY_ID,
          startedAt: "2026-07-12T10:00:00Z",
          completedAt: null,
          steps: [{ key: "clone", status: "DONE", completedAt: "2026-07-12T10:01:00Z" }],
        });
      }),
    );
    const { result } = makeHook();
    let res!: Awaited<ReturnType<typeof result.current.getOnboarding>>;
    await act(async () => {
      res = await result.current.getOnboarding(AGENCY_ID, ONBOARDING_ID);
    });
    expect(res.ok).toBe(true);
    expect(res.status?.onboardingId).toBe(ONBOARDING_ID);
    expect(seenPath).toBe(`/agencies/${AGENCY_ID}/onboarding/${ONBOARDING_ID}`);
  });
});
