// @vitest-environment node
/**
 * Tests for the /admin layout — S2: segment authentifié, le socket temps réel
 * est câblé via AuthenticatedRealtime (cookie vérifié côté serveur).
 * WEB-002-HDR : bandeau session partagé (marque banque + utilisateur + agence
 * de rattachement + déconnexion) monté au-dessus de l'AdminShell.
 * @module app/admin/layout.test
 */
import { describe, it, expect } from "vitest";
import { findElementByType } from "@/test/element-tree";
import { AuthenticatedRealtime } from "@/lib/authenticated-realtime";
import { AdminShell } from "@/components/admin/admin-shell";
import { SessionHeaderServer } from "@/components/ui/session-header-server";
import AdminLayout from "./layout";

describe("S2: /admin layout", () => {
  it("enveloppe le segment dans AuthenticatedRealtime", () => {
    const tree = AdminLayout({ children: null });
    expect(findElementByType(tree, AuthenticatedRealtime)).not.toBeNull();
  });

  it("conserve l'AdminShell partagé (DESIGN-FIX-ADMIN)", () => {
    const tree = AdminLayout({ children: null });
    expect(findElementByType(tree, AdminShell)).not.toBeNull();
  });

  it("WEB-002-HDR: monte le bandeau session serveur partagé (SessionHeaderServer)", () => {
    const tree = AdminLayout({ children: null });
    expect(findElementByType(tree, SessionHeaderServer)).not.toBeNull();
  });
});
