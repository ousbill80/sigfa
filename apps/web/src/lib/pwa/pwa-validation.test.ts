/**
 * NOTIF-005-B — tests for PWA input validation.
 * @module lib/pwa/pwa-validation.test
 */
import { describe, it, expect } from "vitest";
import { isValidPhone, normalizePhone, hasPhone } from "./pwa-validation";

describe("NOTIF-005-B: pwa-validation", () => {
  it("treats empty phone as valid (phone is optional)", () => {
    expect(isValidPhone("")).toBe(true);
    expect(isValidPhone("   ")).toBe(true);
  });

  it("accepts plausible E.164 numbers (with spaces)", () => {
    expect(isValidPhone("+2250700000001")).toBe(true);
    expect(isValidPhone("+225 07 00 00 00 01")).toBe(true);
    expect(isValidPhone("0700000001")).toBe(true);
  });

  it("rejects clearly invalid numbers", () => {
    expect(isValidPhone("abc")).toBe(false);
    expect(isValidPhone("+12")).toBe(false);
    expect(isValidPhone("+1234567890123456789")).toBe(false);
  });

  it("normalizePhone strips whitespace", () => {
    expect(normalizePhone("+225 07 00 00")).toBe("+2250700 00".replace(/\s/g, ""));
    expect(normalizePhone("  0700  ")).toBe("0700");
  });

  it("hasPhone reflects presence", () => {
    expect(hasPhone("")).toBe(false);
    expect(hasPhone("   ")).toBe(false);
    expect(hasPhone("+2250700000001")).toBe(true);
  });
});
