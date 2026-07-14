// @vitest-environment node
/**
 * Tests for /dashboard/network page — S3 (Boucle 2 F4): en mode real le
 * dashboard réseau passe par le proxy /api/rt et la banque vient des claims.
 * @module app/dashboard/network/page.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { findElementByType } from "@/test/element-tree";
import { TEST_JWT_SECRET, signTestToken } from "@/test/jwt-helpers";
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

import NetworkDashboardPage from "./page";
import { NetworkPageClient } from "./network-page-client";

describe("S3: /dashboard/network — proxy authentifié + banque des claims", () => {
  beforeEach(() => {
    cookieStore.clear();
    vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("S3: mode real → apiBase /api/rt + bankId des claims vérifiés", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    const token = await signTestToken({
      role: "AGENCY_DIRECTOR",
      bankId: "bank-42",
      agencyIds: ["agency-9"],
    });
    cookieStore.set("access_token", token);
    const tree = await NetworkDashboardPage();
    const client = findElementByType(tree, NetworkPageClient);
    expect(client).not.toBeNull();
    expect(client?.props.apiBase).toBe("/api/rt");
    expect(client?.props.bankId).toBe("bank-42");
  });

  it("S3: mode real sans cookie → redirection /login", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    await expect(NetworkDashboardPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("mode mock → proxy /api/rt + fixture banque", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    const tree = await NetworkDashboardPage();
    const client = findElementByType(tree, NetworkPageClient);
    expect(client?.props.apiBase).toBe("/api/rt");
    expect(client?.props.bankId).toBe(MOCK_TENANT.bankId);
  });
});
