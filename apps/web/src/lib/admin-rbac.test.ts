/**
 * Tests for admin-rbac (WEB-006) — RBAC matrix of the admin console.
 * @module lib/admin-rbac.test
 */
import { describe, it, expect } from "vitest";
import {
  canReachAdmin,
  canAccessSection,
  canEditBankWide,
  canScopeAgency,
  visibleSections,
  SECTION_MIN_ROLE,
  type AdminSection,
} from "./admin-rbac";
import type { Role } from "./roles";

const ALL_SECTIONS = Object.keys(SECTION_MIN_ROLE) as AdminSection[];

describe("admin-rbac — RBAC console", () => {
  it("WEB-006: RBAC AGENT/AUDITOR → 403 sur /admin/* (aucune section atteignable)", () => {
    for (const role of ["AGENT", "AUDITOR"] as Role[]) {
      expect(canReachAdmin(role)).toBe(false);
      for (const section of ALL_SECTIONS) {
        expect(canAccessSection(role, section)).toBe(false);
      }
      expect(visibleSections(role)).toEqual([]);
      expect(canEditBankWide(role)).toBe(false);
      expect(canScopeAgency(role, "a1", "a1")).toBe(false);
    }
  });

  it("WEB-006: RBAC AGENCY_DIRECTOR — services de son agence uniquement", () => {
    // Peut gérer services/guichets/agents mais scoped à son agence.
    expect(canAccessSection("AGENCY_DIRECTOR", "services")).toBe(true);
    expect(canAccessSection("AGENCY_DIRECTOR", "counters")).toBe(true);
    expect(canAccessSection("AGENCY_DIRECTOR", "agents")).toBe(true);
    // Sa propre agence → OK, une autre agence → refusé.
    expect(canScopeAgency("AGENCY_DIRECTOR", "own", "own")).toBe(true);
    expect(canScopeAgency("AGENCY_DIRECTOR", "other", "own")).toBe(false);
    expect(canScopeAgency("AGENCY_DIRECTOR", "own", null)).toBe(false);
    // Config bank-wide (identité, templates, seuils) → interdit à l'AGENCY_DIRECTOR.
    expect(canEditBankWide("AGENCY_DIRECTOR")).toBe(false);
    expect(canAccessSection("AGENCY_DIRECTOR", "identity")).toBe(false);
    expect(canAccessSection("AGENCY_DIRECTOR", "sms-templates")).toBe(false);
  });

  it("WEB-006: BANK_ADMIN atteint toutes les sections et agit sur toute agence", () => {
    expect(canReachAdmin("BANK_ADMIN")).toBe(true);
    for (const section of ALL_SECTIONS) {
      expect(canAccessSection("BANK_ADMIN", section)).toBe(true);
    }
    expect(canEditBankWide("BANK_ADMIN")).toBe(true);
    expect(canScopeAgency("BANK_ADMIN", "any", null)).toBe(true);
    expect(visibleSections("BANK_ADMIN")).toEqual(ALL_SECTIONS);
  });

  it("WEB-006: SUPER_ADMIN hérite de tout (hiérarchie cumulative)", () => {
    expect(canReachAdmin("SUPER_ADMIN")).toBe(true);
    expect(canEditBankWide("SUPER_ADMIN")).toBe(true);
    expect(canScopeAgency("SUPER_ADMIN", "any", null)).toBe(true);
  });

  it("WEB-006: MANAGER atteint seulement les seuils (pas la config bank-wide ni CRUD agence)", () => {
    expect(canReachAdmin("MANAGER")).toBe(true);
    expect(canAccessSection("MANAGER", "thresholds")).toBe(true);
    expect(canAccessSection("MANAGER", "services")).toBe(false);
    expect(canAccessSection("MANAGER", "identity")).toBe(false);
    expect(canEditBankWide("MANAGER")).toBe(false);
    expect(visibleSections("MANAGER")).toEqual(["thresholds"]);
    // MANAGER est aussi scoped à sa propre agence (canScopeAgency).
    expect(canScopeAgency("MANAGER", "own", "own")).toBe(true);
    expect(canScopeAgency("MANAGER", "other", "own")).toBe(false);
  });

  it("WEB-006: SUPER_ADMIN garde toutes les sections visibles (borne haute hiérarchie)", () => {
    expect(visibleSections("SUPER_ADMIN")).toEqual(ALL_SECTIONS);
  });
});
