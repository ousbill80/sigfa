/**
 * Tests for the ADM-001b theming route RBAC rule added to roles.ts.
 * The /admin/theming route is BANK_ADMIN+ incl. AGENCY_DIRECTOR (theming =
 * habillage, BANK_ADMIN+), and AGENT / MANAGER / AUDITOR are denied.
 * @module lib/adm-theme-route.test
 */
import { describe, it, expect } from "vitest";
import { canAccess, ROUTE_PERMISSIONS } from "./roles";

describe("roles — /admin/theming (ADM-001b)", () => {
  it("ADM-001b: la route /admin/theming existe et cible BANK_ADMIN+/AGENCY_DIRECTOR", () => {
    expect(ROUTE_PERMISSIONS["/admin/theming"]).toEqual(
      expect.arrayContaining(["SUPER_ADMIN", "BANK_ADMIN", "AGENCY_DIRECTOR"]),
    );
  });

  it("ADM-001b: BANK_ADMIN, SUPER_ADMIN, AGENCY_DIRECTOR accèdent à /admin/theming", () => {
    expect(canAccess("BANK_ADMIN", "/admin/theming")).toBe(true);
    expect(canAccess("SUPER_ADMIN", "/admin/theming")).toBe(true);
    // AGENCY_DIRECTOR n'accède pas à /admin mais accède bien à /admin/theming
    // (le préfixe le plus spécifique gagne).
    expect(canAccess("AGENCY_DIRECTOR", "/admin/theming")).toBe(true);
  });

  it("ADM-001b: AGENT / MANAGER / AUDITOR → refusés sur /admin/theming", () => {
    expect(canAccess("AGENT", "/admin/theming")).toBe(false);
    expect(canAccess("MANAGER", "/admin/theming")).toBe(false);
    expect(canAccess("AUDITOR", "/admin/theming")).toBe(false);
  });
});
