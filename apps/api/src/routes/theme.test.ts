/**
 * Tests d'intégration — theming banque API-009 (admin.yaml, Testcontainers PG16).
 *
 * Couvre : PATCH couleur faible contraste → appliedColors corrigé MESURÉ ≥4.5:1 ;
 * champ hors schéma → 422 ; presign R2 formé (config stub) ; sans config R2 → 503 ;
 * contentType invalide → 422.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "src/app.js";
import { contrastRatio, MIN_CONTRAST_RATIO } from "src/lib/wcag-contrast.js";
import {
  startAdminHarness,
  stopAdminHarness,
  forgeToken,
  seedBankAgency,
  type AdminHarness,
  type BankFixture,
} from "src/routes/admin-test-harness.js";

let h: AdminHarness;
let app: ReturnType<typeof createApp>;
let bankA: BankFixture;
let adminToken: string;

async function req(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  return app.request(`/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const R2_KEYS = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT"] as const;

function setR2Env(): void {
  process.env["R2_ACCESS_KEY_ID"] = "AKIAEXAMPLE";
  process.env["R2_SECRET_ACCESS_KEY"] = "secretkeyexample";
  process.env["R2_BUCKET"] = "sigfa-logos";
  process.env["R2_ENDPOINT"] = "https://acct.r2.cloudflarestorage.com";
}

function clearR2Env(): void {
  for (const k of R2_KEYS) delete process.env[k];
}

beforeAll(async () => {
  h = await startAdminHarness();
  app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes });
  bankA = await seedBankAgency(h.db, "theme-bank-a");
  adminToken = await forgeToken(h.jwtSecretBytes, "BANK_ADMIN", bankA.directorId, bankA.bankId, [bankA.agencyId]);
}, 180_000);

afterAll(async () => {
  clearR2Env();
  await stopAdminHarness(h);
}, 30_000);

describe("API-009: theming — appliedColors corrigé ≥4.5:1 + presign R2", () => {
  it("API-009: couleur faible contraste → appliedColors corrigé ≥4.5:1 mesuré", async () => {
    const res = await req("PATCH", `/banks/${bankA.bankId}/theme`, adminToken, {
      requestedColors: { primary: "#003f7f", secondary: "#e8a000", background: "#ffffff" },
      welcomeMessages: { fr: "Bienvenue" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      requestedColors: { secondary: string; background: string };
      appliedColors: { primary: string; secondary: string; background: string };
    };
    // Le jaune faible contraste est corrigé, mesuré ≥4.5:1 contre le fond.
    expect(body.appliedColors.secondary).not.toBe(body.requestedColors.secondary.toLowerCase());
    expect(contrastRatio(body.appliedColors.secondary, body.appliedColors.background)).toBeGreaterThanOrEqual(
      MIN_CONTRAST_RATIO
    );
    // Le primaire déjà conforme est préservé.
    expect(contrastRatio(body.appliedColors.primary, body.appliedColors.background)).toBeGreaterThanOrEqual(
      MIN_CONTRAST_RATIO
    );
  });

  it("API-009: GET theme retourne appliedColors dérivées", async () => {
    const res = await req("GET", `/banks/${bankA.bankId}/theme`, adminToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { appliedColors: { background: string } };
    expect(body.appliedColors.background).toBe("#ffffff");
  });

  it("API-009: champ hors schéma → 422", async () => {
    const res = await req("PATCH", `/banks/${bankA.bankId}/theme`, adminToken, {
      fontFamily: "Comic Sans",
    });
    expect(res.status).toBe(422);
  });

  it("API-009: presign R2 formé quand configuré (stub S3 local)", async () => {
    setR2Env();
    const res = await req("GET", `/banks/${bankA.bankId}/theme/logo-upload-url?contentType=image/png`, adminToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { presignedUrl: string; expiresIn: number; maxSizeBytes: number };
    expect(body.expiresIn).toBe(300);
    expect(body.maxSizeBytes).toBe(2_000_000);
    expect(body.presignedUrl).toContain("X-Amz-Signature=");
    clearR2Env();
  });

  it("API-009: sans config R2 → 503 R2_NOT_CONFIGURED (jamais de crash)", async () => {
    clearR2Env();
    const res = await req("GET", `/banks/${bankA.bankId}/theme/logo-upload-url?contentType=image/png`, adminToken);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("R2_NOT_CONFIGURED");
  });

  it("API-009: contentType non accepté → 422 UNSUPPORTED_MEDIA_TYPE", async () => {
    setR2Env();
    const res = await req("GET", `/banks/${bankA.bankId}/theme/logo-upload-url?contentType=image/gif`, adminToken);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    clearR2Env();
  });
});
