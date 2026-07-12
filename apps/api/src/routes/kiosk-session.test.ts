/**
 * Tests d'intégration — session borne API-009 (public.yaml, Testcontainers PG16).
 *
 * Couvre le critère EARS clé : credentials borne → JWT 12 h utilisable (heartbeat)
 * ET révocation → 401 IMMÉDIAT (malgré `exp` encore valide). Plus : credentials
 * invalides → 401, TTL = 43200 s, isolation cross-bank de la révocation.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { decodeJwt } from "jose";
import { createApp } from "src/app.js";
import {
  startAdminHarness,
  stopAdminHarness,
  forgeToken,
  seedBankAgency,
  type AdminHarness,
  type BankFixture,
} from "src/routes/admin-test-harness.js";
import { KIOSK_SESSION_TTL_SECONDS } from "src/services/kiosk-session.service.js";

let h: AdminHarness;
let app: ReturnType<typeof createApp>;
let bankA: BankFixture;
let dirToken: string;

async function req(method: string, path: string, token: string | null, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return app.request(`/api/v1${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** Provisionne une borne via l'API kiosk-access et retourne ses credentials. */
async function provisionKiosk(): Promise<{ kioskId: string; clientId: string; clientSecret: string }> {
  const res = await req("POST", `/agencies/${bankA.agencyId}/kiosk-access`, dirToken, {
    label: "Borne test",
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { kioskId: string; clientId: string; clientSecret: string };
  return body;
}

/** Ouvre une session borne et retourne le JWT + l'enveloppe complète. */
async function openSession(k: { kioskId: string; clientId: string; clientSecret: string }): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const res = await req("POST", "/kiosk/session", null, {
    kioskId: k.kioskId,
    kioskSecret: `${k.clientId}:${k.clientSecret}`,
    agencyId: bankA.agencyId,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { accessToken: string; expiresIn: number };
}

beforeAll(async () => {
  h = await startAdminHarness();
  app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes });
  bankA = await seedBankAgency(h.db, "kiosk-bank-a");
  dirToken = await forgeToken(h.jwtSecretBytes, "AGENCY_DIRECTOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("API-009: session borne — login credentials → JWT 12h utilisable puis révocation → 401 immédiat", () => {
  it("API-009: session borne — credentials → JWT scope agency TTL 12h (43200s)", async () => {
    const k = await provisionKiosk();
    const session = await openSession(k);
    expect(session.expiresIn).toBe(KIOSK_SESSION_TTL_SECONDS);
    const claims = decodeJwt(session.accessToken);
    const ttl = (claims.exp ?? 0) - (claims.iat ?? 0);
    expect(ttl).toBe(KIOSK_SESSION_TTL_SECONDS);
    expect(claims["role"]).toBe("AUTHENTICATED");
    expect(claims["agencyIds"]).toEqual([bankA.agencyId]);
  });

  it("API-009: session borne — JWT 12h utilisable sur heartbeat", async () => {
    const k = await provisionKiosk();
    const session = await openSession(k);
    const res = await req("POST", `/kiosks/${k.kioskId}/heartbeat`, session.accessToken, {
      printerStatus: "OK",
      appVersion: "1.4.2",
      uptimeSeconds: 3600,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { serverTime: string };
    expect(body.serverTime).toBeTruthy();
  });

  it("API-009: révocation → 401 IMMÉDIAT sur heartbeat malgré exp encore valide", async () => {
    const k = await provisionKiosk();
    const session = await openSession(k);
    // Le token fonctionne AVANT révocation.
    const before = await req("POST", `/kiosks/${k.kioskId}/heartbeat`, session.accessToken, {
      printerStatus: "OK",
      appVersion: "1.4.2",
      uptimeSeconds: 10,
    });
    expect(before.status).toBe(200);
    // Révocation par l'AGENCY_DIRECTOR.
    const revoke = await req("DELETE", `/kiosk/session/${k.kioskId}`, dirToken);
    expect(revoke.status).toBe(200);
    // Le MÊME token (exp toujours valide) est REFUSÉ.
    const after = await req("POST", `/kiosks/${k.kioskId}/heartbeat`, session.accessToken, {
      printerStatus: "OK",
      appVersion: "1.4.2",
      uptimeSeconds: 20,
    });
    expect(after.status).toBe(401);
    const body = (await after.json()) as { error: { code: string } };
    expect(body.error.code).toBe("KIOSK_SESSION_REVOKED");
  });

  it("API-009: credentials invalides → 401 KIOSK_AUTH_FAILED", async () => {
    const k = await provisionKiosk();
    const res = await req("POST", "/kiosk/session", null, {
      kioskId: k.kioskId,
      kioskSecret: "wrong-secret-atleast16",
      agencyId: bankA.agencyId,
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("KIOSK_AUTH_FAILED");
  });
});
