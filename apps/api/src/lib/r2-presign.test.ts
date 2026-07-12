/**
 * Tests unitaires — présignature R2 (API-009).
 *
 * Vérifie : config absente → null (→ 503 côté route) ; config complète → URL
 * signée BIEN FORMÉE (SigV4 : Algorithm, Credential, Date, Expires=300,
 * SignedHeaders, Signature) et déterministe pour une horloge fixée.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  getR2Config,
  presignLogoPut,
  PRESIGN_EXPIRES_IN,
} from "src/lib/r2-presign.js";

const STUB_ENV: NodeJS.ProcessEnv = {
  R2_ACCESS_KEY_ID: "AKIAEXAMPLE",
  R2_SECRET_ACCESS_KEY: "secretkeyexample",
  R2_BUCKET: "sigfa-logos",
  R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  R2_REGION: "auto",
};

describe("API-009: R2 presign — configuration", () => {
  it("config incomplète → null (route répond 503)", () => {
    expect(getR2Config({})).toBeNull();
    expect(getR2Config({ R2_ACCESS_KEY_ID: "x" })).toBeNull();
  });

  it("config complète → objet R2Config", () => {
    const cfg = getR2Config(STUB_ENV);
    expect(cfg).not.toBeNull();
    expect(cfg?.bucket).toBe("sigfa-logos");
    expect(cfg?.region).toBe("auto");
  });
});

describe("API-009: R2 presign — URL signée bien formée (stub S3 local)", () => {
  it("presign PUT → URL SigV4 complète, Expires=300", () => {
    const cfg = getR2Config(STUB_ENV);
    if (!cfg) throw new Error("config attendue");
    const url = presignLogoPut({
      config: cfg,
      objectKey: "logos/11111111-1111-4111-a111-111111111111/logo.png",
      now: new Date("2026-07-12T10:00:00.000Z"),
    });
    expect(url).toContain(STUB_ENV.R2_ENDPOINT);
    expect(url).toContain("/sigfa-logos/logos/");
    expect(url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(url).toContain("X-Amz-Credential=AKIAEXAMPLE");
    expect(url).toContain(`X-Amz-Expires=${PRESIGN_EXPIRES_IN}`);
    expect(url).toContain("X-Amz-SignedHeaders=host");
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
  });

  it("signature déterministe pour une horloge fixée", () => {
    const cfg = getR2Config(STUB_ENV);
    if (!cfg) throw new Error("config attendue");
    const at = new Date("2026-07-12T10:00:00.000Z");
    const a = presignLogoPut({ config: cfg, objectKey: "logos/a/logo.png", now: at });
    const b = presignLogoPut({ config: cfg, objectKey: "logos/a/logo.png", now: at });
    expect(a).toBe(b);
  });
});
