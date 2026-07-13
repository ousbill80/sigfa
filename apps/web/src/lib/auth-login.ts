/**
 * auth-login — mécanisme UNIQUE de login contre l'API de contrat.
 *
 * Extrait de /api/auth/login (S4, Boucle 2 F4) pour être partagé avec
 * /api/auth/demo-login : client typé @sigfa/contracts (`core.yaml`,
 * POST /auth/login : LoginRequest → AuthTokens camelCase) puis pose des
 * cookies httpOnly via setAuthCookies — aucune duplication de la pose de
 * cookies ni du dialogue de contrat.
 * @module lib/auth-login
 */
import { NextResponse } from "next/server";
import { createSigfaClient } from "@sigfa/contracts";
import { setAuthCookies } from "@/lib/auth-cookies";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4010";

/**
 * Authentifie {email, password} contre l'API et pose les cookies httpOnly.
 * @param email - Email de connexion
 * @param password - Mot de passe
 * @returns 200 {ok:true} + cookies ; 401 identifiants refusés ; 503 API injoignable
 */
export async function loginAndSetCookies(
  email: string,
  password: string
): Promise<NextResponse> {
  try {
    // Client typé @sigfa/contracts — POST /auth/login (LoginRequest → AuthTokens).
    const client = createSigfaClient("core", API_URL);
    const { data, error } = await client.POST("/auth/login", {
      body: { email, password },
    });

    if (error || !data) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    return setAuthCookies(NextResponse.json({ ok: true }), data);
  } catch {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
}
