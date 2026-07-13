// @vitest-environment node
/**
 * Tests for /audit page (SEC-001b) — server-side RBAC (leçon SEC-F3-01).
 *
 * The Auditor surface is reserved to AUDITOR / SUPER_ADMIN (+ BANK_ADMIN for
 * their own bank). Any other role (MANAGER / AGENT / AGENCY_DIRECTOR) receives a
 * 403 rendered SERVER-SIDE (defence in depth on top of the middleware) — no
 * client component decides access. Authorised roles reach the read-only client
 * shell wired to the /api/rt proxy.
 * @module app/audit/page.test
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

import AuditPage from "./page";
import { AuditPageClient } from "./audit-page-client";
import { AuditForbidden } from "./audit-forbidden";

/** Renders the page for a given role via a verified JWT cookie (real mode). */
async function renderFor(role: string): Promise<Awaited<ReturnType<typeof AuditPage>>> {
  vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
  const token = await signTestToken({ role, bankId: "bank-42", agencyIds: ["agency-9"] });
  cookieStore.set("access_token", token);
  return AuditPage();
}

describe("SEC-001b: /audit — RBAC serveur (AUDITOR/SUPER_ADMIN)", () => {
  beforeEach(() => {
    cookieStore.clear();
    vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("SEC-001b: AUDITOR → écran read-only (client) monté sur le proxy /api/rt", async () => {
    const tree = await renderFor("AUDITOR");
    const client = findElementByType(tree, AuditPageClient);
    expect(client).not.toBeNull();
    expect(client?.props.apiBase).toBe("/api/rt");
    expect(findElementByType(tree, AuditForbidden)).toBeNull();
  });

  it("SEC-001b: SUPER_ADMIN → écran read-only autorisé", async () => {
    const tree = await renderFor("SUPER_ADMIN");
    expect(findElementByType(tree, AuditPageClient)).not.toBeNull();
    expect(findElementByType(tree, AuditForbidden)).toBeNull();
  });

  it("SEC-001b: MANAGER → 403 serveur (AuditForbidden), pas d'écran client", async () => {
    const tree = await renderFor("MANAGER");
    expect(findElementByType(tree, AuditForbidden)).not.toBeNull();
    expect(findElementByType(tree, AuditPageClient)).toBeNull();
  });

  it("SEC-001b: AGENT → 403 serveur", async () => {
    const tree = await renderFor("AGENT");
    expect(findElementByType(tree, AuditForbidden)).not.toBeNull();
    expect(findElementByType(tree, AuditPageClient)).toBeNull();
  });

  it("SEC-001b: AGENCY_DIRECTOR → 403 serveur", async () => {
    const tree = await renderFor("AGENCY_DIRECTOR");
    expect(findElementByType(tree, AuditForbidden)).not.toBeNull();
    expect(findElementByType(tree, AuditPageClient)).toBeNull();
  });

  it("SEC-001b: mode real sans cookie → redirection /login (défense middleware)", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    await expect(AuditPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
