/**
 * Test helpers — signed / forged JWT factories for the security suite (S1/S2/S3).
 *
 * Signs real HS256 tokens with jose (same policy as apps/api, SEC-F3-09) and
 * builds forged tokens (valid-looking payload, garbage signature) to prove the
 * middleware rejects them. Node-env only (jose realm constraint under jsdom).
 * @module test/jwt-helpers
 */
import { SignJWT } from "jose";

/** Test secret — ≥32 chars (same minimum as apps/api JWT_SECRET policy). */
export const TEST_JWT_SECRET = "sigfa-test-secret-0123456789-abcdefghijklmnop";

/** A different (attacker) secret of valid length. */
export const WRONG_JWT_SECRET = "attacker-secret-0123456789-abcdefghijklmnopqr";

/** Encodes a secret string for jose (node realm Uint8Array). */
export function secretBytes(secret: string): Uint8Array {
  return new Uint8Array(Buffer.from(secret, "utf-8"));
}

/** Claims accepted by the signers below. */
export interface TestClaims {
  sub?: string;
  role?: string;
  bankId?: string;
  agencyIds?: string[];
}

/**
 * Signs a JWT with the given algorithm and secret (default: valid HS256 token).
 * @param claims - Payload claims.
 * @param options - Optional secret / algorithm / expiration overrides.
 * @returns The compact JWT.
 */
export async function signTestToken(
  claims: TestClaims,
  options: { secret?: string; alg?: string; expiresIn?: string } = {}
): Promise<string> {
  const { secret = TEST_JWT_SECRET, alg = "HS256", expiresIn = "15m" } = options;
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg })
    .setSubject(claims.sub ?? "user-1")
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretBytes(secret));
}

/**
 * Builds a FORGED token: attacker-controlled payload, garbage signature.
 * This is exactly the cookie the S1 finding proved could cross the RBAC.
 * @param claims - Attacker payload (e.g. role SUPER_ADMIN).
 * @returns The forged compact JWT.
 */
export function forgeToken(claims: TestClaims & { exp?: number }): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: "attacker", exp: 9999999999, ...claims })
  ).toString("base64url");
  return `${header}.${payload}.forged-signature`;
}
