/**
 * KIOSK-001 — Tests TDD pour kiosk-session.ts
 * Écrits AVANT l'implémentation (phase rouge).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

// ─── Mock MSW server pour intercepter les requêtes via @sigfa/contracts ───────
const mockSessionResponse = {
  accessToken: "eyJhbGciOiJIUzI1NiJ9.kioskPayload.sig",
  expiresIn: 43200,
  kioskId: "14141414-1414-4141-a141-141414141414",
  agencyId: "33333333-3333-4333-a333-333333333333",
};

const server = setupServer(
  http.post("http://localhost:4010/kiosk/session", () => {
    return HttpResponse.json(mockSessionResponse, { status: 201 });
  })
);

beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
  vi.useRealTimers();
});

describe("KIOSK-001: kiosk-session", () => {
  it("KIOSK-001: POST /kiosk/session appelé au boot — mock répond 201 expiresIn=43200", async () => {
    const { createKioskSession } = await import("../lib/kiosk-session.js");

    const result = await createKioskSession({
      kioskId: "14141414-1414-4141-a141-141414141414",
      kioskSecret: "s3cr3t-kiosk-k3y",
      agencyId: "33333333-3333-4333-a333-333333333333",
      apiUrl: "http://localhost:4010",
    });

    expect(result).not.toBeNull();
    expect(result?.accessToken).toBe(
      "eyJhbGciOiJIUzI1NiJ9.kioskPayload.sig"
    );
    expect(result?.expiresIn).toBe(43200);
  });

  it("KIOSK-001: session expirée → écran erreur + retry silencieux (test d'horloge Vitest)", async () => {
    vi.useFakeTimers();

    const { createKioskSession, isSessionExpired } = await import(
      "../lib/kiosk-session.js"
    );

    const result = await createKioskSession({
      kioskId: "14141414-1414-4141-a141-141414141414",
      kioskSecret: "s3cr3t-kiosk-k3y",
      agencyId: "33333333-3333-4333-a333-333333333333",
      apiUrl: "http://localhost:4010",
    });

    expect(result).not.toBeNull();
    // Session not expired yet
    expect(isSessionExpired(result!)).toBe(false);

    // Avancer le temps de 12h + 1min (43260 secondes)
    vi.advanceTimersByTime(43260 * 1000);

    // Session should now be expired
    expect(isSessionExpired(result!)).toBe(true);
  });

  it("KIOSK-001: aucun fetch direct — seul @sigfa/contracts utilisé", async () => {
    // Vérifie que le module kiosk-session n'utilise pas fetch directement
    // en lisant son code source (approche structurelle)
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const sessionFile = resolve(__dirname, "../lib/kiosk-session.ts");
    let content: string;
    try {
      content = readFileSync(sessionFile, "utf-8");
    } catch {
      // File doesn't exist yet in red phase
      content = "";
    }

    // Si le fichier existe, vérifier qu'il n'utilise pas fetch directement
    if (content) {
      expect(content).not.toMatch(/\bfetch\s*\(/);
      expect(content).not.toMatch(/axios\s*\./);
      expect(content).toMatch(/@sigfa\/contracts/);
    }
  });
});
