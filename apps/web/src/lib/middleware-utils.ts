/**
 * Middleware utilities — route auth and RBAC logic (pure, testable).
 * @module lib/middleware-utils
 */

import type { Role } from "./roles";
import { canAccess, getDefaultDashboard } from "./roles";

/** Public routes that don't require auth */
export const PUBLIC_ROUTES = ["/login", "/api/auth/login", "/api/auth/refresh", "/_next", "/favicon.ico"];

/**
 * Determines if a pathname is a public route.
 * @param pathname - The route to check
 * @returns true if public (no auth required)
 */
export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((pub) => pathname === pub || pathname.startsWith(pub));
}

/** Result of auth middleware check */
export type MiddlewareResult =
  | { action: "allow" }
  | { action: "redirect"; url: string }
  | { action: "forbidden"; dashboardUrl: string };

/**
 * Pure function — determines what the middleware should do.
 * @param pathname - Current request pathname
 * @param role - User's role (null if unauthenticated)
 * @param nextUrl - Optional ?next= redirect parameter
 * @returns The action to take
 */
export function checkAccess(
  pathname: string,
  role: Role | null,
  nextUrl?: string
): MiddlewareResult {
  // Public routes always allowed
  if (isPublicRoute(pathname)) {
    return { action: "allow" };
  }

  // No auth → redirect to /login with ?next= param
  if (!role) {
    const next = nextUrl ?? pathname;
    return { action: "redirect", url: `/login?next=${encodeURIComponent(next)}` };
  }

  // Has auth but no permission → 403 with link to their dashboard
  if (!canAccess(role, pathname)) {
    const dashboardUrl = getDefaultDashboard(role);
    return { action: "forbidden", dashboardUrl };
  }

  return { action: "allow" };
}
