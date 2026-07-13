/**
 * RBAC role definitions and permission helpers for SIGFA.
 * @module lib/roles
 */

/** All available roles in the SIGFA system */
export const ROLES = [
  "SUPER_ADMIN",
  "BANK_ADMIN",
  "AGENCY_DIRECTOR",
  "MANAGER",
  "AGENT",
  "AUDITOR",
] as const;

/** Union type of all roles */
export type Role = (typeof ROLES)[number];

/** Route permission matrix — which roles can access which route prefixes */
export const ROUTE_PERMISSIONS: Record<string, Role[]> = {
  // Cross-tenant network supervision console (NET-001-WEB): SUPER_ADMIN ONLY.
  // Every tenant role (BANK_ADMIN / AGENCY_DIRECTOR / MANAGER / AGENT / AUDITOR)
  // → 403. The platform surface is never lowered to a tenant role. Must precede
  // any broader prefix so its match wins.
  "/platform": ["SUPER_ADMIN"],
  "/admin": ["SUPER_ADMIN", "BANK_ADMIN"],
  // AUDITOR reaches the manager dashboard in read-only mode (WEB-003).
  "/dashboard/manager": ["SUPER_ADMIN", "BANK_ADMIN", "AGENCY_DIRECTOR", "MANAGER", "AUDITOR"],
  // Network direction dashboard (WEB-004): BANK_ADMIN / AGENCY_DIRECTOR JWT scope only.
  // AGENT is excluded (→ 403). Must precede "/dashboard" so the prefix match wins.
  "/dashboard/network": ["SUPER_ADMIN", "BANK_ADMIN", "AGENCY_DIRECTOR"],
  // COMEX quality dashboard (WEB-005): BANK_ADMIN+ only. AGENT / MANAGER /
  // AGENCY_DIRECTOR are excluded (→ 403). Must precede "/dashboard" so the prefix
  // match wins.
  "/dashboard/comex": ["SUPER_ADMIN", "BANK_ADMIN"],
  // AI insights + COMEX predictive surfaces (IA-005): DIRECTOR+ / network only.
  // AGENT and MANAGER are excluded (→ 403). Must precede "/dashboard" so the
  // prefix match wins.
  "/dashboard/insights": ["SUPER_ADMIN", "BANK_ADMIN", "AGENCY_DIRECTOR"],
  // Reporting surface — export + benchmarking (REP-003b): AGENCY_DIRECTOR+ and
  // AUDITOR only. AGENT / MANAGER are excluded (→ 403). Must precede
  // "/dashboard" so the prefix match wins.
  "/dashboard/reports": ["SUPER_ADMIN", "BANK_ADMIN", "AGENCY_DIRECTOR", "AUDITOR"],
  "/dashboard/agent": ["SUPER_ADMIN", "BANK_ADMIN", "AGENCY_DIRECTOR", "MANAGER", "AGENT"],
  "/agent": ["SUPER_ADMIN", "BANK_ADMIN", "AGENCY_DIRECTOR", "MANAGER", "AGENT"],
  "/audit": ["SUPER_ADMIN", "BANK_ADMIN", "AUDITOR"],
  "/dashboard": ["SUPER_ADMIN", "BANK_ADMIN", "AGENCY_DIRECTOR", "MANAGER", "AGENT", "AUDITOR"],
};

/**
 * Returns the default dashboard path for a given role.
 * @param role - The user's role
 * @returns The dashboard path for that role
 */
export function getDefaultDashboard(role: Role): string {
  switch (role) {
    case "SUPER_ADMIN":
    case "BANK_ADMIN":
      return "/admin";
    case "AGENCY_DIRECTOR":
    case "MANAGER":
      return "/dashboard/manager";
    case "AGENT":
      return "/dashboard/agent";
    case "AUDITOR":
      return "/audit";
    default:
      return "/dashboard";
  }
}

/**
 * Checks if a role has permission to access a route.
 * @param role - The user's role
 * @param pathname - The route pathname to check
 * @returns true if allowed, false otherwise
 */
export function canAccess(role: Role, pathname: string): boolean {
  for (const [prefix, allowedRoles] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return (allowedRoles as Role[]).includes(role);
    }
  }
  // Default: allow access to unprotected routes
  return true;
}
