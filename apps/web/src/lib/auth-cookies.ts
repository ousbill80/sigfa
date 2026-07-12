/**
 * auth-cookies — pose des cookies httpOnly depuis les AuthTokens du CONTRAT.
 *
 * S4 (Boucle 2 F4) : la seule forme acceptée est celle de LA LOI
 * (`core.yaml` AuthTokens : accessToken/refreshToken/expiresIn en camelCase).
 * Partagé par /api/auth/login et /api/auth/refresh.
 * @module lib/auth-cookies
 */
import type { NextResponse } from "next/server";

/** AuthTokens de contrat (camelCase — core.yaml). */
export interface AuthTokens {
  /** JWT access token (15 min). */
  accessToken: string;
  /** JWT refresh token (7 j, rotation). */
  refreshToken: string;
  /** Durée de vie de l'access token en secondes. */
  expiresIn: number;
}

/** Durée de vie du cookie refresh (7 jours — contrat : rotation 7 j). */
export const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

/**
 * Pose les cookies httpOnly access/refresh depuis les AuthTokens du contrat.
 * @param response - Réponse à décorer.
 * @param tokens - AuthTokens (camelCase) retournés par l'API.
 * @returns La réponse décorée.
 */
export function setAuthCookies(response: NextResponse, tokens: AuthTokens): NextResponse {
  const secure = process.env["NODE_ENV"] === "production";
  response.cookies.set("access_token", tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: tokens.expiresIn,
    path: "/",
  });
  response.cookies.set("refresh_token", tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: REFRESH_COOKIE_MAX_AGE,
    path: "/",
  });
  return response;
}
