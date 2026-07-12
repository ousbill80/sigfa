// @vitest-environment node
/**
 * Tests for the /dashboard layout — S2: segment authentifié, le socket temps
 * réel est câblé via AuthenticatedRealtime (cookie vérifié côté serveur).
 * @module app/dashboard/layout.test
 */
import { describe, it, expect } from "vitest";
import { findElementByType } from "@/test/element-tree";
import { AuthenticatedRealtime } from "@/lib/authenticated-realtime";
import DashboardLayout from "./layout";

describe("S2: /dashboard layout", () => {
  it("enveloppe le segment dans AuthenticatedRealtime", () => {
    const tree = DashboardLayout({ children: null });
    expect(findElementByType(tree, AuthenticatedRealtime)).not.toBeNull();
  });
});
