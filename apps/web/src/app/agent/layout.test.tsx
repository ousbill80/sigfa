// @vitest-environment node
/**
 * Tests for the /agent layout — S2: segment authentifié, le socket temps réel
 * est câblé via AuthenticatedRealtime (cookie vérifié côté serveur).
 * @module app/agent/layout.test
 */
import { describe, it, expect } from "vitest";
import { findElementByType } from "@/test/element-tree";
import { AuthenticatedRealtime } from "@/lib/authenticated-realtime";
import AgentLayout from "./layout";

describe("S2: /agent layout", () => {
  it("enveloppe le segment dans AuthenticatedRealtime", () => {
    const tree = AgentLayout({ children: null });
    expect(findElementByType(tree, AuthenticatedRealtime)).not.toBeNull();
  });
});
