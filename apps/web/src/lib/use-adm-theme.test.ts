/**
 * Tests for useAdmTheme (ADM-001b) — canonical contract theme routes via MSW.
 *
 * Verifies: GET load → ready/empty/error, PATCH persists requestedColors +
 * welcomeMessages and CARRIES X-Idempotency-Key (UUID v4), offline blocks
 * mutations, logo upload posts multipart and 422 INVALID_LOGO surfaces inline
 * while keeping the old logo, and the five states are reachable.
 * @module lib/use-adm-theme.test
 */
import { describe, it, expect } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { createSigfaClient } from "@sigfa/contracts";
import { useAdmTheme } from "./use-adm-theme";

const BASE = "http://localhost:4010";
const BANK_ID = "11111111-1111-4111-a111-111111111111";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function themeBody(brand = "#003f7f") {
  return {
    requestedColors: { primary: brand, secondary: "#9c400c", background: "#ffffff" },
    appliedColors: { primary: brand, secondary: "#9c400c", background: "#ffffff" },
    welcomeMessages: { fr: "Bienvenue" },
    logoUrl: null,
  };
}

function makeHook() {
  const admin = createSigfaClient("admin", BASE);
  return renderHook(() => useAdmTheme({ admin, bankId: BANK_ID }));
}

describe("useAdmTheme — chargement (GET) et 5 états", () => {
  it("ADM-001b: GET succès → status ready + theme chargé (brand + messages)", async () => {
    server.use(http.get(`${BASE}/banks/:id/theme`, () => HttpResponse.json(themeBody())));
    const { result } = makeHook();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.theme?.brand).toBe("#003f7f");
    expect(result.current.theme?.welcomeMessages.fr).toBe("Bienvenue");
    expect(result.current.theme?.logoUrl).toBeNull();
  });

  it("ADM-001b: GET erreur serveur → status error", async () => {
    server.use(http.get(`${BASE}/banks/:id/theme`, () => HttpResponse.json({ error: { code: "X" } }, { status: 500 })));
    const { result } = makeHook();
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("ADM-001b: GET body sans brand/message → status empty", async () => {
    server.use(http.get(`${BASE}/banks/:id/theme`, () => HttpResponse.json({ welcomeMessages: {} })));
    const { result } = makeHook();
    await waitFor(() => expect(result.current.status).toBe("empty"));
  });

  it("ADM-001b: setOffline(true) → status offline, reload ne fetch pas", async () => {
    server.use(http.get(`${BASE}/banks/:id/theme`, () => HttpResponse.json(themeBody())));
    const { result } = makeHook();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.setOffline(true));
    expect(result.current.status).toBe("offline");
  });
});

describe("useAdmTheme — PATCH avec X-Idempotency-Key", () => {
  it("ADM-001b: saveTheme → PATCH requestedColors + welcomeMessages, header X-Idempotency-Key UUID v4", async () => {
    let seenKey: string | null = null;
    let seenBody: unknown = null;
    server.use(
      http.get(`${BASE}/banks/:id/theme`, () => HttpResponse.json(themeBody())),
      http.patch(`${BASE}/banks/:id/theme`, async ({ request }) => {
        seenKey = request.headers.get("x-idempotency-key");
        seenBody = await request.json();
        return HttpResponse.json(themeBody("#123456"));
      }),
    );
    const { result } = makeHook();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    let out!: { ok: boolean };
    await act(async () => {
      out = await result.current.saveTheme({ brand: "#123456", welcomeMessages: { fr: "Salut" } });
    });
    expect(out.ok).toBe(true);
    expect(seenKey).toMatch(UUID_V4);
    expect(seenBody).toEqual(
      expect.objectContaining({
        requestedColors: expect.objectContaining({ primary: expect.stringMatching(/^#[0-9a-f]{6}$/i) }),
        welcomeMessages: { fr: "Salut" },
      }),
    );
    // La valeur persistée (potentiellement corrigée) est affichée sans rechargement.
    expect(result.current.theme?.brand).toBe("#123456");
  });

  it("ADM-001b: PATCH 422 INVALID_BRAND → message humain namespacé, ok:false", async () => {
    server.use(
      http.get(`${BASE}/banks/:id/theme`, () => HttpResponse.json(themeBody())),
      http.patch(`${BASE}/banks/:id/theme`, () =>
        HttpResponse.json({ error: { code: "INVALID_BRAND" } }, { status: 422 }),
      ),
    );
    const { result } = makeHook();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    let out!: { ok: boolean; message?: string };
    await act(async () => {
      out = await result.current.saveTheme({ brand: "#003f7f", welcomeMessages: { fr: "x" } });
    });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/hexadécimal|Invalid/i);
    expect(out.message).not.toMatch(/INVALID_BRAND/);
  });

  it("ADM-001b: offline → saveTheme bloqué sans requête réseau", async () => {
    let called = false;
    server.use(
      http.get(`${BASE}/banks/:id/theme`, () => HttpResponse.json(themeBody())),
      http.patch(`${BASE}/banks/:id/theme`, () => {
        called = true;
        return HttpResponse.json(themeBody());
      }),
    );
    const { result } = makeHook();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.setOffline(true));
    let out!: { ok: boolean };
    await act(async () => {
      out = await result.current.saveTheme({ brand: "#003f7f", welcomeMessages: { fr: "x" } });
    });
    expect(out.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe("useAdmTheme — upload logo", () => {
  it("ADM-001b: uploadLogo succès → POST multipart (Content-Type non-JSON), logoUrl mis à jour", async () => {
    let contentType: string | null = null;
    let path: string | null = null;
    server.use(
      http.get(`${BASE}/banks/:id/theme`, () => HttpResponse.json(themeBody())),
      http.post(`${BASE}/banks/:id/theme/logo`, ({ request }) => {
        contentType = request.headers.get("content-type");
        path = new URL(request.url).pathname;
        return HttpResponse.json({ logoUrl: "https://cdn/x/logo.png" });
      }),
    );
    const { result } = makeHook();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    let out!: { ok: boolean };
    await act(async () => {
      out = await result.current.uploadLogo(new File(["x"], "logo.png", { type: "image/png" }));
    });
    expect(out.ok).toBe(true);
    // Route canonique + corps multipart (jamais application/json — sinon le
    // serveur réel ne parserait pas le fichier).
    expect(path).toBe(`/banks/${BANK_ID}/theme/logo`);
    expect(contentType).not.toMatch(/application\/json/);
    expect(contentType).toMatch(/multipart\/form-data/);
    expect(result.current.theme?.logoUrl).toBe("https://cdn/x/logo.png");
  });

  it("ADM-001b: uploadLogo 422 INVALID_LOGO → message inline, ancien logo conservé", async () => {
    server.use(
      http.get(`${BASE}/banks/:id/theme`, () => HttpResponse.json({ ...themeBody(), logoUrl: "https://cdn/old.png" })),
      http.post(`${BASE}/banks/:id/theme/logo`, () =>
        HttpResponse.json({ error: { code: "INVALID_LOGO" } }, { status: 422 }),
      ),
    );
    const { result } = makeHook();
    await waitFor(() => expect(result.current.theme?.logoUrl).toBe("https://cdn/old.png"));
    let out!: { ok: boolean; message?: string };
    await act(async () => {
      out = await result.current.uploadLogo(new File(["x"], "bad.gif", { type: "image/gif" }));
    });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/logo/i);
    // L'ancien logo reste actif.
    expect(result.current.theme?.logoUrl).toBe("https://cdn/old.png");
  });
});
