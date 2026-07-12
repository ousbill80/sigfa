/**
 * Login API route — validates credentials and sets httpOnly JWT cookies.
 *
 * S4 (Boucle 2 F4) : aligné sur LA LOI (`core.yaml` AuthTokens en camelCase :
 * accessToken/refreshToken/expiresIn) via le client typé @sigfa/contracts —
 * plus de fetch brut ni de lecture snake_case qui posait des cookies
 * `undefined` contre l'API réelle.
 * @module app/api/auth/login/route
 */
import { NextRequest, NextResponse } from "next/server";
import { createSigfaClient } from "@sigfa/contracts";
import { setAuthCookies } from "@/lib/auth-cookies";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4010";

/** POST /api/auth/login */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let email: string | undefined;
  let password: string | undefined;
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    email = body.email;
    password = body.password;
  } catch {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

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
