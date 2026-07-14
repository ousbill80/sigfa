// @vitest-environment node
/**
 * Tests for the /api/rt proxy (RT-003 / S3) — porte API UNIQUE du navigateur.
 *
 * Fix « /dashboard vide » : le proxy dessert désormais les DEUX modes RT-001b.
 * - real : upstream = origine de NEXT_PUBLIC_API_URL + /api/v1, Bearer relayé
 *   depuis le cookie httpOnly ;
 * - off  : upstream = base mock Prism VERBATIM (chemins nus) + bearer factice
 *   (Prism valide la présence du scheme, jamais la valeur).
 * @module app/api/rt/[...path]/route.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { server } from "@/test/msw-server";
import { http, HttpResponse } from "msw";
import { GET, POST } from "./route";

/** Construit une requête proxy same-origin. */
function rtRequest(
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; cookie?: string }
): NextRequest {
  const request = new NextRequest(`http://localhost:3000/api/rt/${path}`, {
    method: init?.method ?? "GET",
    headers: init?.headers,
    ...(init?.body !== undefined ? { body: init.body } : {}),
  });
  if (init?.cookie) request.cookies.set("access_token", init.cookie);
  return request;
}

/** Contexte de route (segments du chemin de contrat). */
function ctx(...path: string[]): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path }) };
}

describe("RT-003/S3: proxy /api/rt — upstream par mode + Bearer", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010/api/v1");
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("S3: mode real → origine + /api/v1, Bearer du cookie httpOnly relayé", async () => {
    let auth: string | null = null;
    server.use(
      http.get("http://localhost:4010/api/v1/services", ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json([{ id: "svc-1" }]);
      })
    );
    const response = await GET(rtRequest("services", { cookie: "jwt-abc" }), ctx("services"));
    expect(response.status).toBe(200);
    expect(auth).toBe("Bearer jwt-abc");
  });

  it("S3: mode real, env SANS suffixe /api/v1 → préfixe /api/v1 quand même", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010");
    let hit = false;
    server.use(
      http.get("http://localhost:4010/api/v1/services", () => {
        hit = true;
        return HttpResponse.json([]);
      })
    );
    await GET(rtRequest("services"), ctx("services"));
    expect(hit).toBe(true);
  });

  it("RT-001b: mode off → base mock VERBATIM (chemins nus Prism) + bearer factice", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010");
    let auth: string | null = null;
    server.use(
      http.get("http://localhost:4010/services", ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json([]);
      })
    );
    const response = await GET(rtRequest("services"), ctx("services"));
    expect(response.status).toBe(200);
    expect(auth).toBe("Bearer prism-mock");
  });

  it("RT-001b: mode off avec cookie → le vrai Bearer prime sur le factice", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010");
    let auth: string | null = null;
    server.use(
      http.get("http://localhost:4010/services", ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json([]);
      })
    );
    await GET(rtRequest("services", { cookie: "jwt-real" }), ctx("services"));
    expect(auth).toBe("Bearer jwt-real");
  });

  it("C1: POST relayé verbatim — corps + X-Idempotency-Key + query string", async () => {
    let seen: { url: string; idem: string | null; body: unknown } | null = null;
    server.use(
      http.post("http://localhost:4010/api/v1/tickets", async ({ request }) => {
        seen = {
          url: request.url,
          idem: request.headers.get("x-idempotency-key"),
          body: await request.json(),
        };
        return HttpResponse.json({ id: "t-1" }, { status: 201 });
      })
    );
    const response = await POST(
      rtRequest("tickets?lang=fr", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": "idem-1" },
        body: JSON.stringify({ serviceId: "svc-1" }),
        cookie: "jwt-abc",
      }),
      ctx("tickets")
    );
    expect(response.status).toBe(201);
    expect(seen).not.toBeNull();
    expect(seen!.url).toBe("http://localhost:4010/api/v1/tickets?lang=fr");
    expect(seen!.idem).toBe("idem-1");
    expect(seen!.body).toEqual({ serviceId: "svc-1" });
  });

  it("502 UPSTREAM_UNAVAILABLE quand l'API est injoignable", async () => {
    server.use(
      http.get("http://localhost:4010/api/v1/services", () => HttpResponse.error())
    );
    const response = await GET(rtRequest("services"), ctx("services"));
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("UPSTREAM_UNAVAILABLE");
  });
});
