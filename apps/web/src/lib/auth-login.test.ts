// @vitest-environment node
/**
 * Tests for auth-login — mécanisme UNIQUE de login contre l'API de contrat
 * (client typé @sigfa/contracts) + pose des cookies httpOnly, partagé par
 * /api/auth/login et /api/auth/demo-login.
 * @module lib/auth-login.test
 */
import { describe, it, expect } from "vitest";
import { server, MOCK_AUTH_TOKENS } from "@/test/msw-server";
import { http, HttpResponse } from "msw";
import { loginAndSetCookies } from "./auth-login";

describe("loginAndSetCookies — login de contrat + cookies httpOnly", () => {
  it("succès → 200 {ok:true} et cookies posés depuis AuthTokens (camelCase)", async () => {
    const response = await loginAndSetCookies("a@b.ci", "longpass8");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const access = response.cookies.get("access_token");
    expect(access?.value).toBe(MOCK_AUTH_TOKENS.accessToken);
    expect(access?.httpOnly).toBe(true);
    expect(access?.maxAge).toBe(MOCK_AUTH_TOKENS.expiresIn);
    expect(response.cookies.get("refresh_token")?.value).toBe(MOCK_AUTH_TOKENS.refreshToken);
  });

  it("envoie {email, password} (LoginRequest) à l'upstream de contrat", async () => {
    let upstreamBody: unknown;
    server.use(
      http.post("http://localhost:4010/auth/login", async ({ request }) => {
        upstreamBody = await request.json();
        return HttpResponse.json(MOCK_AUTH_TOKENS);
      })
    );
    await loginAndSetCookies("a@b.ci", "longpass8");
    expect(upstreamBody).toEqual({ email: "a@b.ci", password: "longpass8" });
  });

  it("401 sans cookie quand l'upstream refuse les identifiants", async () => {
    server.use(
      http.post("http://localhost:4010/auth/login", () =>
        HttpResponse.json(
          { error: { code: "INVALID_CREDENTIALS", message: "nope" } },
          { status: 401 }
        )
      )
    );
    const response = await loginAndSetCookies("a@b.ci", "wrongpass");
    expect(response.status).toBe(401);
    expect(response.cookies.get("access_token")).toBeUndefined();
  });

  it("503 quand l'upstream est injoignable", async () => {
    server.use(
      http.post("http://localhost:4010/auth/login", () => HttpResponse.error())
    );
    const response = await loginAndSetCookies("a@b.ci", "longpass8");
    expect(response.status).toBe(503);
  });
});
