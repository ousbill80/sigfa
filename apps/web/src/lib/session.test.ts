// @vitest-environment node
/**
 * Tests for lib/session — S1 (Boucle 2 F4): JWT signature verification.
 * A cookie is a session ONLY if its signature verifies (jose, HS256 explicit,
 * same policy as apps/api SEC-F3-09). Forged / wrong-secret / wrong-alg /
 * expired / malformed tokens are all rejected.
 * @module lib/session.test
 */
import { describe, it, expect } from "vitest";
import { verifySessionToken, getJwtSecret } from "./session";
import {
  TEST_JWT_SECRET,
  WRONG_JWT_SECRET,
  secretBytes,
  signTestToken,
  forgeToken,
} from "@/test/jwt-helpers";

const SECRET = secretBytes(TEST_JWT_SECRET);

describe("S1: verifySessionToken — signature obligatoire", () => {
  it("accepte un token HS256 correctement signé et expose les claims", async () => {
    const token = await signTestToken({
      sub: "user-1",
      role: "AGENT",
      bankId: "bank-1",
      agencyIds: ["agency-1", "agency-2"],
    });
    const claims = await verifySessionToken(token, SECRET);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe("user-1");
    expect(claims?.role).toBe("AGENT");
    expect(claims?.bankId).toBe("bank-1");
    expect(claims?.agencyIds).toEqual(["agency-1", "agency-2"]);
  });

  it("S1: rejette un cookie FORGÉ {role: SUPER_ADMIN} (signature bidon)", async () => {
    const forged = forgeToken({ role: "SUPER_ADMIN" });
    expect(await verifySessionToken(forged, SECRET)).toBeNull();
  });

  it("S1: rejette un token signé avec un AUTRE secret", async () => {
    const token = await signTestToken({ role: "SUPER_ADMIN" }, { secret: WRONG_JWT_SECRET });
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });

  it("S1: rejette un token signé avec un algorithme ≠ HS256 (HS512)", async () => {
    const token = await signTestToken({ role: "AGENT" }, { alg: "HS512" });
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });

  it("S1: rejette un token expiré même correctement signé", async () => {
    const token = await signTestToken({ role: "AGENT" }, { expiresIn: "-1m" });
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });

  it("rejette un token malformé / absent", async () => {
    expect(await verifySessionToken("not-a-jwt", SECRET)).toBeNull();
    expect(await verifySessionToken("", SECRET)).toBeNull();
    expect(await verifySessionToken(undefined, SECRET)).toBeNull();
  });

  it("rejette un token signé dont le rôle n'est pas un rôle SIGFA", async () => {
    const token = await signTestToken({ role: "ROOT" });
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });

  it("fail-closed : sans secret configuré, aucun token n'est accepté", async () => {
    const token = await signTestToken({ role: "AGENT" });
    expect(await verifySessionToken(token, null)).toBeNull();
  });

  it("normalise les claims tenant absents (bankId null, agencyIds [])", async () => {
    const token = await signTestToken({ role: "SUPER_ADMIN" });
    const claims = await verifySessionToken(token, SECRET);
    expect(claims?.bankId).toBeNull();
    expect(claims?.agencyIds).toEqual([]);
  });
});

describe("S1: getJwtSecret — politique JWT_SECRET (≥32 caractères, comme apps/api)", () => {
  it("retourne les octets du secret quand JWT_SECRET est valide", () => {
    const bytes = getJwtSecret({ JWT_SECRET: TEST_JWT_SECRET });
    expect(bytes).not.toBeNull();
    expect(bytes?.length).toBe(TEST_JWT_SECRET.length);
  });

  it("retourne null si JWT_SECRET absent", () => {
    expect(getJwtSecret({})).toBeNull();
  });

  it("retourne null si JWT_SECRET trop court (<32)", () => {
    expect(getJwtSecret({ JWT_SECRET: "short" })).toBeNull();
  });
});
