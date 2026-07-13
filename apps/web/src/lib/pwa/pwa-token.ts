/**
 * NOTIF-005-B — client-side sanity parsing of the signed agency QR token.
 *
 * The `signedAgencyToken` (CONTRACT-013 / NOTIF-005-A) is an HMAC-SHA256 token
 * over `{ agencyId, exp, keyVersion }`, TTL 30 days, versioned rotating key.
 * The SERVER is the sole authority on validity (signature is verified on ticket
 * emission). This module performs ONLY a non-cryptographic, best-effort decode
 * so the PWA can show a HUMAN error screen instead of crashing when a token is
 * obviously malformed or already past its `exp` — never a security decision.
 *
 * Token shape accepted (aligned on the additif): `v{n}.{base64url(payload)}.{sig}`
 * where payload is `{ agencyId: string, exp: number (unix seconds), keyVersion?: number }`.
 *
 * @module lib/pwa/pwa-token
 */

/** Result of a best-effort client-side token decode. */
export type PwaTokenResult =
  | { readonly kind: "valid"; readonly agencyId: string; readonly keyVersion: number; readonly exp: number }
  | { readonly kind: "expired"; readonly agencyId: string }
  | { readonly kind: "invalid" };

/** Decoded payload shape expected inside the token. */
interface TokenPayload {
  agencyId?: unknown;
  exp?: unknown;
  keyVersion?: unknown;
}

/** Decodes a base64url segment to a UTF-8 string, or `null` on failure. */
function decodeBase64Url(segment: string): string | null {
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    // atob exists in browser + jsdom; Buffer fallback keeps SSR/tests safe.
    if (typeof atob === "function") {
      return decodeURIComponent(
        Array.from(atob(padded))
          .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
          .join(""),
      );
    }
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

/**
 * Best-effort client-side decode of a signed agency QR token.
 *
 * @param token - Raw token string from the `/q/[token]` route (URL-decoded).
 * @param nowSeconds - Reference time in unix seconds (default `Date.now()`).
 * @returns A discriminated result: `valid`, `expired`, or `invalid`.
 */
export function parseAgencyToken(
  token: string | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): PwaTokenResult {
  if (!token || typeof token !== "string") return { kind: "invalid" };

  const parts = token.split(".");
  if (parts.length !== 3) return { kind: "invalid" };

  const [version, payloadPart, signature] = parts;
  if (!version || !payloadPart || !signature) return { kind: "invalid" };
  // Version prefix must look like `v{digits}` (rotating key version marker).
  if (!/^v\d+$/.test(version)) return { kind: "invalid" };

  const json = decodeBase64Url(payloadPart);
  if (json === null) return { kind: "invalid" };

  let payload: TokenPayload;
  try {
    payload = JSON.parse(json) as TokenPayload;
  } catch {
    return { kind: "invalid" };
  }

  const { agencyId, exp, keyVersion } = payload;
  if (typeof agencyId !== "string" || agencyId.length === 0) {
    return { kind: "invalid" };
  }
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    return { kind: "invalid" };
  }

  if (exp <= nowSeconds) {
    return { kind: "expired", agencyId };
  }

  const resolvedKeyVersion =
    typeof keyVersion === "number" && Number.isFinite(keyVersion) ? keyVersion : 1;

  return { kind: "valid", agencyId, keyVersion: resolvedKeyVersion, exp };
}
