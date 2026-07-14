// @vitest-environment node
/**
 * Tests for the /agent layout — S2: segment authentifié, le socket temps réel
 * est câblé via AuthenticatedRealtime (cookie vérifié côté serveur).
 * WEB-002-HDR : bandeau session partagé (marque banque + agent + agence de
 * rattachement + déconnexion) assemblé côté serveur par SessionHeaderServer
 * (testé dans components/ui/session-header-server.test — claims dérivés,
 * jamais le token brut).
 * @module app/agent/layout.test
 */
import { describe, it, expect } from "vitest";
import { findElementByType } from "@/test/element-tree";
import { AuthenticatedRealtime } from "@/lib/authenticated-realtime";
import { SessionHeaderServer } from "@/components/ui/session-header-server";
import AgentLayout from "./layout";

describe("S2: /agent layout", () => {
  it("enveloppe le segment dans AuthenticatedRealtime", () => {
    const tree = AgentLayout({ children: null });
    expect(findElementByType(tree, AuthenticatedRealtime)).not.toBeNull();
  });

  it("WEB-002-HDR: monte le bandeau session serveur partagé (SessionHeaderServer)", () => {
    const tree = AgentLayout({ children: null });
    expect(findElementByType(tree, SessionHeaderServer)).not.toBeNull();
  });
});
