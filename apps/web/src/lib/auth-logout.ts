/**
 * auth-logout — mécanisme UNIQUE de déconnexion (WEB-002-HDR).
 *
 * Miroir de lib/auth-login : révoque le refresh token côté API via le client
 * typé @sigfa/contracts (`core.yaml`, POST /auth/logout — route de contrat
 * EXISTANTE, idempotente) en best-effort, puis purge les cookies httpOnly
 * (clearAuthCookies) et redirige vers /login. La purge des cookies n'échoue
 * JAMAIS à cause de l'API : session locale toujours fermée.
 * @module lib/auth-logout
 */
import { NextResponse } from "next/server";
import { createSigfaClient } from "@sigfa/contracts";
import { clearAuthCookies } from "@/lib/auth-cookies";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4010";

/**
 * Révoque le refresh token côté API (best-effort) puis purge les cookies et
 * redirige vers /login (303 — compatible <form method="post">).
 * @param refreshToken - Refresh token opaque lu du cookie httpOnly (ou undefined)
 * @param loginUrl - URL absolue de la page de login (dérivée de la requête)
 * @returns 303 /login + cookies access/refresh purgés
 */
export async function logoutAndClearCookies(
  refreshToken: string | undefined,
  loginUrl: URL
): Promise<NextResponse> {
  if (refreshToken) {
    try {
      // Contrat core.yaml : POST /auth/logout { refreshToken } — idempotent.
      const client = createSigfaClient("core", API_URL);
      await client.POST("/auth/logout", { body: { refreshToken } });
    } catch {
      // Best-effort : API injoignable ⇒ la session locale est quand même fermée.
    }
  }
  return clearAuthCookies(NextResponse.redirect(loginUrl, 303));
}
