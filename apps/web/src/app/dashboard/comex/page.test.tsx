// @vitest-environment node
/**
 * Tests for /dashboard/comex page — S3 (Boucle 2 F4): en mode real le
 * dashboard COMEX passe par le proxy same-origin /api/rt (Bearer côté serveur).
 * @module app/dashboard/comex/page.test
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

import ComexDashboardPage from "./page";
import { ComexPageClient } from "./comex-page-client";

describe("S3: /dashboard/comex — proxy authentifié", () => {
  beforeEach(() => {
    cookieStore.clear();
    vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("S3: mode real → apiBase /api/rt", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    const token = await signTestToken({ role: "BANK_ADMIN", bankId: "bank-42" });
    cookieStore.set("access_token", token);
    const tree = await ComexDashboardPage();
    const client = findElementByType(tree, ComexPageClient);
    expect(client).not.toBeNull();
    expect(client?.props.apiBase).toBe("/api/rt");
  });

  it("S3: mode real sans cookie → redirection /login", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    await expect(ComexDashboardPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("mode mock → base mock d'env", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    const tree = await ComexDashboardPage();
    const client = findElementByType(tree, ComexPageClient);
    expect(client?.props.apiBase).toBe("http://localhost:4010");
  });
});
