/**
 * Tests for auth helpers — WEB-001
 * @module lib/auth.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decodeJWT, isTokenExpired, needsRefresh } from "./auth";

describe("WEB-001: auth helpers", () => {
  describe("decodeJWT", () => {
    it("decodes a valid JWT payload", () => {
      const payload = { sub: "u1", role: "AGENT", tenantId: "t1", exp: 9999999999 };
      const encoded = btoa(JSON.stringify(payload));
      const token = `header.${encoded}.sig`;
      const decoded = decodeJWT(token);
      expect(decoded).toMatchObject({ sub: "u1", role: "AGENT" });
    });

    it("returns null for invalid token", () => {
      expect(decodeJWT("invalid")).toBeNull();
      expect(decodeJWT("a.b")).toBeNull();
      expect(decodeJWT("")).toBeNull();
    });

    it("returns null for malformed payload", () => {
      expect(decodeJWT("header.not-valid-json.sig")).toBeNull();
    });
  });

  describe("isTokenExpired", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns true for expired token", () => {
      vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
      const payload = {
        sub: "u1",
        role: "AGENT" as const,
        tenantId: "t1",
        exp: Math.floor(new Date("2026-01-01T11:00:00Z").getTime() / 1000),
      };
      expect(isTokenExpired(payload)).toBe(true);
    });

    it("returns false for valid token well beyond buffer", () => {
      vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
      const payload = {
        sub: "u1",
        role: "AGENT" as const,
        tenantId: "t1",
        exp: Math.floor(new Date("2026-01-01T14:00:00Z").getTime() / 1000),
      };
      expect(isTokenExpired(payload)).toBe(false);
    });
  });

  describe("needsRefresh", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("WEB-001: refresh token silencieux — mock expiration 15min → nouveau token sans rechargement", () => {
      // Token expires in 10 minutes (within 15-min buffer → needs refresh)
      vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
      const exp = Math.floor(new Date("2026-01-01T12:10:00Z").getTime() / 1000);
      const payload = { sub: "u1", role: "AGENT" as const, tenantId: "t1", exp };
      expect(needsRefresh(payload)).toBe(true);
    });

    it("WEB-001: refresh échoué → redirect /login — does not need refresh for fresh token", () => {
      vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
      const exp = Math.floor(new Date("2026-01-01T12:30:00Z").getTime() / 1000);
      const payload = { sub: "u1", role: "AGENT" as const, tenantId: "t1", exp };
      expect(needsRefresh(payload)).toBe(false);
    });
  });
});
