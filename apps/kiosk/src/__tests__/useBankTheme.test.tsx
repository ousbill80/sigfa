/**
 * KIOSK-HOME (retour visuel PO) — Tests TDD pour hooks/useBankTheme.ts
 * Chargement de la projection publique du theme tenant :
 * GET /public/banks/{id}/theme (CONTRACT-013, route publique, zero PII).
 * Ecrits AVANT l'implementation (phase rouge).
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { useBankTheme } from "@/hooks/useBankTheme";
import {
  registerKioskSessionProvisioner,
  ensureKioskSession,
  __resetKioskSessionForTests,
} from "@/lib/kiosk-session-store";
import type { KioskSession } from "@/lib/kiosk-session";

const BANK_ID = "11111111-1111-4111-a111-111111111111";
const SESSION_BANK_ID = "22222222-2222-4222-a222-222222222222";

function makeSession(): KioskSession {
  return {
    accessToken: "jwt-theme",
    expiresIn: 43200,
    kioskId: "k1",
    agencyId: "a1",
    bankId: SESSION_BANK_ID,
    createdAt: Date.now(),
  };
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  __resetKioskSessionForTests();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

describe("KIOSK-HOME: useBankTheme", () => {
  it("charge logoUrl + couleur primaire depuis GET /public/banks/{id}/theme", async () => {
    const { result } = renderHook(() => useBankTheme(BANK_ID));

    await waitFor(() => {
      expect(result.current.logoUrl).toBe("/mock/bank/logo.svg");
    });
    expect(result.current.brandColor).toBe("#003f7f");
  });

  it("sans identifiant de banque : aucun fetch, etat de repli (logo null)", () => {
    // onUnhandledRequest: "error" — toute requete emise ferait echouer le test.
    const { result } = renderHook(() => useBankTheme(null));
    expect(result.current.logoUrl).toBeNull();
    expect(result.current.brandColor).toBeNull();
  });

  it("erreur serveur (500) : repli silencieux, jamais d'ecran casse", async () => {
    server.use(
      http.get("*/public/banks/:id/theme", () =>
        HttpResponse.json(
          { code: "INTERNAL_ERROR", message: "boom" },
          { status: 500 }
        )
      )
    );
    const { result } = renderHook(() => useBankTheme(BANK_ID));

    // L'etat reste au repli sans throw ni rejet non gere.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.logoUrl).toBeNull();
    expect(result.current.brandColor).toBeNull();
  });

  it("logoUrl null dans la reponse (banque sans logo) : brandColor conserve", async () => {
    server.use(
      http.get("*/public/banks/:id/theme", () =>
        HttpResponse.json(
          {
            logoUrl: null,
            appliedColors: {
              primary: "#0f6b4a",
              secondary: "#8ea7ec",
              background: "#ffffff",
            },
            welcomeMessages: { fr: "Bienvenue" },
          },
          { status: 200 }
        )
      )
    );
    const { result } = renderHook(() => useBankTheme(BANK_ID));

    await waitFor(() => {
      expect(result.current.brandColor).toBe("#0f6b4a");
    });
    expect(result.current.logoUrl).toBeNull();
  });
});

// ── CONTRACT-014 : bankId de la SESSION borne prioritaire sur l'env ──────────
describe("CONTRACT-014: useBankTheme — bankId depuis la session borne", () => {
  it("session présente → le thème est chargé avec le bankId de session (l'env est ignoré)", async () => {
    vi.stubEnv("NEXT_PUBLIC_BANK_ID", BANK_ID);
    registerKioskSessionProvisioner(async () => makeSession());
    await ensureKioskSession();

    let requestedId: string | undefined;
    server.use(
      http.get("*/public/banks/:id/theme", ({ params }) => {
        requestedId = String(params.id);
        return HttpResponse.json(
          {
            logoUrl: "/mock/bank/logo.svg",
            appliedColors: { primary: "#003f7f", secondary: "#8ea7ec", background: "#ffffff" },
            welcomeMessages: { fr: "Bienvenue" },
          },
          { status: 200 }
        );
      })
    );

    const { result } = renderHook(() => useBankTheme());
    await waitFor(() => {
      expect(result.current.logoUrl).toBe("/mock/bank/logo.svg");
    });
    expect(requestedId).toBe(SESSION_BANK_ID);
  });

  it("session créée APRÈS le montage → le thème se recharge avec le bankId de session (réactif)", async () => {
    let requestedId: string | undefined;
    server.use(
      http.get("*/public/banks/:id/theme", ({ params }) => {
        requestedId = String(params.id);
        return HttpResponse.json(
          {
            logoUrl: "/mock/bank/logo.svg",
            appliedColors: { primary: "#003f7f", secondary: "#8ea7ec", background: "#ffffff" },
            welcomeMessages: { fr: "Bienvenue" },
          },
          { status: 200 }
        );
      })
    );

    // Montage AVANT session (ni env, ni session → aucun fetch).
    const { result } = renderHook(() => useBankTheme());
    expect(result.current.logoUrl).toBeNull();

    // La session borne arrive (provisionnement Electron asynchrone).
    registerKioskSessionProvisioner(async () => makeSession());
    await act(async () => {
      await ensureKioskSession();
    });

    await waitFor(() => {
      expect(result.current.logoUrl).toBe("/mock/bank/logo.svg");
    });
    expect(requestedId).toBe(SESSION_BANK_ID);
  });

  it("sans session → repli env NEXT_PUBLIC_BANK_ID (DEV/démo documenté)", async () => {
    vi.stubEnv("NEXT_PUBLIC_BANK_ID", BANK_ID);

    let requestedId: string | undefined;
    server.use(
      http.get("*/public/banks/:id/theme", ({ params }) => {
        requestedId = String(params.id);
        return HttpResponse.json(
          {
            logoUrl: "/mock/bank/logo.svg",
            appliedColors: { primary: "#003f7f", secondary: "#8ea7ec", background: "#ffffff" },
            welcomeMessages: { fr: "Bienvenue" },
          },
          { status: 200 }
        );
      })
    );

    const { result } = renderHook(() => useBankTheme());
    await waitFor(() => {
      expect(result.current.logoUrl).toBe("/mock/bank/logo.svg");
    });
    expect(requestedId).toBe(BANK_ID);
  });

  it("ni session ni env → aucun fetch, repli monogramme", () => {
    // onUnhandledRequest: "error" — toute requête émise ferait échouer le test.
    const { result } = renderHook(() => useBankTheme());
    expect(result.current.logoUrl).toBeNull();
    expect(result.current.brandColor).toBeNull();
  });
});
