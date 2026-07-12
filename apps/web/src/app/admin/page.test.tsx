// @vitest-environment node
/**
 * Tests for /admin page — S3 (Boucle 2 F4): en mode real, la console admin
 * passe par le proxy same-origin /api/rt et le tenant vient des claims du JWT
 * vérifié ; en mode mock, la bascule d'env existante reste fonctionnelle.
 * @module app/admin/page.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { findElementByType } from "@/test/element-tree";
import { TEST_JWT_SECRET, signTestToken, forgeToken } from "@/test/jwt-helpers";
import { MOCK_TENANT } from "@/lib/server-session";

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

import AdminPage from "./page";
import { AdminPageClient } from "./admin-page-client";

describe("S3: /admin — proxy authentifié + tenant des claims", () => {
  beforeEach(() => {
    cookieStore.clear();
    vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("S3: mode real → apiBase /api/rt et bankId/agencyId/role des claims vérifiés", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    const token = await signTestToken({
      role: "BANK_ADMIN",
      bankId: "bank-42",
      agencyIds: ["agency-9"],
    });
    cookieStore.set("access_token", token);
    const tree = await AdminPage();
    const client = findElementByType(tree, AdminPageClient);
    expect(client).not.toBeNull();
    expect(client?.props.apiBase).toBe("/api/rt");
    expect(client?.props.bankId).toBe("bank-42");
    expect(client?.props.agencyId).toBe("agency-9");
    expect(client?.props.role).toBe("BANK_ADMIN");
  });

  it("S3: mode real + cookie forgé → redirection /login", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    cookieStore.set("access_token", forgeToken({ role: "BANK_ADMIN", bankId: "b" }));
    await expect(AdminPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("mode mock → base mock + fixtures tenant (bascule d'env inchangée)", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    const tree = await AdminPage();
    const client = findElementByType(tree, AdminPageClient);
    expect(client?.props.apiBase).toBe("http://localhost:4010");
    expect(client?.props.bankId).toBe(MOCK_TENANT.bankId);
    expect(client?.props.agencyId).toBe(MOCK_TENANT.agencyId);
    expect(client?.props.role).toBe(MOCK_TENANT.role);
  });
});
