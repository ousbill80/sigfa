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

    it("WEB-004: RBAC MANAGER — /dashboard/network retourne 403 (non direction réseau)", () => {
      expect(canAccess("MANAGER", "/dashboard/network")).toBe(false);
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
