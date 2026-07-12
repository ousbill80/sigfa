/**
 * Admin console page (WEB-006).
 *
 * RBAC is enforced twice: the middleware (WEB-001) blocks AGENT/AUDITOR before
 * the page renders, and the AdminConsole shell re-checks the role (defence in
 * depth). All data flows through the typed @sigfa/contracts clients against the
 * Prism mock on canonical routes only (see lib/use-admin-console). The section
 * bodies are wired here; realtime is out of scope for this story.
 * @module app/admin/page
 */
"use client";

import { useMemo, useState, type ReactElement } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { AdminConsole } from "@/components/admin/admin-console";
import { IdentitySection } from "@/components/admin/identity-section";
import { AgenciesSection } from "@/components/admin/agencies-section";
import { ServiceForm } from "@/components/admin/service-form";
import { SmsTemplateEditor } from "@/components/admin/sms-template-editor";
import { AgentsImport } from "@/components/admin/agents-import-panel";
import { OnboardingWizard } from "@/components/admin/onboarding-wizard";
import { ThresholdsForm } from "@/components/admin/thresholds-form";
import { CounterForm } from "@/components/admin/counter-form";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { useAdminConsole } from "@/lib/use-admin-console";
import type { ImportSummary } from "@/lib/agents-import";
import type { AdminSection } from "@/lib/admin-rbac";
import type { Role } from "@/lib/roles";

/** Prism mock base URL (real API wiring is deployment config). */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010";
/** Bank + agency scope (would come from the JWT claim). */
const BANK_ID = "11111111-1111-4111-a111-111111111111";
const AGENCY_ID = "33333333-3333-4333-a333-333333333333";
/** Viewer role (would come from the JWT claim; BANK_ADMIN default for the shell). */
const ROLE: Role = "BANK_ADMIN";

/**
 * Admin console route page.
 * @returns The page element.
 */
export default function AdminPage(): ReactElement {
  const core = useMemo(() => createSigfaClient("core", API_BASE), []);
  const admin = useMemo(() => createSigfaClient("admin", API_BASE), []);
  const agents = useMemo(() => createSigfaClient("agents", API_BASE), []);
  const adminConsole = useAdminConsole({ core, admin, agents, bankId: BANK_ID, agencyId: AGENCY_ID });
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

  function renderSection(section: AdminSection): ReactElement | null {
    switch (section) {
      case "identity":
        return <IdentitySection onSave={(colors) => void adminConsole.saveThemeColors(colors)} />;
      case "agencies":
        return <AgenciesSection agencies={[]} openTickets={{}} onConfirmDeactivate={(id) => void adminConsole.deleteAgency(id)} />;
      case "services":
        return <ServiceForm onSubmit={(draft) => void adminConsole.createService(draft)} />;
      case "counters":
        return <CounterForm services={[]} onSubmit={(draft) => void adminConsole.createCounter(draft)} />;
      case "thresholds":
        return <ThresholdsForm onSubmit={(draft) => void adminConsole.saveThresholds(draft)} />;
      case "sms-templates":
        return <SmsTemplateEditor eventType="TICKET_CONFIRMATION" initialContent="" onSave={(tpl) => void adminConsole.saveSmsTemplates([tpl])} />;
      case "agents":
        return (
          <AgentsImport
            summary={importSummary}
            onImport={(file) => {
              void adminConsole.importAgents(file).then((r) => {
                if (r.ok && r.summary) setImportSummary(r.summary);
              });
            }}
          />
        );
      case "onboarding":
        return (
          <OnboardingWizard
            onCreateAgency={async (name) => {
              await adminConsole.createAgency({ name });
              return AGENCY_ID;
            }}
            onGenerateQr={async () => {
              const r = await adminConsole.generateKioskAccess();
              return r.qrCodeDataUrl ?? "";
            }}
          />
        );
      default:
        return null;
    }
  }

  return (
    <>
      <AdminConsole role={ROLE} renderSection={renderSection} />
      <OfflineBanner />
    </>
  );
}
