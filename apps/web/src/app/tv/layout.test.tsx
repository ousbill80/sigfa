// @vitest-environment node
/**
 * Tests for the /tv layout — S2 (Boucle 2 F4): /tv est PUBLIC ; son arbre
 * client reçoit un SocketProvider temps réel mais JAMAIS le JWT httpOnly.
 * @module app/tv/layout.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { findElementByType, treeContainsString } from "@/test/element-tree";
import { SocketProvider } from "@/lib/socket-provider";

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async (): Promise<{ get: (name: string) => { name: string; value: string } | undefined }> => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

import TvLayout from "./layout";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.tv-should-never-see-this";

describe("S2: /tv layout — provider temps réel public, sans JWT", () => {
  beforeEach(() => {
    cookieStore.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("S2: mode real + cookie présent → SocketProvider SANS token, JWT absent de l'arbre", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010/api/v1");
    cookieStore.set("access_token", JWT);
    const tree = await TvLayout({ children: null });
    const provider = findElementByType(tree, SocketProvider);
    expect(provider).not.toBeNull();
    expect(provider?.props.mode).toBe("real");
    expect(provider?.props.token).toBeUndefined();
    expect(provider?.props.url).toBe("http://localhost:4010");
    expect(treeContainsString(tree, JWT)).toBe(false);
  });

  it("mode off → SocketProvider inactif (simulation F4 inchangée)", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    const tree = await TvLayout({ children: null });
    const provider = findElementByType(tree, SocketProvider);
    expect(provider).not.toBeNull();
    expect(provider?.props.mode).toBe("off");
    expect(provider?.props.token).toBeUndefined();
  });
});
