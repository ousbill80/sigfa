/**
 * Tests for RBAC role helpers — WEB-001
 * @module lib/roles.test
 */
import { describe, it, expect } from "vitest";
import { canAccess, getDefaultDashboard, ROLES } from "./roles";

describe("WEB-001: RBAC", () => {
  describe("canAccess", () => {
    it("WEB-001: RBAC AGENT — /dashboard/manager retourne 403", () => {
      expect(canAccess("AGENT", "/dashboard/manager")).toBe(false);
    });

    it("WEB-001: RBAC AUDITOR — /agent retourne 403", () => {
      expect(canAccess("AUDITOR", "/agent")).toBe(false);
    });

    it("WEB-003: RBAC AUDITOR — /dashboard/manager autorisé (lecture seule)", () => {
      expect(canAccess("AUDITOR", "/dashboard/manager")).toBe(true);
    });

    it("WEB-003: RBAC AGENT — /dashboard/manager retourne 403", () => {
      expect(canAccess("AGENT", "/dashboard/manager")).toBe(false);
    });

    it("WEB-002: RBAC AGENT — /agent autorisé (interface guichet)", () => {
      expect(canAccess("AGENT", "/agent")).toBe(true);
    });

    it("WEB-001: RBAC MANAGER — /admin retourne 403", () => {
      expect(canAccess("MANAGER", "/admin")).toBe(false);
    });

    it("WEB-004: RBAC AGENT → /dashboard/network retourne 403", () => {
      expect(canAccess("AGENT", "/dashboard/network")).toBe(false);
    });

    it("WEB-004: RBAC BANK_ADMIN — /dashboard/network autorisé (périmètre JWT)", () => {
      expect(canAccess("BANK_ADMIN", "/dashboard/network")).toBe(true);
    });

    it("WEB-004: RBAC AGENCY_DIRECTOR — /dashboard/network autorisé", () => {
      expect(canAccess("AGENCY_DIRECTOR", "/dashboard/network")).toBe(true);
    });

    it("SEC-001b: RBAC /audit — AUDITOR et SUPER_ADMIN autorisés (lecture seule)", () => {
      expect(canAccess("AUDITOR", "/audit")).toBe(true);
      expect(canAccess("SUPER_ADMIN", "/audit")).toBe(true);
    });

    it("SEC-001b: RBAC /audit — MANAGER / AGENT / AGENCY_DIRECTOR refusés (403)", () => {
      expect(canAccess("MANAGER", "/audit")).toBe(false);
      expect(canAccess("AGENT", "/audit")).toBe(false);
      expect(canAccess("AGENCY_DIRECTOR", "/audit")).toBe(false);
    });

    it("WEB-004: RBAC MANAGER — /dashboard/network retourne 403 (non direction réseau)", () => {
      expect(canAccess("MANAGER", "/dashboard/network")).toBe(false);
    });

    it("WEB-005: RBAC AGENT → /dashboard/comex retourne 403", () => {
      expect(canAccess("AGENT", "/dashboard/comex")).toBe(false);
    });

    it("WEB-005: RBAC MANAGER → /dashboard/comex retourne 403", () => {
      expect(canAccess("MANAGER", "/dashboard/comex")).toBe(false);
    });

    it("WEB-005: RBAC AGENCY_DIRECTOR → /dashboard/comex retourne 403 (BANK_ADMIN+ uniquement)", () => {
      expect(canAccess("AGENCY_DIRECTOR", "/dashboard/comex")).toBe(false);
    });

    it("WEB-005: RBAC BANK_ADMIN — /dashboard/comex autorisé", () => {
      expect(canAccess("BANK_ADMIN", "/dashboard/comex")).toBe(true);
    });

    it("WEB-005: RBAC SUPER_ADMIN — /dashboard/comex autorisé", () => {
      expect(canAccess("SUPER_ADMIN", "/dashboard/comex")).toBe(true);
    });

    it("IA-005: RBAC AGENT → /dashboard/insights retourne 403", () => {
      expect(canAccess("AGENT", "/dashboard/insights")).toBe(false);
    });

    it("IA-005: RBAC MANAGER → /dashboard/insights retourne 403", () => {
      expect(canAccess("MANAGER", "/dashboard/insights")).toBe(false);
    });

    it("IA-005: RBAC AGENCY_DIRECTOR — /dashboard/insights autorisé (DIRECTOR+)", () => {
      expect(canAccess("AGENCY_DIRECTOR", "/dashboard/insights")).toBe(true);
    });

    it("IA-005: RBAC BANK_ADMIN — /dashboard/insights autorisé (réseau)", () => {
      expect(canAccess("BANK_ADMIN", "/dashboard/insights")).toBe(true);
    });

    it("REP-003b: RBAC AGENT → /dashboard/reports retourne 403", () => {
      expect(canAccess("AGENT", "/dashboard/reports")).toBe(false);
    });

    it("REP-003b: RBAC MANAGER → /dashboard/reports retourne 403", () => {
      expect(canAccess("MANAGER", "/dashboard/reports")).toBe(false);
    });

    it("REP-003b: RBAC AGENCY_DIRECTOR — /dashboard/reports autorisé", () => {
      expect(canAccess("AGENCY_DIRECTOR", "/dashboard/reports")).toBe(true);
    });

    it("REP-003b: RBAC AUDITOR — /dashboard/reports autorisé", () => {
      expect(canAccess("AUDITOR", "/dashboard/reports")).toBe(true);
    });

    it("REP-003b: RBAC BANK_ADMIN — /dashboard/reports autorisé", () => {
      expect(canAccess("BANK_ADMIN", "/dashboard/reports")).toBe(true);
    });

    it("SUPER_ADMIN has access to all routes", () => {
      expect(canAccess("SUPER_ADMIN", "/admin")).toBe(true);
      expect(canAccess("SUPER_ADMIN", "/dashboard/manager")).toBe(true);
      expect(canAccess("SUPER_ADMIN", "/agent")).toBe(true);
      expect(canAccess("SUPER_ADMIN", "/audit")).toBe(true);
    });

    it("AGENT can access /dashboard/agent", () => {
      expect(canAccess("AGENT", "/dashboard/agent")).toBe(true);
    });

    it("AUDITOR can access /audit", () => {
      expect(canAccess("AUDITOR", "/audit")).toBe(true);
    });
  });

  describe("getDefaultDashboard", () => {
    it("returns /admin for SUPER_ADMIN", () => {
      expect(getDefaultDashboard("SUPER_ADMIN")).toBe("/admin");
    });

    it("returns /dashboard/manager for MANAGER", () => {
      expect(getDefaultDashboard("MANAGER")).toBe("/dashboard/manager");
    });

    it("returns /dashboard/agent for AGENT", () => {
      expect(getDefaultDashboard("AGENT")).toBe("/dashboard/agent");
    });

    it("returns /audit for AUDITOR", () => {
      expect(getDefaultDashboard("AUDITOR")).toBe("/audit");
    });
  });

  describe("ROLES constant", () => {
    it("contains exactly 6 roles", () => {
      expect(ROLES).toHaveLength(6);
    });
  });
});
