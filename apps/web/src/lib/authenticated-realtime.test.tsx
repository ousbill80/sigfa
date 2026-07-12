// @vitest-environment node
/**
 * Tests for AuthenticatedRealtime — S2 (Boucle 2 F4): la lecture du cookie
 * httpOnly et son injection dans le SocketProvider sont réservées aux segments
 * AUTHENTIFIÉS, et seulement après VÉRIFICATION de signature (S1).
 * @module lib/authenticated-realtime.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { findElementByType } from "@/test/element-tree";
import { SocketProvider } from "@/lib/socket-provider";
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

import { AuthenticatedRealtime } from "./authenticated-realtime";

describe("S2: AuthenticatedRealtime — injection token réservée aux segments authentifiés", () => {
  beforeEach(() => {
    cookieStore.clear();
    vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010/api/v1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("mode real + cookie VALIDE → SocketProvider reçoit token + agencyId des claims vérifiés", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    const token = await signTestToken({ role: "AGENT", agencyIds: ["agency-7"] });
    cookieStore.set("access_token", token);
    const tree = await AuthenticatedRealtime({ children: null });
    const provider = findElementByType(tree, SocketProvider);
    expect(provider).not.toBeNull();
    expect(provider?.props.mode).toBe("real");
    expect(provider?.props.token).toBe(token);
    expect(provider?.props.agencyId).toBe("agency-7");
    expect(provider?.props.url).toBe("http://localhost:4010");
  });

  it("S1×S2: cookie FORGÉ → AUCUN token injecté (vérification avant injection)", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    cookieStore.set("access_token", forgeToken({ role: "SUPER_ADMIN", agencyIds: ["a1"] }));
    const tree = await AuthenticatedRealtime({ children: null });
    const provider = findElementByType(tree, SocketProvider);
    expect(provider?.props.token).toBeUndefined();
    expect(provider?.props.agencyId).toBeUndefined();
  });

  it("mode real sans cookie → provider real sans token (repli offline géré par le provider)", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    const tree = await AuthenticatedRealtime({ children: null });
    const provider = findElementByType(tree, SocketProvider);
    expect(provider?.props.mode).toBe("real");
    expect(provider?.props.token).toBeUndefined();
  });

  it("mode off → provider inactif, cookie jamais lu", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    const token = await signTestToken({ role: "AGENT", agencyIds: ["a1"] });
    cookieStore.set("access_token", token);
    const tree = await AuthenticatedRealtime({ children: null });
    const provider = findElementByType(tree, SocketProvider);
    expect(provider?.props.mode).toBe("off");
    expect(provider?.props.token).toBeUndefined();
  });
});
