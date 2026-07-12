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

/** Mode temps réel (dérivé de l'env). */
const REALTIME = process.env.NEXT_PUBLIC_REALTIME_MODE === "real";

/**
 * Base API du client agent.
 * - mode `real` : proxy same-origin `/api/rt` — injecte le Bearer httpOnly côté
 *   serveur et relaie vers `/api/v1` (RT-003 ; token jamais exposé au JS client).
 * - mode `off`  : mock Prism canonique (RT-001, socket inactif).
 */
const API_BASE = REALTIME
  ? "/api/rt"
  : process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010";

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
