// @vitest-environment node
/**
 * Tests for /admin/onboarding page (ADM-002b) — the onboarding parcours server
 * component derives the tenant from the verified JWT (real mode) or fixtures
 * (mock mode) and forwards resume ids from the URL query to the client shell.
 * @module app/admin/onboarding/page.test
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

import OnboardingPage from "./page";
import { OnboardingPageClient } from "./onboarding-page-client";

describe("ADM-002b: /admin/onboarding — tenant des claims + reprise via query", () => {
  beforeEach(() => {
    cookieStore.clear();
    vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ADM-002b: mode real → apiBase /api/rt et bankId/role des claims vérifiés", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    const token = await signTestToken({
      role: "AGENCY_DIRECTOR",
      bankId: "bank-42",
      agencyIds: ["agency-9"],
    });
    cookieStore.set("access_token", token);
    const tree = await OnboardingPage({});
    const client = findElementByType(tree, OnboardingPageClient);
    expect(client).not.toBeNull();
    expect(client?.props.apiBase).toBe("/api/rt");
    expect(client?.props.bankId).toBe("bank-42");
    expect(client?.props.role).toBe("AGENCY_DIRECTOR");
  });

  it("ADM-002b: reprise — les ids de la query sont transmis au shell", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    const tree = await OnboardingPage({
      searchParams: Promise.resolve({ agencyId: "ag-1", onboardingId: "ob-1" }),
    });
    const client = findElementByType(tree, OnboardingPageClient);
    expect(client?.props.resumeAgencyId).toBe("ag-1");
    expect(client?.props.resumeOnboardingId).toBe("ob-1");
  });

  it("ADM-002b: mode mock → base mock + fixtures tenant", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    const tree = await OnboardingPage({});
    const client = findElementByType(tree, OnboardingPageClient);
    expect(client?.props.apiBase).toBe("http://localhost:4010");
    expect(client?.props.bankId).toBe(MOCK_TENANT.bankId);
    expect(client?.props.role).toBe(MOCK_TENANT.role);
  });
});
