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

/** Prism mock base URL (RT-001 keeps the real socket inactive). */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010";

/** Counter operated by the signed-in agent (would come from the JWT claim). */
const COUNTER_ID = "cccccccc-cccc-4ccc-accc-cccccccccccc";

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
