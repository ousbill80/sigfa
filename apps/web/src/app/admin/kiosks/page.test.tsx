// @vitest-environment node
/**
 * Tests for /admin/kiosks page (ADM-003b) — S3: real mode routes through the
 * authenticated proxy /api/rt with agencyId/role from the verified claims and a
 * socket token; mock mode uses the Prism base + fixtures.
 * @module app/admin/kiosks/page.test
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

import KiosksSupervisionPage from "./page";
import { KiosksPageClient } from "./kiosks-page-client";

describe("ADM-003b: /admin/kiosks — proxy authentifié + scope des claims", () => {
  beforeEach(() => {
    cookieStore.clear();
    vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ADM-003b: mode real → apiBase /api/rt + agencyId des claims + token socket", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    const token = await signTestToken({
      role: "AGENCY_DIRECTOR",
      bankId: "bank-42",
      agencyIds: ["agency-9"],
    });
    cookieStore.set("access_token", token);
    const tree = await KiosksSupervisionPage();
    const client = findElementByType(tree, KiosksPageClient);
    expect(client).not.toBeNull();
    expect(client?.props.apiBase).toBe("/api/rt");
    expect(client?.props.agencyId).toBe("agency-9");
    expect(client?.props.role).toBe("AGENCY_DIRECTOR");
    expect(client?.props.realtime).toBe(true);
    expect(client?.props.token).toBe(token);
  });

  it("ADM-003b: mode real sans cookie → redirection /login", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    await expect(KiosksSupervisionPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("ADM-003b: mode mock → proxy /api/rt + fixture agence + pas de token", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    const tree = await KiosksSupervisionPage();
    const client = findElementByType(tree, KiosksPageClient);
    expect(client?.props.apiBase).toBe("/api/rt");
    expect(client?.props.agencyId).toBe(MOCK_TENANT.agencyId);
    expect(client?.props.realtime).toBe(false);
    expect(client?.props.token).toBeUndefined();
  });
});
