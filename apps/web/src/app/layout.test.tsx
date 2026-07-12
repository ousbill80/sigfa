// @vitest-environment node
/**
 * Tests for the root layout — S2 (Boucle 2 F4): le JWT httpOnly ne doit JAMAIS
 * être réinjecté dans l'arbre client du layout racine (payload RSC de TOUTES
 * les pages, y compris /login et /tv publiques).
 * @module app/layout.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { treeContainsString } from "@/test/element-tree";

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async (): Promise<{ get: (name: string) => { name: string; value: string } | undefined }> => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

import RootLayout from "./layout";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSIsImFnZW5jeUlkcyI6WyJhMSJdfQ.sig-secret-material";

describe("S2: root layout — aucun JWT dans l'arbre client racine", () => {
  beforeEach(() => {
    cookieStore.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("S2: mode real + cookie access_token présent → le token n'apparaît dans AUCUNE prop de l'arbre", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    cookieStore.set("access_token", JWT);
    const tree = await RootLayout({ children: null });
    expect(treeContainsString(tree, JWT)).toBe(false);
  });

  it("mode off → pas de token non plus (inchangé)", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    cookieStore.set("access_token", JWT);
    const tree = await RootLayout({ children: null });
    expect(treeContainsString(tree, JWT)).toBe(false);
  });
});
