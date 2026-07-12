// @vitest-environment node
/**
 * Tests for middleware — S1 (Boucle 2 F4): le RBAC de pages n'accepte QUE des
 * JWT dont la signature vérifie (jose HS256). Un cookie forgé {role:
 * "SUPER_ADMIN"} ne franchit plus AUCUNE page protégée.
 * @module middleware.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";
import { TEST_JWT_SECRET, signTestToken, forgeToken } from "@/test/jwt-helpers";

/** Builds a request for a path, optionally with an access_token cookie. */
function requestFor(path: string, token?: string): NextRequest {
  const request = new NextRequest(`http://localhost:3000${path}`);
  if (token) request.cookies.set("access_token", token);
  return request;
}

/** Extracts the redirect Location pathname (null when the request passes). */
function redirectedTo(response: Response): string | null {
  const location = response.headers.get("location");
  return location ? new URL(location).pathname : null;
}

describe("S1: middleware — vérification de signature AVANT extraction du rôle", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("S1: cookie FORGÉ {role: SUPER_ADMIN} sur /admin → non authentifié → /login", async () => {
    const response = await middleware(requestFor("/admin", forgeToken({ role: "SUPER_ADMIN" })));
    expect(redirectedTo(response)).toBe("/login");
  });

  it("S1: token signé avec un autre secret sur /admin → /login", async () => {
    const token = await signTestToken(
      { role: "SUPER_ADMIN" },
      { secret: "attacker-secret-0123456789-abcdefghijklmnopqr" }
    );
    const response = await middleware(requestFor("/admin", token));
    expect(redirectedTo(response)).toBe("/login");
  });

  it("S1: token expiré correctement signé → /login", async () => {
    const token = await signTestToken({ role: "AGENT" }, { expiresIn: "-1m" });
    const response = await middleware(requestFor("/agent", token));
    expect(redirectedTo(response)).toBe("/login");
  });

  it("S1: sans JWT_SECRET configuré, fail-closed → /login même avec token signé", async () => {
    vi.stubEnv("JWT_SECRET", "");
    const token = await signTestToken({ role: "AGENT" });
    const response = await middleware(requestFor("/agent", token));
    expect(redirectedTo(response)).toBe("/login");
  });

  it("token VALIDE signé HS256 → la page passe", async () => {
    const token = await signTestToken({ role: "AGENT", agencyIds: ["a1"] });
    const response = await middleware(requestFor("/agent", token));
    expect(redirectedTo(response)).toBeNull();
  });

  it("token valide mais rôle insuffisant (AGENT sur /admin) → /forbidden", async () => {
    const token = await signTestToken({ role: "AGENT" });
    const response = await middleware(requestFor("/admin", token));
    expect(redirectedTo(response)).toBe("/forbidden");
  });

  it("route publique /login sans cookie → passe", async () => {
    const response = await middleware(requestFor("/login"));
    expect(redirectedTo(response)).toBeNull();
  });

  it("route publique /tv sans cookie → passe", async () => {
    const response = await middleware(requestFor("/tv"));
    expect(redirectedTo(response)).toBeNull();
  });

  it("sans cookie sur une route protégée → /login avec ?next=", async () => {
    const response = await middleware(requestFor("/dashboard/manager"));
    expect(redirectedTo(response)).toBe("/login");
    const location = response.headers.get("location");
    expect(location).toContain("next=%2Fdashboard%2Fmanager");
  });
});
