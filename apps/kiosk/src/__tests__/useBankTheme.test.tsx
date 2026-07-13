/**
 * KIOSK-HOME (retour visuel PO) — Tests TDD pour hooks/useBankTheme.ts
 * Chargement de la projection publique du theme tenant :
 * GET /public/banks/{id}/theme (CONTRACT-013, route publique, zero PII).
 * Ecrits AVANT l'implementation (phase rouge).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { useBankTheme } from "@/hooks/useBankTheme";

const BANK_ID = "11111111-1111-4111-a111-111111111111";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
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
              secondary: "#c79a3a",
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
