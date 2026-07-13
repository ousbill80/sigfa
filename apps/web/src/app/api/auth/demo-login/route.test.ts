// @vitest-environment node
/**
 * Tests for demo-login API route — connexion démo directe par rôle (PHASE DE
 * TEST). Garanties de sécurité vérifiées ici : flag OFF → 404 (fail-closed,
 * garantie prod) ; rôle hors liste fermée → 400 ; mot de passe env absent →
 * 404 ; succès → login réel de contrat et cookies httpOnly posés.
 * @module app/api/auth/demo-login/route.test
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { server, MOCK_AUTH_TOKENS } from "@/test/msw-server";
import { http, HttpResponse } from "msw";
import { DEMO_LOGIN_ROLES } from "@/lib/demo-login";
import { POST } from "./route";

/** Builds a demo-login request. */
function demoLoginRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/auth/demo-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Active le flag + les 5 mots de passe démo. */
function stubAllDemoEnv(): void {
  vi.stubEnv("SIGFA_DEMO_LOGIN", "1");
  for (const role of DEMO_LOGIN_ROLES) {
    vi.stubEnv(`DEMO_LOGIN_PASSWORD_${role}`, `pw-${role.toLowerCase()}`);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/auth/demo-login — gate SIGFA_DEMO_LOGIN (fail-closed)", () => {
  it("404 quand le flag est OFF, même avec un rôle valide et les mots de passe env", async () => {
    vi.stubEnv("SIGFA_DEMO_LOGIN", "");
    vi.stubEnv("DEMO_LOGIN_PASSWORD_AGENT", "pw-agent");
    const response = await POST(demoLoginRequest({ role: "AGENT" }));
    expect(response.status).toBe(404);
    expect(response.cookies.get("access_token")).toBeUndefined();
  });

  it("404 quand le flag vaut autre chose que '1'", async () => {
    vi.stubEnv("SIGFA_DEMO_LOGIN", "true");
    const response = await POST(demoLoginRequest({ role: "AGENT" }));
    expect(response.status).toBe(404);
  });
});

describe("POST /api/auth/demo-login — validation du rôle (liste fermée)", () => {
  it("400 pour un rôle inconnu", async () => {
    stubAllDemoEnv();
    const response = await POST(demoLoginRequest({ role: "HACKER" }));
    expect(response.status).toBe(400);
  });

  it("400 pour SUPER_ADMIN (jamais exposé en démo)", async () => {
    stubAllDemoEnv();
    const response = await POST(demoLoginRequest({ role: "SUPER_ADMIN" }));
    expect(response.status).toBe(400);
  });

  it("400 quand le body est invalide ou sans rôle", async () => {
    stubAllDemoEnv();
    expect((await POST(demoLoginRequest({}))).status).toBe(400);
    const raw = new NextRequest("http://localhost:3000/api/auth/demo-login", {
      method: "POST",
      body: "not-json",
    });
    expect((await POST(raw)).status).toBe(400);
  });
});

describe("POST /api/auth/demo-login — mot de passe env absent", () => {
  it("404 quand DEMO_LOGIN_PASSWORD_<ROLE> n'est pas fourni", async () => {
    vi.stubEnv("SIGFA_DEMO_LOGIN", "1");
    vi.stubEnv("DEMO_LOGIN_PASSWORD_AGENT", "pw-agent");
    const response = await POST(demoLoginRequest({ role: "MANAGER" }));
    expect(response.status).toBe(404);
    expect(response.cookies.get("access_token")).toBeUndefined();
  });
});

describe("POST /api/auth/demo-login — succès (login réel de contrat)", () => {
  it("200 {ok:true} et cookies httpOnly posés depuis les AuthTokens", async () => {
    stubAllDemoEnv();
    const response = await POST(demoLoginRequest({ role: "AGENT" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const access = response.cookies.get("access_token");
    expect(access?.value).toBe(MOCK_AUTH_TOKENS.accessToken);
    expect(access?.httpOnly).toBe(true);
    expect(response.cookies.get("refresh_token")?.value).toBe(MOCK_AUTH_TOKENS.refreshToken);
  });

  it("envoie l'email déterministe du seed + le mot de passe env à l'upstream", async () => {
    stubAllDemoEnv();
    let upstreamBody: unknown;
    server.use(
      http.post("http://localhost:4010/auth/login", async ({ request }) => {
        upstreamBody = await request.json();
        return HttpResponse.json(MOCK_AUTH_TOKENS);
      })
    );
    await POST(demoLoginRequest({ role: "AGENCY_DIRECTOR" }));
    expect(upstreamBody).toEqual({
      email: "demo.agency.director@sigfa-demo.ci",
      password: "pw-agency_director",
    });
  });

  it("401 quand l'upstream refuse les identifiants démo", async () => {
    stubAllDemoEnv();
    server.use(
      http.post("http://localhost:4010/auth/login", () =>
        HttpResponse.json(
          { error: { code: "INVALID_CREDENTIALS", message: "nope" } },
          { status: 401 }
        )
      )
    );
    const response = await POST(demoLoginRequest({ role: "AUDITOR" }));
    expect(response.status).toBe(401);
    expect(response.cookies.get("access_token")).toBeUndefined();
  });
});
