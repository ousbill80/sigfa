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

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { AdminConsole } from "@/components/admin/admin-console";
import { IdentitySection } from "@/components/admin/identity-section";
import { AgenciesSection } from "@/components/admin/agencies-section";
import { ServicesSection } from "@/components/admin/services-section";
import { SmsTemplateEditor } from "@/components/admin/sms-template-editor";
import { AgentsImport } from "@/components/admin/agents-import-panel";
import { AgentConseillerSection } from "@/components/admin/agent-conseiller-section";
import { OnboardingWizard } from "@/components/admin/onboarding-wizard";
import { ThresholdsForm } from "@/components/admin/thresholds-form";
import { CounterForm } from "@/components/admin/counter-form";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { useAdminConsole, type OperationRow, type ServiceRow } from "@/lib/use-admin-console";
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
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [operationsByService, setOperationsByService] = useState<Record<string, OperationRow[]>>({});
  const [operationServerError, setOperationServerError] = useState<string | undefined>();

  const { listServices, listOperations, createOperation, deleteOperation } = adminConsole;

  useEffect(() => {
    void listServices().then(setServices);
  }, [listServices]);

  const refreshOperations = useCallback(
    async (serviceId: string): Promise<void> => {
      const ops = await listOperations(serviceId);
      setOperationsByService((prev) => ({ ...prev, [serviceId]: ops }));
    },
    [listOperations],
  );

  const handleCreateOperation = useCallback(
    (serviceId: string, draft: { code: string; name: string; slaMinutes: number | null; displayOrder: number; iconKey?: string }): void => {
      setOperationServerError(undefined);
      void createOperation(serviceId, { ...draft, isActive: true }).then((r) => {
        if (r.ok) void refreshOperations(serviceId);
        else setOperationServerError(r.message);
      });
    },
    [createOperation, refreshOperations],
  );

  const handleDeactivateOperation = useCallback(
    (operationId: string): void => {
      void deleteOperation(operationId).then((r) => {
        if (r.ok) {
          // Re-fetch every currently loaded service to reflect the deactivation.
          Object.keys(operationsByService).forEach((sid) => void refreshOperations(sid));
        } else {
          setOperationServerError(r.message);
        }
      });
    },
    [deleteOperation, refreshOperations, operationsByService],
  );

  function renderSection(section: AdminSection): ReactElement | null {
    switch (section) {
      case "identity":
        return <IdentitySection onSave={(colors) => void adminConsole.saveThemeColors(colors)} />;
      case "agencies":
        return <AgenciesSection agencies={[]} openTickets={{}} onConfirmDeactivate={(id) => void adminConsole.deleteAgency(id)} />;
      case "services":
        return (
          <ServicesSection
            services={services}
            operationsByService={operationsByService}
            onCreateService={(draft) => void adminConsole.createService(draft)}
            onCreateOperation={handleCreateOperation}
            onDeactivateOperation={handleDeactivateOperation}
            onExpandService={(serviceId) => void refreshOperations(serviceId)}
            operationServerError={operationServerError}
          />
        );
      case "counters":
        return <CounterForm services={[]} onSubmit={(draft) => void adminConsole.createCounter(draft)} />;
      case "thresholds":
        return <ThresholdsForm onSubmit={(draft) => void adminConsole.saveThresholds(draft)} />;
      case "sms-templates":
        return <SmsTemplateEditor eventType="TICKET_CONFIRMATION" initialContent="" onSave={(tpl) => void adminConsole.saveSmsTemplates([tpl])} />;
      case "agents":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
            <AgentsImport
              summary={importSummary}
              onImport={(file) => {
                void adminConsole.importAgents(file).then((r) => {
                  if (r.ok && r.summary) setImportSummary(r.summary);
                });
              }}
            />
            <AgentConseillerSection
              onLoadAgent={(id) => adminConsole.getAgent(id)}
              onSave={(id, body) => adminConsole.markConseiller(id, body)}
            />
          </div>
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
