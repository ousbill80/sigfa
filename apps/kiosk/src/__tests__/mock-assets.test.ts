/**
 * AUDIT-F22 — Les assets locaux référencés par les mocks MSW existent.
 * Les photos conseillers `/mock/rm/*.svg` étaient référencées par le handler
 * relationship-managers mais ABSENTES de `public/` : le repli initiales
 * masquait la fonctionnalité photo, jamais validée visuellement.
 * Ce test lie le contrat de démo (handlers.ts) aux fichiers servis (public/).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { server } from "@/mocks/server";

const HANDLERS_PATH = resolve(__dirname, "../mocks/handlers.ts");
const PUBLIC_DIR = resolve(__dirname, "../../public");

describe("AUDIT-F22: assets démo référencés par les mocks", () => {
  it("chaque photoUrl/logoUrl LOCALE des handlers correspond à un fichier de public/", () => {
    const source = readFileSync(HANDLERS_PATH, "utf-8");
    const urls = [
      ...source.matchAll(/(?:photoUrl|logoUrl):\s*"(\/[^"]+)"/g),
    ].map((m) => m[1]);

    // Le chemin photo des conseillers doit être exercé par la démo (≥ 2 photos).
    const rmPhotos = urls.filter((u) => u.startsWith("/mock/rm/"));
    expect(rmPhotos.length).toBeGreaterThanOrEqual(2);

    for (const url of urls) {
      expect(
        existsSync(resolve(PUBLIC_DIR, `.${url}`)),
        `Asset démo manquant dans public/ : ${url}`
      ).toBe(true);
    }
  });

  it("les avatars démo sont des SVG neutres sans pictogramme emoji", () => {
    const source = readFileSync(HANDLERS_PATH, "utf-8");
    const rmPhotos = [
      ...source.matchAll(/photoUrl:\s*"(\/mock\/rm\/[^"]+)"/g),
    ].map((m) => m[1]);

    for (const url of rmPhotos) {
      const svg = readFileSync(resolve(PUBLIC_DIR, `.${url}`), "utf-8");
      expect(svg).toContain("<svg");
      expect(/\p{Extended_Pictographic}/u.test(svg), `emoji dans ${url}`).toBe(
        false
      );
    }
  });
});

describe("AUDIT-F21: fixture démo feedback (GET /public/tickets/{trackingId})", () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: "bypass" });
  });
  afterAll(() => {
    server.close();
  });

  it("le ticket démo est DONE et clos < 24 h → l'écran feedback est éligible en démo", async () => {
    const res = await fetch("http://localhost:4010/public/tickets/TRK-00001");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      trackingId: string;
      status: string;
      closedAt: string;
    };
    expect(body.trackingId).toBe("TRK-00001");
    expect(body.status).toBe("DONE");
    const ageMs = Date.now() - Date.parse(body.closedAt);
    expect(ageMs).toBeGreaterThan(0);
    expect(ageMs).toBeLessThan(24 * 3600_000);
  });

  it("le POST feedback démo répond 201 → écran merci (compte à rebours) vérifiable", async () => {
    const res = await fetch(
      "http://localhost:4010/public/tickets/TRK-00001/feedback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: 5 }),
      }
    );
    expect(res.status).toBe(201);
  });
});
