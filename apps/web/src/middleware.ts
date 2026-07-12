/**
 * Next.js middleware — JWT auth verification and RBAC enforcement.
 * @module middleware
 */
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@/lib/roles";
import { checkAccess } from "@/lib/middleware-utils";

/**
 * Extracts and decodes JWT payload from request cookies (without full verification).
 * Real verification uses jose in API routes.
 * @param request - Incoming Next.js request
 * @returns User role or null
 */
function getRoleFromCookie(request: NextRequest): Role | null {
  const token = request.cookies.get("access_token")?.value;
  if (!token) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    if (!payload) return null;
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
    ) as { role?: string; exp?: number };

    // Check expiry
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return (decoded.role as Role) ?? null;
  } catch {
    return null;
  }
}

/** Next.js middleware handler */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const role = getRoleFromCookie(request);
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
