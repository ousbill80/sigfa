/**
 * Tests d'intégration — session d'affichage TV publique CONTRACT-013 (public.yaml,
 * Testcontainers PG16 + Redis7).
 *
 * Couvre :
 *   - agencyId valide → 201 { accessToken, expiresIn:43200, agencyId, role:DISPLAY },
 *     JWT claims MINIMAUX (role DISPLAY, agencyIds:[agencyId], bankId dérivé, TTL 12h) ;
 *   - agence inconnue / inactive / supprimée → 404 opaque AGENCY_NOT_FOUND ;
 *   - agencyId non-uuid → 422 (validation Zod stricte) ;
 *   - un token DISPLAY est REFUSÉ (403) sur une route de mutation HTTP (SEC assertion b).
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { decodeJwt } from "jose";
import { randomUUID } from "node:crypto";
import { createApp } from "src/app.js";
import {
  startAdminHarness,
  stopAdminHarness,
  seedBankAgency,
  type AdminHarness,
  type BankFixture,
} from "src/routes/admin-test-harness.js";
import { TV_SESSION_TTL_SECONDS, TV_DISPLAY_ROLE } from "@sigfa/contracts/events/realtime.js";

let h: AdminHarness;
let app: ReturnType<typeof createApp>;
let bankA: BankFixture;

async function req(method: string, path: string, token: string | null, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return app.request(`/api/v1${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** Ouvre une session TV pour l'agence et renvoie l'enveloppe complète. */
async function openTvSession(agencyId: string): Promise<Response> {
  return req("POST", "/tv/session", null, { agencyId });
}

beforeAll(async () => {
  h = await startAdminHarness();
  app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes });
  bankA = await seedBankAgency(h.db, "tv-bank-a");
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("CONTRACT-013: session TV publique — agencyId → JWT DISPLAY lecture seule TTL 12h", () => {
  it("CONTRACT-013: agencyId valide → 201 { accessToken, expiresIn:43200, agencyId, role:DISPLAY }", async () => {
    const res = await openTvSession(bankA.agencyId);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      accessToken: string;
      expiresIn: number;
      agencyId: string;
      role: string;
    };
    expect(body.expiresIn).toBe(TV_SESSION_TTL_SECONDS);
    expect(body.expiresIn).toBe(43200);
    expect(body.agencyId).toBe(bankA.agencyId);
    expect(body.role).toBe(TV_DISPLAY_ROLE);
    expect(body.role).toBe("DISPLAY");
    expect(typeof body.accessToken).toBe("string");
  });

  it("CONTRACT-013: JWT DISPLAY — claims MINIMAUX (role DISPLAY, agencyIds:[agencyId], bankId dérivé, TTL 43200, sub tv:{agencyId})", async () => {
    const res = await openTvSession(bankA.agencyId);
    const body = (await res.json()) as { accessToken: string };
    const claims = decodeJwt(body.accessToken);
    expect(claims["role"]).toBe("DISPLAY");
    expect(claims["agencyIds"]).toEqual([bankA.agencyId]);
    // bankId dérivé de l'agence (jamais fourni par le client), pour le scope socket.
    expect(claims["bankId"]).toBe(bankA.bankId);
    // sub = identifiant d'affichage stable.
    expect(claims.sub).toBe(`tv:${bankA.agencyId}`);
    // TTL = 12h non renouvelable.
    const ttl = (claims.exp ?? 0) - (claims.iat ?? 0);
    expect(ttl).toBe(TV_SESSION_TTL_SECONDS);
    // Aucun claim de session/refresh (non renouvelable, minimal).
    expect(claims["sessionId"]).toBeUndefined();
    expect(claims["kioskId"]).toBeUndefined();
  });

  it("CONTRACT-013: agence INCONNUE → 404 opaque AGENCY_NOT_FOUND (anti-énumération)", async () => {
    const res = await openTvSession(randomUUID());
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AGENCY_NOT_FOUND");
  });

  it("CONTRACT-013: agence INACTIVE → 404 opaque AGENCY_NOT_FOUND (même corps, aucun oracle)", async () => {
    const bankB = await seedBankAgency(h.db, "tv-bank-inactive");
    await h.db.query(`UPDATE agencies SET is_active = false WHERE id = $1`, [bankB.agencyId]);
    const res = await openTvSession(bankB.agencyId);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AGENCY_NOT_FOUND");
  });

  it("CONTRACT-013: agence SUPPRIMÉE (deleted_at) → 404 opaque AGENCY_NOT_FOUND", async () => {
    const bankB = await seedBankAgency(h.db, "tv-bank-deleted");
    await h.db.query(`UPDATE agencies SET deleted_at = NOW() WHERE id = $1`, [bankB.agencyId]);
    const res = await openTvSession(bankB.agencyId);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AGENCY_NOT_FOUND");
  });

  it("CONTRACT-013: agencyId non-uuid → 422 (validation Zod stricte)", async () => {
    const res = await req("POST", "/tv/session", null, { agencyId: "not-a-uuid" });
    expect(res.status).toBe(422);
  });

  it("CONTRACT-013: champ hors schéma (additionalProperties) → 422", async () => {
    const res = await req("POST", "/tv/session", null, { agencyId: bankA.agencyId, secret: "x" });
    expect(res.status).toBe(422);
  });

  // ── SEC assertion (b) : un token DISPLAY est REFUSÉ sur toute route de mutation HTTP ──
  it("SEC-CONTRACT-013: token DISPLAY → 403 sur une route de mutation HTTP (POST /tickets)", async () => {
    const session = (await (await openTvSession(bankA.agencyId)).json()) as { accessToken: string };
    const res = await req("POST", "/tickets", session.accessToken, {
      serviceId: randomUUID(),
      agencyId: bankA.agencyId,
    });
    // RBAC refuse DISPLAY sur toute route HTTP protégée (rôle orthogonal socket-only).
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("SEC-CONTRACT-013: token DISPLAY → 403 sur une lecture HTTP protégée (GET /counters)", async () => {
    const session = (await (await openTvSession(bankA.agencyId)).json()) as { accessToken: string };
    const res = await req("GET", `/counters?agencyId=${bankA.agencyId}`, session.accessToken);
    // DISPLAY n'autorise AUCUNE route HTTP, même en lecture (confiné au socket).
    expect(res.status).toBe(403);
  });
});
