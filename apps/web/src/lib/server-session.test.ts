// @vitest-environment node
/**
 * Tests for lib/server-session — S3 (Boucle 2 F4): les pages authentifiées
 * dérivent apiBase (proxy /api/rt en mode real) et le tenant (bankId /
 * agencyId / role) des claims du JWT VÉRIFIÉ, jamais de constantes client.
 * @module lib/server-session.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TEST_JWT_SECRET, signTestToken, forgeToken } from "@/test/jwt-helpers";

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async (): Promise<{ get: (name: string) => { name: string; value: string } | undefined }> => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

import {
  resolveTenantContext,
  readVerifiedSession,
  MOCK_TENANT,
} from "./server-session";

describe("S3: resolveTenantContext — proxy + tenant issus du JWT vérifié", () => {
  beforeEach(() => {
    cookieStore.clear();
    vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("S3: mode real → apiBase = proxy same-origin /api/rt (Bearer injecté côté serveur)", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    const token = await signTestToken({
      role: "BANK_ADMIN",
      bankId: "bank-42",
      agencyIds: ["agency-9"],
    });
    cookieStore.set("access_token", token);
    const ctx = await resolveTenantContext();
    expect(ctx.apiBase).toBe("/api/rt");
    expect(ctx.realtime).toBe(true);
  });

  it("S3: mode real → bankId/agencyId/role dérivés des claims VÉRIFIÉS", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    const token = await signTestToken({
      role: "MANAGER",
      bankId: "bank-42",
      agencyIds: ["agency-9", "agency-10"],
    });
    cookieStore.set("access_token", token);
    const ctx = await resolveTenantContext();
    expect(ctx.bankId).toBe("bank-42");
    expect(ctx.agencyId).toBe("agency-9");
    expect(ctx.role).toBe("MANAGER");
  });

  it("S3: mode real + cookie FORGÉ → redirection /login (défense en profondeur)", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    cookieStore.set("access_token", forgeToken({ role: "SUPER_ADMIN", bankId: "b" }));
    await expect(resolveTenantContext()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("S3: mode real sans cookie → redirection /login", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    await expect(resolveTenantContext()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("mode mock → proxy /api/rt + fixtures tenant (bascule d'env respectée)", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010");
    const ctx = await resolveTenantContext();
    // S3 : même en mock, le navigateur passe par le proxy same-origin — c'est
    // le proxy qui rebase vers le mock Prism (jamais de cross-origin client).
    expect(ctx.apiBase).toBe("/api/rt");
    expect(ctx.realtime).toBe(false);
    expect(ctx.bankId).toBe(MOCK_TENANT.bankId);
    expect(ctx.agencyId).toBe(MOCK_TENANT.agencyId);
    expect(ctx.role).toBe(MOCK_TENANT.role);
  });

  it("SUPER_ADMIN (bankId null au JWT) → bankId vide, pas de constante inventée", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    const token = await signTestToken({ role: "SUPER_ADMIN" });
    cookieStore.set("access_token", token);
    const ctx = await resolveTenantContext();
    expect(ctx.bankId).toBe("");
    expect(ctx.agencyId).toBe("");
    expect(ctx.role).toBe("SUPER_ADMIN");
  });
});

describe("readVerifiedSession — lecture + vérification du cookie httpOnly", () => {
  beforeEach(() => {
    cookieStore.clear();
    vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("cookie valide → token + claims", async () => {
    const token = await signTestToken({ role: "AGENT", agencyIds: ["a1"] });
    cookieStore.set("access_token", token);
    const verified = await readVerifiedSession();
    expect(verified?.token).toBe(token);
    expect(verified?.claims.role).toBe("AGENT");
  });

  it("cookie forgé → null", async () => {
    cookieStore.set("access_token", forgeToken({ role: "AGENT" }));
    expect(await readVerifiedSession()).toBeNull();
  });

  it("pas de cookie → null", async () => {
    expect(await readVerifiedSession()).toBeNull();
  });
});
