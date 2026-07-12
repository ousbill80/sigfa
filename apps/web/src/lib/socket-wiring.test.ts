/**
 * Tests du câblage socket serveur (RT-003) — extraction agencyId depuis le JWT.
 * @module lib/socket-wiring.test
 */
import { describe, it, expect } from "vitest";
import { decodeSocketJwt, firstAgencyIdFromToken } from "./socket-wiring";

/** Forge un JWT non signé (payload base64url) pour les tests. */
function forge(payload: Record<string, unknown>): string {
  const b64 = (obj: Record<string, unknown>): string =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

describe("RT-003: socket-wiring", () => {
  it("RT-003: decode extrait le payload agencyIds", () => {
    const token = forge({ sub: "u1", agencyIds: ["ag-1", "ag-2"] });
    expect(decodeSocketJwt(token)).toEqual({
      sub: "u1",
      agencyIds: ["ag-1", "ag-2"],
    });
  });

  it("RT-003: firstAgencyIdFromToken renvoie la 1re agence du scope", () => {
    const token = forge({ agencyIds: ["ag-abc", "ag-def"] });
    expect(firstAgencyIdFromToken(token)).toBe("ag-abc");
  });

  it("RT-003: firstAgencyIdFromToken renvoie null si scope vide", () => {
    expect(firstAgencyIdFromToken(forge({ agencyIds: [] }))).toBeNull();
    expect(firstAgencyIdFromToken(forge({ sub: "u1" }))).toBeNull();
  });

  it("RT-003: token malformé → null (non-crash)", () => {
    expect(decodeSocketJwt("pas-un-jwt")).toBeNull();
    expect(firstAgencyIdFromToken("a.b")).toBeNull();
    expect(firstAgencyIdFromToken("")).toBeNull();
  });
});
