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
let bankB: BankFixture;
let adminToken: string;
let adminTokenB: string;

async function req(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  return app.request(`/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** Requête PUBLIQUE (sans JWT). */
async function pub(path: string): Promise<Response> {
  return app.request(`/api/v1${path}`, { method: "GET" });
}

/** Upload multipart d'un logo (champ `file`). */
async function uploadLogo(
  bankId: string,
  token: string,
  bytes: Uint8Array,
  filename: string,
  type: string
): Promise<Response> {
  const form = new FormData();
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  form.append("file", new Blob([ab], { type }), filename);
  return app.request(`/api/v1/banks/${bankId}/theme/logo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

/** PNG minimal valide (IHDR width/height big-endian). */
function makePng(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(buf.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return buf;
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
  bankB = await seedBankAgency(h.db, "theme-bank-b");
  adminToken = await forgeToken(h.jwtSecretBytes, "BANK_ADMIN", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  adminTokenB = await forgeToken(h.jwtSecretBytes, "BANK_ADMIN", bankB.directorId, bankB.bankId, [bankB.agencyId]);
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

  it("API-009: welcomeMessages.dioula/baoule retirés du périmètre → 422 (décision PO 2026-07)", async () => {
    const res = await req("PATCH", `/banks/${bankA.bankId}/theme`, adminToken, {
      welcomeMessages: { fr: "Bienvenue", dioula: "Bienvenida", baoule: "Akwaba" },
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

describe("ADM-001a: theming --brand contraste serveur + garde anti-structure", () => {
  it("ADM-001a: corps PATCH avec token de structure → 422 UNKNOWN_FIELD", async () => {
    const res = await req("PATCH", `/banks/${bankA.bankId}/theme`, adminToken, {
      fontFamily: "Comic Sans",
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNKNOWN_FIELD");
  });

  it("ADM-001a: couleur de structure inconnue dans requestedColors → 422 UNKNOWN_FIELD", async () => {
    const res = await req("PATCH", `/banks/${bankA.bankId}/theme`, adminToken, {
      requestedColors: { primary: "#003f7f", secondary: "#e8a000", background: "#ffffff", accent: "#123456" },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNKNOWN_FIELD");
  });

  it("ADM-001a: --brand non hexadécimal → 422 INVALID_BRAND", async () => {
    const res = await req("PATCH", `/banks/${bankA.bankId}/theme`, adminToken, {
      requestedColors: { primary: "notacolor", secondary: "#e8a000", background: "#ffffff" },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BRAND");
  });

  it("ADM-001a: appliedColors corrigées ≥4.5:1 côté serveur (autoritaire)", async () => {
    const res = await req("PATCH", `/banks/${bankA.bankId}/theme`, adminToken, {
      requestedColors: { primary: "#ffe000", secondary: "#e8a000", background: "#ffffff" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { appliedColors: { primary: string; background: string } };
    expect(contrastRatio(body.appliedColors.primary, body.appliedColors.background)).toBeGreaterThanOrEqual(
      MIN_CONTRAST_RATIO
    );
  });
});

describe("ADM-001a: upload logo MOCK + validation + sanitisation", () => {
  it("ADM-001a: upload PNG valide → 200 { logoUrl } (stockage MOCK)", async () => {
    const res = await uploadLogo(bankA.bankId, adminToken, makePng(256, 256), "logo.png", "image/png");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { logoUrl: string };
    expect(body.logoUrl).toContain(`logos/${bankA.bankId}/logo.png`);
  });

  it("ADM-001a: logo trop petit (100×100) → 422 INVALID_LOGO", async () => {
    const res = await uploadLogo(bankA.bankId, adminToken, makePng(100, 100), "small.png", "image/png");
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_LOGO");
  });

  it("ADM-001a: octets non-image → 422 INVALID_LOGO", async () => {
    const res = await uploadLogo(
      bankA.bankId,
      adminToken,
      new TextEncoder().encode("this is not an image"),
      "fake.png",
      "image/png"
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_LOGO");
  });

  it("ADM-001a: SVG avec <script> uploadé → 200, logoUrl exposé (SVG assaini stocké)", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><script>alert(1)</script><rect/></svg>';
    const res = await uploadLogo(bankA.bankId, adminToken, new TextEncoder().encode(svg), "logo.svg", "image/svg+xml");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { logoUrl: string };
    expect(body.logoUrl).toContain(`logos/${bankA.bankId}/logo.svg`);
  });
});

describe("ADM-001a: projection publique + isolation tenant", () => {
  it("ADM-001a: GET /public/banks/:id/theme expose appliedColors/logo/messages SANS requestedColors (zéro PII)", async () => {
    await req("PATCH", `/banks/${bankA.bankId}/theme`, adminToken, {
      requestedColors: { primary: "#003f7f", secondary: "#e8a000", background: "#ffffff" },
      welcomeMessages: { fr: "Bienvenue publique" },
    });
    const res = await pub(`/public/banks/${bankA.bankId}/theme`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["appliedColors"]).toBeDefined();
    expect(body["welcomeMessages"]).toBeDefined();
    expect(body["requestedColors"]).toBeUndefined();
    expect(contrastRatio(
      (body["appliedColors"] as { primary: string }).primary,
      (body["appliedColors"] as { background: string }).background
    )).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
  });

  it("ADM-001a: PATCH tenant A n'affecte pas le thème du tenant B (isolation)", async () => {
    await req("PATCH", `/banks/${bankA.bankId}/theme`, adminToken, {
      welcomeMessages: { fr: "Message A" },
    });
    await req("PATCH", `/banks/${bankB.bankId}/theme`, adminTokenB, {
      welcomeMessages: { fr: "Message B" },
    });
    const resA = await pub(`/public/banks/${bankA.bankId}/theme`);
    const resB = await pub(`/public/banks/${bankB.bankId}/theme`);
    const bodyA = (await resA.json()) as { welcomeMessages: { fr: string } };
    const bodyB = (await resB.json()) as { welcomeMessages: { fr: string } };
    expect(bodyA.welcomeMessages.fr).toBe("Message A");
    expect(bodyB.welcomeMessages.fr).toBe("Message B");
  });
});
