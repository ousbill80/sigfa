/**
 * admin-rbac.ts — RBAC matrix for the WEB-006 admin console.
 *
 * The console is split into 8 sections, each gated by a minimum role from the
 * SIGFA hierarchy (admin.yaml `x-required-role`). Roles are cumulative: a role
 * higher in the hierarchy inherits every permission of the roles below it.
 *
 * Hard rules (WEB-006):
 * - AGENT and AUDITOR can reach NO admin section → every /admin/* route is 403.
 * - AGENCY_DIRECTOR only manages services/counters/agents of ITS OWN agency
 *   (bank-wide identity/agencies/templates/thresholds stay BANK_ADMIN+).
 * @module lib/admin-rbac
 */
import type { Role } from "./roles";

/** The eight admin console sections. */
export type AdminSection =
  | "identity"
  | "agencies"
  | "services"
  | "counters"
  | "agents"
  | "sms-templates"
  | "thresholds"
  | "onboarding";

/**
 * Role hierarchy rank — higher number = wider access.
 * AGENT / AUDITOR are intentionally the lowest and never satisfy an admin gate.
 */
const RANK: Record<Role, number> = {
  SUPER_ADMIN: 6,
  BANK_ADMIN: 5,
  AGENCY_DIRECTOR: 4,
  MANAGER: 3,
  AGENT: 1,
  AUDITOR: 1,
};

/** Minimum role required per section (mirrors admin.yaml / core.yaml x-required-role). */
export const SECTION_MIN_ROLE: Record<AdminSection, Role> = {
  identity: "BANK_ADMIN",
  agencies: "BANK_ADMIN",
  services: "AGENCY_DIRECTOR",
  counters: "AGENCY_DIRECTOR",
  agents: "AGENCY_DIRECTOR",
  "sms-templates": "BANK_ADMIN",
  thresholds: "MANAGER",
  onboarding: "AGENCY_DIRECTOR",
};

/** Roles that can never reach any admin section (403 on /admin/*). */
const ADMIN_FORBIDDEN_ROLES: readonly Role[] = ["AGENT", "AUDITOR"];

/**
 * Whether a role reaches ANY admin section (i.e. may open /admin/*).
 * AGENT and AUDITOR are always denied.
 * @param role - The viewer role.
 * @returns true if at least one section is reachable.
 */
export function canReachAdmin(role: Role): boolean {
  if (ADMIN_FORBIDDEN_ROLES.includes(role)) return false;
  return RANK[role] >= RANK.MANAGER;
}

/**
 * Whether a role can access a given admin section.
 * @param role - The viewer role.
 * @param section - The admin section.
 * @returns true if allowed.
 */
export function canAccessSection(role: Role, section: AdminSection): boolean {
  if (ADMIN_FORBIDDEN_ROLES.includes(role)) return false;
  return RANK[role] >= RANK[SECTION_MIN_ROLE[section]];
}

/**
 * Whether a BANK-wide section (identity, agencies list, templates, thresholds edit)
 * is editable by the role. AGENCY_DIRECTOR is scoped to its agency and cannot edit
 * bank-wide configuration.
 * @param role - The viewer role.
 * @returns true for BANK_ADMIN and above.
 */
export function canEditBankWide(role: Role): boolean {
  if (ADMIN_FORBIDDEN_ROLES.includes(role)) return false;
  return RANK[role] >= RANK.BANK_ADMIN;
}

/**
 * Whether the role may act on the given agency for agency-scoped sections
 * (services/counters/agents). AGENCY_DIRECTOR is restricted to its own agency;
 * BANK_ADMIN+ may act on any agency of the bank.
 * @param role - The viewer role.
 * @param targetAgencyId - The agency being acted upon.
 * @param ownAgencyId - The viewer's own agency (from the JWT claim), if any.
 * @returns true if the action is within scope.
 */
export function canScopeAgency(
  role: Role,
  targetAgencyId: string,
  ownAgencyId: string | null,
): boolean {
  if (ADMIN_FORBIDDEN_ROLES.includes(role)) return false;
  if (RANK[role] >= RANK.BANK_ADMIN) return true;
  if (role === "AGENCY_DIRECTOR" || role === "MANAGER") {
    return ownAgencyId !== null && ownAgencyId === targetAgencyId;
  }
  return false;
}

/**
 * The sections visible to a role, in console order.
 * @param role - The viewer role.
 * @returns Ordered list of reachable sections (empty for AGENT/AUDITOR).
 */
export function visibleSections(role: Role): AdminSection[] {
  const order: AdminSection[] = [
    "identity",
    "agencies",
    "services",
    "counters",
    "agents",
    "sms-templates",
    "thresholds",
    "onboarding",
  ];
  return order.filter((s) => canAccessSection(role, s));
}
