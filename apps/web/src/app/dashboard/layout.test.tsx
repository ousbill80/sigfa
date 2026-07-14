// @vitest-environment node
/**
 * Tests for the /dashboard layout — S2: segment authentifié, le socket temps
 * réel est câblé via AuthenticatedRealtime (cookie vérifié côté serveur).
 * WEB-002-HDR : bandeau session partagé (marque banque + utilisateur + agence
 * de rattachement + déconnexion) monté pour les dashboards manager/COMEX.
 * @module app/dashboard/layout.test
 */
import { describe, it, expect } from "vitest";
import { findElementByType } from "@/test/element-tree";
import { AuthenticatedRealtime } from "@/lib/authenticated-realtime";
import { SessionHeaderServer } from "@/components/ui/session-header-server";
import DashboardLayout from "./layout";

describe("S2: /dashboard layout", () => {
  it("enveloppe le segment dans AuthenticatedRealtime", () => {
    const tree = DashboardLayout({ children: null });
    expect(findElementByType(tree, AuthenticatedRealtime)).not.toBeNull();
  });

  it("WEB-002-HDR: monte le bandeau session serveur partagé (SessionHeaderServer)", () => {
    const tree = DashboardLayout({ children: null });
    expect(findElementByType(tree, SessionHeaderServer)).not.toBeNull();
  });
});
