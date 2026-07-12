// @vitest-environment node
/**
 * Tests for the /tv/[agencyId] layout (RT-003) — écran mural par agence.
 *
 * Le layout est PUBLIC (Boucle 2 S2) : il ne lit JAMAIS le cookie httpOnly et ne
 * réinjecte AUCUN JWT agent. Il résout le mode/URL d'env et délègue le mint du
 * token DISPLAY + le câblage socket à {@link TvRealtime} (client), auquel il
 * passe l'`agencyId` de la route.
 *
 * @module app/tv/[agencyId]/layout.test
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { findElementByType, treeContainsString } from "@/test/element-tree";
import { TvRealtime } from "@/components/tv/tv-realtime";

import TvAgencyLayout from "./layout";

const AGENCY_ID = "33333333-3333-4333-a333-333333333333";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.tv-should-never-see-this";

describe("RT-003: /tv/[agencyId] layout — mint DISPLAY public, sans JWT agent", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("RT-003: mode real → TvRealtime avec agencyId de la route et mode real", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "real");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4010");
    const tree = await TvAgencyLayout({
      children: null,
      params: Promise.resolve({ agencyId: AGENCY_ID }),
    });
    const rt = findElementByType(tree, TvRealtime);
    expect(rt).not.toBeNull();
    expect(rt?.props.mode).toBe("real");
    expect(rt?.props.agencyId).toBe(AGENCY_ID);
    // Aucun JWT agent ne doit transiter par l'arbre public.
    expect(treeContainsString(tree, JWT)).toBe(false);
  });

  it("RT-003: mode off → TvRealtime en off (fixtures F4)", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_MODE", "off");
    const tree = await TvAgencyLayout({
      children: null,
      params: Promise.resolve({ agencyId: AGENCY_ID }),
    });
    const rt = findElementByType(tree, TvRealtime);
    expect(rt).not.toBeNull();
    expect(rt?.props.mode).toBe("off");
    expect(rt?.props.agencyId).toBe(AGENCY_ID);
  });
});
