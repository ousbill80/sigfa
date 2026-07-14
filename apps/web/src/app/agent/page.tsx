/**
 * /agent — agent counter interface (WEB-002).
 * RBAC AGENT enforced by middleware (WEB-001). Realtime simulated (RT-001).
 * @module app/agent/page
 */
"use client";

import type { ReactElement } from "react";
import { useMemo } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { AgentConsole, type TransferOption } from "@/components/agent/agent-console";
import { useAgentFlow } from "@/lib/use-agent-flow";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { BROWSER_API_BASE } from "@/lib/browser-api";

/**
 * Base API du client agent : TOUJOURS le proxy same-origin `/api/rt`
 * (lib/browser-api) — Bearer httpOnly injecté côté serveur (RT-003, token
 * jamais exposé au JS client) ; en mode mock le proxy relaie vers Prism
 * (RT-001b). Aucun appel navigateur cross-origin.
 */
const API_BASE = BROWSER_API_BASE;

/** Counter operated by the signed-in agent (would come from the JWT claim). */
const COUNTER_ID =
  process.env.NEXT_PUBLIC_AGENT_COUNTER_ID ?? "cccccccc-cccc-4ccc-accc-cccccccccccc";

/** Inline transfer destinations (would come from the agency services). */
const TRANSFER_OPTIONS: TransferOption[] = [
  { id: "svc-depot", label: "Dépôts" },
  { id: "svc-credit", label: "Crédit" },
  { id: "svc-accueil", label: "Accueil" },
];

/**
 * Agent route page.
 * @returns The page element.
 */
export default function AgentPage(): ReactElement {
  const client = useMemo(() => createSigfaClient("core", API_BASE), []);
  const flow = useAgentFlow({ counterId: COUNTER_ID, client });

  return (
    <>
      <AgentConsole
        status={flow.status}
        ticket={flow.ticket}
        transferOpen={flow.transferOpen}
        message={flow.message}
        transferOptions={TRANSFER_OPTIONS}
        onCallNext={() => void flow.callNext()}
        onFinish={() => void flow.finish()}
        onOpenTransfer={flow.openTransfer}
        onSelectTransfer={() => flow.closeTransfer()}
      />
      <OfflineBanner />
    </>
  );
}
