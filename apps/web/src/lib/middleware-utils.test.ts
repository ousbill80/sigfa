/**
 * Tests for middleware utilities — WEB-001
 * @module lib/middleware-utils.test
 */
import { describe, it, expect } from "vitest";
import { checkAccess, isPublicRoute } from "./middleware-utils";

describe("WEB-001: middleware auth", () => {
  describe("WEB-001: redirect /login + ?next= sur route protégée sans JWT", () => {
    it("redirects unauthenticated user to /login with ?next= param", () => {
      const result = checkAccess("/dashboard", null);
      expect(result.action).toBe("redirect");
      if (result.action === "redirect") {
        expect(result.url).toBe("/login?next=%2Fdashboard");
      }
    });

    it("redirects to /login with correct next= encoding", () => {
      const result = checkAccess("/dashboard/manager", null);
      expect(result.action).toBe("redirect");
      if (result.action === "redirect") {
        expect(result.url).toContain("/login?next=");
        expect(result.url).toContain("dashboard");
      }
    });
  });

  describe("isPublicRoute", () => {
    it("allows /login", () => {
      expect(isPublicRoute("/login")).toBe(true);
    });

    it("allows /_next/static/...", () => {
      expect(isPublicRoute("/_next/static/css/app.css")).toBe(true);
    });

    it("blocks /dashboard", () => {
      expect(isPublicRoute("/dashboard")).toBe(false);
    });
  });

  describe("RBAC enforcement in middleware", () => {
    it("WEB-001: RBAC AGENT — forbidden on /dashboard/manager", () => {
      const result = checkAccess("/dashboard/manager", "AGENT");
      expect(result.action).toBe("forbidden");
    });

    it("WEB-001: RBAC AUDITOR — forbidden on /agent", () => {
      const result = checkAccess("/agent", "AUDITOR");
      expect(result.action).toBe("forbidden");
    });

    it("WEB-001: RBAC MANAGER — forbidden on /admin", () => {
      const result = checkAccess("/admin", "MANAGER");
      expect(result.action).toBe("forbidden");
    });

    it("allows AGENT on /dashboard/agent", () => {
      const result = checkAccess("/dashboard/agent", "AGENT");
      expect(result.action).toBe("allow");
    });

    it("forbidden result includes dashboardUrl for user's role", () => {
      const result = checkAccess("/admin", "AGENT");
      expect(result.action).toBe("forbidden");
      if (result.action === "forbidden") {
        expect(result.dashboardUrl).toBe("/dashboard/agent");
      }
    });
  });
});
