// @vitest-environment node
/**
 * Tests for the /dashboard hub — redirection serveur vers le dashboard du rôle
 * (fix « /dashboard vide » : le hub n'a aucune donnée propre, il route vers la
 * surface qui en porte).
 * @module app/dashboard/page.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

import DashboardPage from "./page";

describe("WEB-001: /dashboard hub — redirection vers le dashboard du rôle", () => {
  beforeEach(() => {
    cookieStore.clear();
    vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010/api/v1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("mode real, AGENT → redirection vers la console /agent (WEB-002)", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    const token = await signTestToken({
      role: "AGENT",
      bankId: "bank-42",
      agencyIds: ["agency-9"],
    });
    cookieStore.set("access_token", token);
    await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT:/agent");
  });

  it("mode real, MANAGER → redirection /dashboard/manager", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    const token = await signTestToken({
      role: "MANAGER",
      bankId: "bank-42",
      agencyIds: ["agency-9"],
    });
    cookieStore.set("access_token", token);
    await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard/manager");
  });

  it("mode real sans cookie → redirection /login (défense en profondeur)", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("mode mock → redirection vers le dashboard de la fixture (BANK_ADMIN → /admin)", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT:/admin");
  });
});
