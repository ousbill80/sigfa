/**
 * Login API route — validates credentials and sets httpOnly JWT cookies.
 *
 * S4 (Boucle 2 F4) : aligné sur LA LOI (`core.yaml` AuthTokens en camelCase :
 * accessToken/refreshToken/expiresIn) via le client typé @sigfa/contracts —
 * plus de fetch brut ni de lecture snake_case qui posait des cookies
 * `undefined` contre l'API réelle.
 * Le dialogue de contrat + la pose des cookies vivent dans lib/auth-login
 * (mécanisme UNIQUE, partagé avec /api/auth/demo-login).
 * @module app/api/auth/login/route
 */
import { NextRequest, NextResponse } from "next/server";
import { loginAndSetCookies } from "@/lib/auth-login";

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

  return loginAndSetCookies(email, password);
}
