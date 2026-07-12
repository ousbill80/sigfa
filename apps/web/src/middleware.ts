/**
 * Next.js middleware — JWT auth verification and RBAC enforcement.
 *
 * S1 (Boucle 2 F4) : la signature du JWT est VÉRIFIÉE (jose `jwtVerify`,
 * HS256 explicite — même politique que l'API, SEC-F3-09) AVANT toute
 * extraction de rôle. Un cookie forgé, signé avec un autre secret/algorithme,
 * expiré ou malformé = non authentifié → redirection /login. Fail-closed :
 * sans JWT_SECRET configuré, aucun token n'est accepté.
 *
 * Runtime edge : jose y est compatible (raison de son choix).
 * @module middleware
 */
import { NextRequest, NextResponse } from "next/server";
import { checkAccess } from "@/lib/middleware-utils";
import { getJwtSecret, verifySessionToken } from "@/lib/session";

/** Next.js middleware handler */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Vérification cryptographique AVANT lecture du rôle (S1).
  const token = request.cookies.get("access_token")?.value;
  const claims = await verifySessionToken(token, getJwtSecret());
  const role = claims?.role ?? null;

  const result = checkAccess(pathname, role);

  if (result.action === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (result.action === "forbidden") {
    const url = request.nextUrl.clone();
    url.pathname = "/forbidden";
    url.searchParams.set("dashboard", result.dashboardUrl);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth|api/rt).*)",
  ],
};
