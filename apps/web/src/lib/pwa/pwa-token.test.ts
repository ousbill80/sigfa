/**
 * NOTIF-005-B — tests for client-side agency QR token parsing.
 * @module lib/pwa/pwa-token.test
 */
import { describe, it, expect } from "vitest";
import { parseAgencyToken } from "./pwa-token";

/** Builds a `v{n}.{base64url(payload)}.{sig}` token for tests. */
function makeToken(payload: Record<string, unknown>, version = "v2", sig = "sig"): string {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${version}.${b64}.${sig}`;
}

const NOW = 1_760_000_000; // fixed reference (unix seconds)

describe("NOTIF-005-B: parseAgencyToken (client-side sanity, server is authority)", () => {
  it("returns valid for a well-formed non-expired token", () => {
    const token = makeToken({ agencyId: "agency-123", exp: NOW + 3600, keyVersion: 2 });
    const result = parseAgencyToken(token, NOW);
    expect(result).toEqual({
      kind: "valid",
      agencyId: "agency-123",
      keyVersion: 2,
      exp: NOW + 3600,
    });
  });

  it("defaults keyVersion to 1 when absent", () => {
    const token = makeToken({ agencyId: "agency-1", exp: NOW + 100 });
    const result = parseAgencyToken(token, NOW);
    expect(result).toMatchObject({ kind: "valid", keyVersion: 1 });
  });

  it("returns expired (with agencyId) when exp is in the past", () => {
    const token = makeToken({ agencyId: "agency-9", exp: NOW - 1 });
    expect(parseAgencyToken(token, NOW)).toEqual({ kind: "expired", agencyId: "agency-9" });
  });

  it("treats exp exactly at now as expired", () => {
    const token = makeToken({ agencyId: "agency-x", exp: NOW });
    expect(parseAgencyToken(token, NOW).kind).toBe("expired");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["missing parts", "v2.onlyone"],
    ["wrong version prefix", "x2.YWJj.sig"],
    ["empty signature", "v2.YWJj."],
  ])("returns invalid for %s", (_label, input) => {
    expect(parseAgencyToken(input as string | null | undefined, NOW)).toEqual({ kind: "invalid" });
  });

  it("returns invalid when payload is not valid base64/JSON", () => {
    expect(parseAgencyToken("v2.!!!not-base64!!!.sig", NOW)).toEqual({ kind: "invalid" });
  });

  it("returns invalid when agencyId is missing or empty", () => {
    expect(parseAgencyToken(makeToken({ exp: NOW + 10 }), NOW)).toEqual({ kind: "invalid" });
    expect(parseAgencyToken(makeToken({ agencyId: "", exp: NOW + 10 }), NOW)).toEqual({
      kind: "invalid",
    });
  });

  it("returns invalid when exp is missing or not a number", () => {
    expect(parseAgencyToken(makeToken({ agencyId: "a" }), NOW)).toEqual({ kind: "invalid" });
    expect(parseAgencyToken(makeToken({ agencyId: "a", exp: "soon" }), NOW)).toEqual({
      kind: "invalid",
    });
  });

  it("uses Date.now when no reference time given (smoke)", () => {
    const token = makeToken({ agencyId: "a", exp: Math.floor(Date.now() / 1000) + 600 });
    expect(parseAgencyToken(token).kind).toBe("valid");
  });
});
