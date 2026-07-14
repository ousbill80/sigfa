// @vitest-environment node
/**
 * Tests for /dashboard/reports page (REP-003b) — S3: real mode routes through
 * the /api/rt proxy with tenant context (bankId/agencyId/role) from verified
 * JWT claims; mock mode falls back to the Prism base + fixture.
 * @module app/dashboard/reports/page.test
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

import ReportsPage from "./page";
import { ReportsPageClient } from "./reports-page-client";

describe("S3: /dashboard/reports — proxy authentifié + contexte des claims", () => {
  beforeEach(() => {
    cookieStore.clear();
    vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("S3: mode real → apiBase /api/rt + bankId/role des claims vérifiés", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    const token = await signTestToken({
      role: "AGENCY_DIRECTOR",
      bankId: "bank-42",
      agencyIds: ["agency-9"],
    });
    cookieStore.set("access_token", token);
    const tree = await ReportsPage();
    const client = findElementByType(tree, ReportsPageClient);
    expect(client).not.toBeNull();
    expect(client?.props.apiBase).toBe("/api/rt");
    expect(client?.props.bankId).toBe("bank-42");
    expect(client?.props.role).toBe("AGENCY_DIRECTOR");
    expect(client?.props.agencyId).toBe("agency-9");
  });

  it("S3: mode real sans cookie → redirection /login", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    await expect(ReportsPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("mode mock → proxy /api/rt + fixture tenant", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    const tree = await ReportsPage();
    const client = findElementByType(tree, ReportsPageClient);
    expect(client?.props.apiBase).toBe("/api/rt");
    expect(client?.props.bankId).toBe(MOCK_TENANT.bankId);
    expect(client?.props.role).toBe(MOCK_TENANT.role);
  });
});
