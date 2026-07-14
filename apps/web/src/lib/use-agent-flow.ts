/**
 * useAgentFlow — agent counter workflow (WEB-002).
 *
 * Drives the agent console against the typed client generated from core.yaml:
 * - APPELER LE SUIVANT → POST /counters/{counterId}/call-next (route canonique).
 * - TERMINER → POST /tickets/{id}/serve puis POST /tickets/{id}/close : l'agent
 *   SERT (CALLED→SERVING) puis CLÔTURE (SERVING→DONE), conformément au cycle de
 *   vie API-003 (le close exige l'état SERVING). Réinitialise la zone ticket.
 * - TRANSFÉRER → sélecteur inline (aucune modale).
 *
 * Realtime is simulated (RT-001) : the called ticket comes from the HTTP
 * response. The chrono continues locally even offline.
 * @module lib/use-agent-flow
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { createSigfaClient } from "@sigfa/contracts";

/** A typed core client instance (openapi-fetch). */
export type CoreClient = ReturnType<typeof createSigfaClient<"core">>;

/** Visible lifecycle state of the agent console. */
export type AgentStatus = "idle" | "loading" | "serving" | "empty" | "error";

/** The ticket currently served at the counter. */
export interface ServingTicket {
  /** Ticket UUID. */
  id: string;
  /** Human-readable ticket number (ex. "A047"). */
  number: string;
  /** Libellé de l'opération choisie à la borne (WEB-002-OP), ou null. */
  operationName: string | null;
  /** Libellé du service du ticket (WEB-002-OP), ou null. */
  serviceName: string | null;
  /** Monotonic key used to (re)start the chrono. */
  startedAt: number;
}

/** Options for {@link useAgentFlow}. */
export interface UseAgentFlowOptions {
  /** UUID of the counter operated by the agent. */
  counterId: string;
  /** Injected typed core client (tests provide one bound to the Prism mock). */
  client: CoreClient;
}

/** Result of {@link useAgentFlow}. */
export interface UseAgentFlowResult {
  /** Current lifecycle status. */
  status: AgentStatus;
  /** The ticket being served, or null. */
  ticket: ServingTicket | null;
  /** Whether the inline transfer selector is open. */
  transferOpen: boolean;
  /** Human message for the error/empty states (never an error code). */
  message: string | null;
  /** Calls the next ticket via POST /counters/{counterId}/call-next. */
  callNext: () => Promise<void>;
  /** Closes the current ticket via PATCH /tickets/{id}/close. */
  finish: () => Promise<void>;
  /** Opens the inline transfer selector. */
  openTransfer: () => void;
  /** Closes the inline transfer selector. */
  closeTransfer: () => void;
}

/** Résumé affichable d'un ticket appelé (numéro + libellés WEB-002-OP). */
interface TicketSummary {
  /** Numéro d'appel (ex. "A001") — vide si indisponible. */
  number: string;
  /** Libellé de l'opération choisie à la borne, ou null. */
  operationName: string | null;
  /** Libellé du service, ou null. */
  serviceName: string | null;
}

/**
 * Lit le résumé affichable d'un ticket via GET /tickets/{id} (route de contrat) :
 * numéro d'appel + libellés opération/service (WEB-002-OP). Renvoie un résumé
 * vide en cas d'échec (affichage dégradé, jamais un crash).
 * @param client - Client core typé.
 * @param id - UUID du ticket.
 * @returns Le résumé (champs vides/null si indisponibles).
 */
async function fetchTicketSummary(client: CoreClient, id: string): Promise<TicketSummary> {
  try {
    const { data } = await client.GET("/tickets/{id}", { params: { path: { id } } });
    const ticket = data as
      | { number?: string; operationName?: string | null; serviceName?: string }
      | undefined;
    return {
      number: ticket?.number ?? "",
      operationName: ticket?.operationName ?? null,
      serviceName: ticket?.serviceName ?? null,
    };
  } catch {
    return { number: "", operationName: null, serviceName: null };
  }
}

/**
 * Agent counter workflow hook.
 * @param options - {@link UseAgentFlowOptions}.
 * @returns {@link UseAgentFlowResult}.
 */
export function useAgentFlow(options: UseAgentFlowOptions): UseAgentFlowResult {
  const { counterId, client } = options;
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [ticket, setTicket] = useState<ServingTicket | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const callNext = useCallback(async (): Promise<void> => {
    setStatus("loading");
    setMessage(null);
    try {
      const { data, error, response } = await client.POST("/counters/{counterId}/call-next", {
        params: { path: { counterId } },
      });
      if (error || !data) {
        // 404 QUEUE_EMPTY is a normal "no customer waiting" case, not an alert.
        if (response?.status === 404) {
          setStatus("empty");
          setMessage("agent.queue_empty");
          setTicket(null);
          return;
        }
        setStatus("error");
        setMessage("agent.error");
        return;
      }
      const called = data as {
        id?: string;
        number?: string;
        operationName?: string | null;
        serviceName?: string;
      };
      const id = called.id ?? "";
      // WEB-002-OP : call-next renvoie désormais number + operationName/serviceName.
      // Fallback GET /tickets/{id} conservé pour les réponses historiques sans
      // `number` (résumé lu en une requête — affichage dégradé, jamais un crash).
      const summary: TicketSummary =
        called.number !== undefined
          ? {
              number: called.number,
              operationName: called.operationName ?? null,
              serviceName: called.serviceName ?? null,
            }
          : id
            ? await fetchTicketSummary(client, id)
            : { number: "", operationName: null, serviceName: null };
      setTicket({ id, ...summary, startedAt: Date.now() });
      setStatus("serving");
    } catch {
      setStatus("error");
      setMessage("agent.error");
    }
  }, [client, counterId]);

  const finish = useCallback(async (): Promise<void> => {
    if (!ticket) return;
    setStatus("loading");
    setMessage(null);
    try {
      // Cycle API-003 : SERVIR (CALLED→SERVING) avant de CLÔTURER (SERVING→DONE).
      // Le serve est idempotent côté serveur (served_at = COALESCE) : rejouable
      // sans effet de bord. Un ticket déjà SERVING renvoie une transition légale.
      await client.POST("/tickets/{id}/serve", {
        params: { path: { id: ticket.id } },
      });
      const { error } = await client.POST("/tickets/{id}/close", {
        params: {
          path: { id: ticket.id },
          // Mutation critique : X-Idempotency-Key obligatoire (contrat core.yaml).
          header: { "X-Idempotency-Key": crypto.randomUUID() },
        },
      });
      if (error) {
        setStatus("error");
        setMessage("agent.error");
        return;
      }
      // Réinitialise la zone ticket (état empty/idle).
      setTicket(null);
      setTransferOpen(false);
      setStatus("idle");
    } catch {
      setStatus("error");
      setMessage("agent.error");
    }
  }, [client, ticket]);

  const openTransfer = useCallback((): void => setTransferOpen(true), []);
  const closeTransfer = useCallback((): void => setTransferOpen(false), []);

  return useMemo(
    () => ({ status, ticket, transferOpen, message, callNext, finish, openTransfer, closeTransfer }),
    [status, ticket, transferOpen, message, callNext, finish, openTransfer, closeTransfer],
  );
}
