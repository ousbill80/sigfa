/**
 * Auth helpers — JWT decode (client-side, no verification) and token management.
 * @module lib/auth
 */

import type { Role } from "./roles";

/** JWT payload shape for SIGFA tokens */
export interface JWTPayload {
  sub: string;
  role: Role;
  tenantId: string;
  exp: number;
  iat?: number;
}

/**
 * Decodes a JWT payload without verification (client-side only).
 * Server-side verification is done in middleware with jose.
 * @param token - The JWT string
 * @returns The decoded payload or null if invalid
 */
export function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    if (!payload) return null;
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return decoded as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Returns true if the token is expired or will expire within the buffer window.
 * @param payload - The decoded JWT payload
 * @param bufferSeconds - Seconds before expiry to consider as "about to expire"
 * @returns true if expired or expiring soon
 */
export function isTokenExpired(payload: JWTPayload, bufferSeconds = 60): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return payload.exp <= nowSeconds + bufferSeconds;
}

/**
 * Checks if a token needs silent refresh (within 15 minutes of expiry).
 * @param payload - The decoded JWT payload
 * @returns true if the token needs refresh
 */
export function needsRefresh(payload: JWTPayload): boolean {
  return isTokenExpired(payload, 15 * 60); // 15 minutes buffer
}
