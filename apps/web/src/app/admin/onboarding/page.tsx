/**
 * Agency onboarding page (ADM-002b) — server component.
 *
 * Derives the tenant context server side (verified JWT claims in real mode,
 * fixtures in mock) and hands bankId/role/apiBase to the client shell. Resume
 * ids come from the URL query (`?agencyId=…&onboardingId=…`) so leaving and
 * returning restores the parcours. RBAC: middleware (WEB-001) gates
 * /admin/onboarding first (AGENCY_DIRECTOR+); the stepper re-checks in depth.
 *
 * @module app/admin/onboarding/page
 */
import type { ReactElement } from "react";
import { resolveTenantContext } from "@/lib/server-session";
import { OnboardingPageClient } from "./onboarding-page-client";

/** Next.js dynamic search params for this route. */
interface OnboardingPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/** Reads a single string query param (first value if an array). */
function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Agency onboarding route page.
 * @param props - Next.js page props (search params).
 * @returns The page element.
 */
export default async function OnboardingPage(props: OnboardingPageProps): Promise<ReactElement> {
  const ctx = await resolveTenantContext();
  const params = (await props.searchParams) ?? {};
  const resumeAgencyId = firstParam(params.agencyId);
  const resumeOnboardingId = firstParam(params.onboardingId);
  return (
    <OnboardingPageClient
      apiBase={ctx.apiBase}
      bankId={ctx.bankId}
      role={ctx.role}
      resumeAgencyId={resumeAgencyId}
      resumeOnboardingId={resumeOnboardingId}
    />
  );
}
