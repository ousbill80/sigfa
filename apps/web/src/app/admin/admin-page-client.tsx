/**
 * Admin console client shell (WEB-006) — S3 (Boucle 2 F4).
 *
 * Le tenant (bankId/agencyId/role) et la base API arrivent en PROPS depuis le
 * server component (claims du JWT vérifié en mode real, fixtures mock sinon) :
 * plus aucune constante tenant côté client, plus aucun appel direct à
 * NEXT_PUBLIC_API_URL en mode real (proxy same-origin /api/rt, Bearer injecté
 * côté serveur). RBAC : middleware (WEB-001) + re-check AdminConsole.
 * @module app/admin/admin-page-client
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

/** Props dérivées côté serveur (S3 — jamais de constantes tenant client). */
export interface AdminPageClientProps {
  /** Base API : /api/rt en mode real, mock Prism sinon. */
  apiBase: string;
  /** Banque du JWT vérifié (ou fixture mock). */
  bankId: string;
  /** Agence active du scope JWT vérifié (ou fixture mock). */
  agencyId: string;
  /** Rôle du JWT vérifié (ou fixture mock). */
  role: Role;
}

/**
 * Admin console client shell.
 * @param props - {@link AdminPageClientProps}.
 * @returns The console element.
 */
export function AdminPageClient({ apiBase, bankId, agencyId, role }: AdminPageClientProps): ReactElement {
  const core = useMemo(() => createSigfaClient("core", apiBase), [apiBase]);
  const admin = useMemo(() => createSigfaClient("admin", apiBase), [apiBase]);
  const agents = useMemo(() => createSigfaClient("agents", apiBase), [apiBase]);
  const adminConsole = useAdminConsole({ core, admin, agents, bankId, agencyId });
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
              return agencyId;
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
      <AdminConsole role={role} renderSection={renderSection} />
      <OfflineBanner />
    </>
  );
}
