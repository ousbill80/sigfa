/**
 * Token refresh API route — silent token refresh using refresh_token cookie.
 *
 * S4 (Boucle 2 F4) : aligné sur LA LOI (`core.yaml` RefreshRequest
 * `{refreshToken}` / AuthTokens camelCase) via le client typé
 * @sigfa/contracts. L'ancien body `{refresh_token}` faisait échouer la
 * rotation contre l'API réelle à chaque appel.
 * @module app/api/auth/refresh/route
 */
import { NextRequest, NextResponse } from "next/server";
import { createSigfaClient } from "@sigfa/contracts";
import { setAuthCookies } from "@/lib/auth-cookies";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4010";

/** POST /api/auth/refresh */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get("refresh_token")?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: "No refresh token" }, { status: 401 });
  }

  try {
    // Client typé @sigfa/contracts — POST /auth/refresh (RefreshRequest → AuthTokens).
    const client = createSigfaClient("core", API_URL);
    const { data, error } = await client.POST("/auth/refresh", {
      body: { refreshToken },
    });

    if (error || !data) {
      // Refresh failed — clear cookies and signal re-login
      const response = NextResponse.json({ error: "Refresh failed" }, { status: 401 });
      response.cookies.delete("access_token");
      response.cookies.delete("refresh_token");
      return response;
    }

    return setAuthCookies(NextResponse.json({ ok: true }), data);
  } catch {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
}
