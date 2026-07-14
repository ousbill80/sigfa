/**
 * Logout API route — purge les cookies httpOnly et redirige vers /login.
 *
 * WEB-002-HDR : cible du <form method="post"> du SessionHeader (aucun JS
 * client requis). Révoque le refresh token côté API (POST /auth/logout,
 * route de contrat existante) en best-effort via lib/auth-logout, puis purge
 * les cookies `access_token` / `refresh_token` et répond 303 /login.
 * @module app/api/auth/logout/route
 */
import { NextRequest, NextResponse } from "next/server";
import { logoutAndClearCookies } from "@/lib/auth-logout";

/** POST /api/auth/logout */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get("refresh_token")?.value;
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return logoutAndClearCookies(refreshToken, loginUrl);
}
