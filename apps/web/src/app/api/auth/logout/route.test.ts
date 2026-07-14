// @vitest-environment node
/**
 * Tests for logout API route — WEB-002-HDR : purge des cookies httpOnly,
 * révocation best-effort du refresh token côté API (POST /auth/logout, route
 * de contrat existante) et redirection 303 /login.
 * @module app/api/auth/logout/route.test
 */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { server } from "@/test/msw-server";
import { http, HttpResponse } from "msw";
import { POST } from "./route";

/** Builds a logout request (cookies via header — httpOnly côté serveur). */
function logoutRequest(cookies?: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/auth/logout", {
    method: "POST",
    headers: cookies ? { cookie: cookies } : {},
  });
}

describe("WEB-002-HDR: POST /api/auth/logout", () => {
  it("purge access_token et refresh_token (maxAge 0) et redirige 303 vers /login", async () => {
    server.use(
      http.post("http://localhost:4010/auth/logout", () => HttpResponse.json({ success: true }))
    );
    const response = await POST(
      logoutRequest("access_token=some.jwt; refresh_token=refresh-1")
    );
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
    const access = response.cookies.get("access_token");
    const refresh = response.cookies.get("refresh_token");
    expect(access?.value).toBe("");
    expect(access?.maxAge).toBe(0);
    expect(access?.httpOnly).toBe(true);
    expect(refresh?.value).toBe("");
    expect(refresh?.maxAge).toBe(0);
  });

  it("révoque le refresh token à l'upstream de contrat (RefreshRequest)", async () => {
    let upstreamBody: unknown;
    server.use(
      http.post("http://localhost:4010/auth/logout", async ({ request }) => {
        upstreamBody = await request.json();
        return HttpResponse.json({ success: true });
      })
    );
    await POST(logoutRequest("refresh_token=refresh-abc"));
    expect(upstreamBody).toEqual({ refreshToken: "refresh-abc" });
  });

  it("API injoignable → purge quand même les cookies (best-effort, jamais bloquant)", async () => {
    server.use(
      http.post("http://localhost:4010/auth/logout", () => HttpResponse.error())
    );
    const response = await POST(logoutRequest("refresh_token=refresh-down"));
    expect(response.status).toBe(303);
    expect(response.cookies.get("access_token")?.maxAge).toBe(0);
    expect(response.cookies.get("refresh_token")?.maxAge).toBe(0);
  });

  it("sans cookie refresh_token → aucun appel upstream, purge + redirect quand même", async () => {
    let upstreamCalled = false;
    server.use(
      http.post("http://localhost:4010/auth/logout", () => {
        upstreamCalled = true;
        return HttpResponse.json({ success: true });
      })
    );
    const response = await POST(logoutRequest());
    expect(upstreamCalled).toBe(false);
    expect(response.status).toBe(303);
    expect(response.cookies.get("access_token")?.maxAge).toBe(0);
  });
});
