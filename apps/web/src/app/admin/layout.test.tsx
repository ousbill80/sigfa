// @vitest-environment node
/**
 * Tests for the /admin layout — S2: segment authentifié, le socket temps réel
 * est câblé via AuthenticatedRealtime (cookie vérifié côté serveur).
 * @module app/admin/layout.test
 */
import { describe, it, expect } from "vitest";
import { findElementByType } from "@/test/element-tree";
import { AuthenticatedRealtime } from "@/lib/authenticated-realtime";
import AdminLayout from "./layout";

describe("S2: /admin layout", () => {
  it("enveloppe le segment dans AuthenticatedRealtime", () => {
    const tree = AdminLayout({ children: null });
    expect(findElementByType(tree, AuthenticatedRealtime)).not.toBeNull();
  });
});
