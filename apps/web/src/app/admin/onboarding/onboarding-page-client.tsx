/**
 * Agency onboarding page client shell (ADM-002b).
 *
 * Wires the typed useAdmOnboarding hook (clone/provision/onboarding routes) to
 * the AdmOnboardingStepper. The tenant context (bankId/agencyId/role) + API base
 * arrive as PROPS from the server component (verified JWT claims in real mode,
 * fixtures in mock) — no tenant constants client-side. Resume ids come from the
 * URL query so leaving and returning restores the parcours.
 * @module app/admin/onboarding/onboarding-page-client
 */
"use client";

import { useMemo, type ReactElement } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { AdmOnboardingStepper } from "@/components/admin/adm-onboarding-stepper";
import { useAdmOnboarding } from "@/lib/use-adm-onboarding";
import type { Role } from "@/lib/roles";
import type { Locale } from "@/lib/i18n";

/** Props derived server-side (S3 — never tenant constants client-side). */
export interface OnboardingPageClientProps {
  /** Base API: /api/rt in real mode, Prism mock otherwise. */
  apiBase: string;
  /** Bank of the verified JWT (or mock fixture). */
  bankId: string;
  /** Role of the verified JWT (or mock fixture). */
  role: Role;
  /** Active locale. */
  locale?: Locale;
  /** Optional resume agency id (from the URL query). */
  resumeAgencyId?: string;
  /** Optional resume onboarding id (from the URL query). */
  resumeOnboardingId?: string;
}

/**
 * Onboarding parcours client shell.
 * @param props - {@link OnboardingPageClientProps}.
 * @returns The parcours element.
 */
export function OnboardingPageClient({
  apiBase,
  bankId,
  role,
  locale = "fr",
  resumeAgencyId,
  resumeOnboardingId,
}: OnboardingPageClientProps): ReactElement {
  const admin = useMemo(() => createSigfaClient("admin", apiBase), [apiBase]);
  const onboarding = useAdmOnboarding({ admin, bankId, locale });

  return (
    <AdmOnboardingStepper
      role={role}
      locale={locale}
      connection={onboarding.connection}
      onClone={onboarding.cloneAgency}
      onProvision={onboarding.provisionKiosk}
      onResume={onboarding.getOnboarding}
      resumeAgencyId={resumeAgencyId}
      resumeOnboardingId={resumeOnboardingId}
    />
  );
}
