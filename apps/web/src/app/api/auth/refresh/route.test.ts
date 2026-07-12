// @vitest-environment node
/**
 * Tests for refresh API route — S4 (Boucle 2 F4): la rotation refresh envoie
 * `{refreshToken}` (RefreshRequest du contrat) et lit AuthTokens camelCase.
 * Avant le fix, le body était {refresh_token} et les cookies retombaient à
 * `undefined` contre l'API réelle → rotation toujours en échec.
 * @module app/api/auth/refresh/route.test
 */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { server, MOCK_REFRESHED_TOKENS } from "@/test/msw-server";
import { http, HttpResponse } from "msw";
import { POST } from "./route";

/** Builds a refresh request carrying the refresh_token cookie. */
function refreshRequest(refreshToken?: string): NextRequest {
  const request = new NextRequest("http://localhost:3000/api/auth/refresh", {
    method: "POST",
  });
  if (refreshToken) request.cookies.set("refresh_token", refreshToken);
  return request;
}

describe("S4: POST /api/auth/refresh — RefreshRequest/AuthTokens (camelCase, LA LOI)", () => {
  it("S4: poste {refreshToken} (forme contrat) à l'upstream", async () => {
    let upstreamBody: unknown;
    server.use(
      http.post("http://localhost:4010/auth/refresh", async ({ request }) => {
        upstreamBody = await request.json();
        return HttpResponse.json(MOCK_REFRESHED_TOKENS);
      })
    );
    await POST(refreshRequest("old_refresh"));
    expect(upstreamBody).toEqual({ refreshToken: "old_refresh" });
  });

  it("S4: rotation OK → cookies posés depuis accessToken/refreshToken/expiresIn", async () => {
    const response = await POST(refreshRequest("old_refresh"));
    expect(response.status).toBe(200);
    const access = response.cookies.get("access_token");
    const refresh = response.cookies.get("refresh_token");
    expect(access?.value).toBe(MOCK_REFRESHED_TOKENS.accessToken);
    expect(access?.maxAge).toBe(MOCK_REFRESHED_TOKENS.expiresIn);
    expect(refresh?.value).toBe(MOCK_REFRESHED_TOKENS.refreshToken);
  });

  it("401 sans cookie refresh_token", async () => {
    const response = await POST(refreshRequest());
    expect(response.status).toBe(401);
  });

  it("WEB-001: refresh échoué → 401 + cookies purgés (re-login)", async () => {
    server.use(
      http.post("http://localhost:4010/auth/refresh", () =>
        HttpResponse.json(
          { error: { code: "UNAUTHORIZED", message: "expired" } },
          { status: 401 }
        )
      )
    );
    const response = await POST(refreshRequest("expired_refresh"));
    expect(response.status).toBe(401);
    // Cookies purgés = re-posés vides (maxAge 0)
    expect(response.cookies.get("access_token")?.value).toBe("");
    expect(response.cookies.get("refresh_token")?.value).toBe("");
  });

  it("503 quand l'upstream est injoignable", async () => {
    server.use(
      http.post("http://localhost:4010/auth/refresh", () => HttpResponse.error())
    );
    const response = await POST(refreshRequest("old_refresh"));
    expect(response.status).toBe(503);
  });
});
