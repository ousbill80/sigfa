// @vitest-environment node
/**
 * Tests for the /agent layout — S2: segment authentifié, le socket temps réel
 * est câblé via AuthenticatedRealtime (cookie vérifié côté serveur).
 * WEB-002-HDR : bandeau SessionHeader (agent connecté + déconnexion) rendu
 * depuis les claims du JWT VÉRIFIÉ — jamais le token brut dans l'arbre.
 * @module app/agent/layout.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { findElementByType, treeContainsString } from "@/test/element-tree";
import { AuthenticatedRealtime } from "@/lib/authenticated-realtime";
import { SessionHeader } from "@/components/ui/session-header";
import AgentLayout from "./layout";

const readVerifiedSession = vi.fn();
vi.mock("@/lib/server-session", () => ({
  readVerifiedSession: (): unknown => readVerifiedSession(),
}));

/** Claims AGENT vérifiés de référence. */
const CLAIMS = {
  sub: "user-1",
  role: "AGENT" as const,
  bankId: "bank-1",
  agencyIds: ["agency-1"],
  displayName: "Awa Koné",
};

beforeEach(() => {
  readVerifiedSession.mockReset();
});

describe("S2: /agent layout", () => {
  it("enveloppe le segment dans AuthenticatedRealtime", async () => {
    readVerifiedSession.mockResolvedValue(null);
    const tree = await AgentLayout({ children: null });
    expect(findElementByType(tree, AuthenticatedRealtime)).not.toBeNull();
  });

  it("WEB-002-HDR: session vérifiée → SessionHeader avec nom + rôle des claims", async () => {
    readVerifiedSession.mockResolvedValue({ token: "raw.jwt.token", claims: CLAIMS });
    const tree = await AgentLayout({ children: null });
    const header = findElementByType(tree, SessionHeader);
    expect(header).not.toBeNull();
    expect(header?.props["name"]).toBe("Awa Koné");
    expect(header?.props["role"]).toBe("AGENT");
  });

  it("WEB-002-HDR: sans session vérifiée (mode mock) → pas de bandeau", async () => {
    readVerifiedSession.mockResolvedValue(null);
    const tree = await AgentLayout({ children: null });
    expect(findElementByType(tree, SessionHeader)).toBeNull();
  });

  it("S2: le JWT brut ne descend JAMAIS dans l'arbre (seules les données dérivées)", async () => {
    readVerifiedSession.mockResolvedValue({ token: "raw.jwt.token", claims: CLAIMS });
    const tree = await AgentLayout({ children: null });
    expect(treeContainsString(tree, "raw.jwt.token")).toBe(false);
  });
});
