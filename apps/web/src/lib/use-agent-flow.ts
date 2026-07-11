/**
 * useAgentFlow — agent counter workflow (WEB-002).
 *
 * Drives the agent console against the typed client generated from core.yaml:
 * - APPELER LE SUIVANT → POST /counters/{counterId}/call-next (route canonique).
 * - TERMINER → PATCH /tickets/{id}/close (réinitialise la zone ticket).
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
      const called = data as { id?: string; number?: string };
      setTicket({
        id: called.id ?? "",
        number: called.number ?? "",
        startedAt: Date.now(),
      });
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
