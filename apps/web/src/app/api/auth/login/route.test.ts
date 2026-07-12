// @vitest-environment node
/**
 * Tests for login API route — S4 (Boucle 2 F4): le flux auth parle la forme
 * CONTRAT (AuthTokens camelCase). Les cookies httpOnly sont posés avec les
 * valeurs réelles de `accessToken`/`refreshToken` et `maxAge = expiresIn`.
 * @module app/api/auth/login/route.test
 */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { server, MOCK_AUTH_TOKENS } from "@/test/msw-server";
import { http, HttpResponse } from "msw";
import { POST } from "./route";

/** Builds a login request. */
function loginRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("S4: POST /api/auth/login — aligné sur AuthTokens (camelCase, LA LOI)", () => {
  it("S4: pose le cookie access_token avec la valeur de `accessToken` du contrat", async () => {
    const response = await POST(loginRequest({ email: "a@b.ci", password: "longpass8" }));
    expect(response.status).toBe(200);
    const access = response.cookies.get("access_token");
    expect(access?.value).toBe(MOCK_AUTH_TOKENS.accessToken);
    expect(access?.httpOnly).toBe(true);
    expect(access?.sameSite).toBe("lax");
    expect(access?.maxAge).toBe(MOCK_AUTH_TOKENS.expiresIn);
  });

  it("S4: pose le cookie refresh_token avec la valeur de `refreshToken` du contrat", async () => {
    const response = await POST(loginRequest({ email: "a@b.ci", password: "longpass8" }));
    const refresh = response.cookies.get("refresh_token");
    expect(refresh?.value).toBe(MOCK_AUTH_TOKENS.refreshToken);
    expect(refresh?.httpOnly).toBe(true);
  });

  it("S4: envoie {email, password} (LoginRequest) à l'upstream de contrat", async () => {
    let upstreamBody: unknown;
    server.use(
      http.post("http://localhost:4010/auth/login", async ({ request }) => {
        upstreamBody = await request.json();
        return HttpResponse.json(MOCK_AUTH_TOKENS);
      })
    );
    await POST(loginRequest({ email: "a@b.ci", password: "longpass8" }));
    expect(upstreamBody).toEqual({ email: "a@b.ci", password: "longpass8" });
  });

  it("400 quand email ou mot de passe manquant", async () => {
    const response = await POST(loginRequest({ email: "a@b.ci" }));
    expect(response.status).toBe(400);
  });

  it("401 quand l'upstream refuse les identifiants", async () => {
    server.use(
      http.post("http://localhost:4010/auth/login", () =>
        HttpResponse.json(
          { error: { code: "INVALID_CREDENTIALS", message: "nope" } },
          { status: 401 }
        )
      )
    );
    const response = await POST(loginRequest({ email: "a@b.ci", password: "wrongpass" }));
    expect(response.status).toBe(401);
    expect(response.cookies.get("access_token")).toBeUndefined();
  });

  it("503 quand l'upstream est injoignable", async () => {
    server.use(
      http.post("http://localhost:4010/auth/login", () => HttpResponse.error())
    );
    const response = await POST(loginRequest({ email: "a@b.ci", password: "longpass8" }));
    expect(response.status).toBe(503);
  });
});
