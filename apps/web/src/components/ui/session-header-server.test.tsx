// @vitest-environment node
/**
 * Tests for SessionHeaderServer (WEB-002-HDR) — assemblage SERVEUR du bandeau
 * session : claims vérifiés + marque banque + agence de rattachement. S2 : le
 * token brut ne descend jamais dans l'arbre.
 * @module components/ui/session-header-server.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { findElementByType, treeContainsString } from "@/test/element-tree";
import { SessionHeader } from "@/components/ui/session-header";
import { SessionHeaderServer } from "./session-header-server";

const readVerifiedSession = vi.fn();
vi.mock("@/lib/server-session", () => ({
  readVerifiedSession: (): unknown => readVerifiedSession(),
}));

const resolveAgencyLabel = vi.fn();
vi.mock("@/lib/agency-label", () => ({
  resolveAgencyLabel: (...args: unknown[]): unknown => resolveAgencyLabel(...args),
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
  resolveAgencyLabel.mockReset();
});

describe("WEB-002-HDR: SessionHeaderServer — bandeau session côté serveur", () => {
  it("WEB-002-HDR: session vérifiée → SessionHeader avec nom, rôle et agence résolue", async () => {
    readVerifiedSession.mockResolvedValue({ token: "raw.jwt.token", claims: CLAIMS });
    resolveAgencyLabel.mockResolvedValue("Agence Plateau");
    const tree = await SessionHeaderServer({ locale: "fr" });
    const header = findElementByType(tree, SessionHeader);
    expect(header).not.toBeNull();
    expect(header?.props["name"]).toBe("Awa Koné");
    expect(header?.props["role"]).toBe("AGENT");
    expect(header?.props["agencyLabel"]).toBe("Agence Plateau");
    // La résolution reçoit la session vérifiée complète (Bearer côté serveur).
    expect(resolveAgencyLabel).toHaveBeenCalledWith({ token: "raw.jwt.token", claims: CLAIMS });
  });

  it("WEB-002-HDR: sans session vérifiée (mode mock) → null, aucune résolution d'agence", async () => {
    readVerifiedSession.mockResolvedValue(null);
    const tree = await SessionHeaderServer({});
    expect(tree).toBeNull();
    expect(resolveAgencyLabel).not.toHaveBeenCalled();
  });

  it("WEB-002-HDR: agence non résolue (0 agence / erreur fail-soft) → agencyLabel null", async () => {
    readVerifiedSession.mockResolvedValue({ token: "raw.jwt.token", claims: { ...CLAIMS, agencyIds: [] } });
    resolveAgencyLabel.mockResolvedValue(null);
    const tree = await SessionHeaderServer({});
    const header = findElementByType(tree, SessionHeader);
    expect(header?.props["agencyLabel"]).toBeNull();
  });

  it("WEB-002-HDR: marque banque d'env transmise (NEXT_PUBLIC_BANK_NAME / _LOGO_URL, repli SIGFA)", async () => {
    readVerifiedSession.mockResolvedValue({ token: "raw.jwt.token", claims: CLAIMS });
    resolveAgencyLabel.mockResolvedValue(null);
    const tree = await SessionHeaderServer({});
    const header = findElementByType(tree, SessionHeader);
    expect(typeof header?.props["bankName"]).toBe("string");
    expect((header?.props["bankName"] as string).length).toBeGreaterThan(0);
    expect(header?.props).toHaveProperty("bankLogoUrl");
  });

  it("S2: le JWT brut ne descend JAMAIS dans l'arbre (seules les données dérivées)", async () => {
    readVerifiedSession.mockResolvedValue({ token: "raw.jwt.token", claims: CLAIMS });
    resolveAgencyLabel.mockResolvedValue("Agence Plateau");
    const tree = await SessionHeaderServer({});
    expect(treeContainsString(tree, "raw.jwt.token")).toBe(false);
  });
});
