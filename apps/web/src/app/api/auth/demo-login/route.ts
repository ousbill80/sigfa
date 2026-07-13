/**
 * Demo login API route — connexion démo directe par rôle (PHASE DE TEST).
 *
 * Gatée par `SIGFA_DEMO_LOGIN=1` (env serveur) : flag OFF → 404 (fail-closed,
 * garantie prod). Rôle hors liste fermée → 400. Mot de passe env absent → 404
 * (indistinguable du flag OFF — aucune fuite de configuration). Succès →
 * login RÉEL contre l'API via le même mécanisme que /api/auth/login
 * (client typé @sigfa/contracts + setAuthCookies partagés dans lib/auth-login).
 * Aucun secret ne transite vers le client : le body ne contient que {role}.
 * @module app/api/auth/demo-login/route
 */
import { NextRequest, NextResponse } from "next/server";
import { isDemoLoginEnabled, isDemoLoginRole, getDemoCredentials } from "@/lib/demo-login";
import { loginAndSetCookies } from "@/lib/auth-login";

/** POST /api/auth/demo-login — body {role} */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isDemoLoginEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let role: unknown;
  try {
    const body = (await request.json()) as { role?: unknown };
    role = body.role;
  } catch {
    return NextResponse.json({ error: "Role required" }, { status: 400 });
  }

  if (!isDemoLoginRole(role)) {
    return NextResponse.json({ error: "Unknown role" }, { status: 400 });
  }

  const credentials = getDemoCredentials(role);
  if (credentials === null) {
    // Mot de passe env absent → même réponse que flag OFF (fail-closed).
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return loginAndSetCookies(credentials.email, credentials.password);
}
