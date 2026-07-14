// @vitest-environment node
/**
 * Tests for /platform/network page (NET-001-WEB) — S3: real mode proxies
 * /api/rt with the verified SUPER_ADMIN JWT; mock mode uses the Prism base.
 * @module app/platform/network/page.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { findElementByType } from "@/test/element-tree";
import { TEST_JWT_SECRET, signTestToken } from "@/test/jwt-helpers";

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

import PlatformNetworkPage from "./page";
import { NetAdminPageClient } from "./net-admin-page-client";

describe("NET-001: /platform/network — page Super Admin (S3)", () => {
  beforeEach(() => {
    cookieStore.clear();
    vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("NET-001: mode real (SUPER_ADMIN) → apiBase /api/rt", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    const token = await signTestToken({ role: "SUPER_ADMIN", agencyIds: [] });
    cookieStore.set("access_token", token);
    const tree = await PlatformNetworkPage();
    const client = findElementByType(tree, NetAdminPageClient);
    expect(client).not.toBeNull();
    expect(client?.props.apiBase).toBe("/api/rt");
  });

  it("NET-001: mode real sans cookie → redirection /login", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    await expect(PlatformNetworkPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("NET-001: mode mock → proxy /api/rt (upstream Prism)", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    const tree = await PlatformNetworkPage();
    const client = findElementByType(tree, NetAdminPageClient);
    expect(client?.props.apiBase).toBe("/api/rt");
  });
});
