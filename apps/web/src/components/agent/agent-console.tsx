/**
 * AgentConsole — agent counter interface (WEB-002).
 * 3 fixed actions, current ticket at --kpi-value (96px), MM:SS chrono, Space
 * shortcut for "call next", inline transfer selector (no modal), 5 states.
 * Tokens only. Realtime simulated (RT-001).
 * @module components/agent/agent-console
 */
"use client";

import type { CSSProperties, ReactElement } from "react";
import { useEffect } from "react";
import { t, type Locale } from "@/lib/i18n";
import { useTicketTimer } from "@/lib/agent-timer";
import type { AgentStatus, ServingTicket } from "@/lib/use-agent-flow";

/** A transfer destination option for the inline selector. */
export interface TransferOption {
  /** Destination id (counter or service UUID). */
  id: string;
  /** Human label (ex. "Guichet 4 — Dépôts"). */
  label: string;
}

/** Props for {@link AgentConsole}. */
export interface AgentConsoleProps {
  /** Lifecycle status. */
  status: AgentStatus;
  /** Ticket currently served, or null. */
  ticket: ServingTicket | null;
  /** Whether the inline transfer selector is open. */
  transferOpen: boolean;
  /** Human message (i18n key) for empty/error states. */
  message?: string | null;
  /** Whether the socket is offline (chrono continues, actions maintained). */
  offline?: boolean;
  /** Transfer destinations for the inline selector. */
  transferOptions?: TransferOption[];
  /** Active locale. */
  locale?: Locale;
  /** Handler for "APPELER LE SUIVANT" (and Space). */
  onCallNext: () => void;
  /** Handler for "TERMINER". */
  onFinish: () => void;
  /** Handler that opens the inline transfer selector. */
  onOpenTransfer: () => void;
  /** Handler that picks a transfer destination. */
  onSelectTransfer?: (option: TransferOption) => void;
}

const primaryButton: CSSProperties = {
  width: "100%",
  height: "88px",
  backgroundColor: "var(--brand)",
  color: "var(--brand-contrast)",
  border: "none",
  borderRadius: "0.5rem",
  fontSize: "1.25rem",
  fontWeight: 600,
  cursor: "pointer",
};

const halfButton: CSSProperties = {
  width: "50%",
  minHeight: "72px",
  border: "1px solid var(--ink-soft)",
  borderRadius: "0.5rem",
  backgroundColor: "var(--surface-1)",
  color: "var(--ink-strong)",
  fontSize: "1.125rem",
  fontWeight: 600,
  cursor: "pointer",
};

/**
 * Agent counter console.
 * @param props - {@link AgentConsoleProps}.
 * @returns The console element.
 */
export function AgentConsole({
  status,
  ticket,
  transferOpen,
  message = null,
  offline = false,
  transferOptions = [],
  locale = "fr",
  onCallNext,
  onFinish,
  onOpenTransfer,
  onSelectTransfer,
}: AgentConsoleProps): ReactElement {
  const isServing = status === "serving" && ticket !== null;
  const isLoading = status === "loading";
  const chrono = useTicketTimer(isServing ? ticket!.startedAt : null);

  // WEB-002 : Espace déclenche APPELER quand le focus est sur la page et qu'on
  // ne saisit pas dans un champ.
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.code !== "Space" && e.key !== " ") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" || tag === "SELECT") return;
      e.preventDefault();
      if (!isLoading) onCallNext();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isLoading, onCallNext]);

  return (
    <div data-testid="agent-console" data-status={status} style={{ padding: "1.5rem", maxWidth: "960px", margin: "0 auto" }}>
      {offline && (
        <div
          data-testid="agent-offline-banner"
          role="status"
          style={{
            backgroundColor: "var(--warning)",
            color: "var(--ink-strong)",
            padding: "0.5rem 1rem",
            borderRadius: "0.5rem",
            marginBottom: "1rem",
            fontSize: "var(--caption)",
          }}
        >
          {t("offline.banner", locale)}
        </div>
      )}

      {/* Ticket courant + chrono */}
      <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1.5rem" }}>
        <section data-testid="agent-ticket" aria-label={t("agent.current_ticket", locale)} style={{ flex: 1 }}>
          <div style={{ fontSize: "var(--caption)" }}>{t("agent.current_ticket", locale)}</div>
          {ticket ? (
            <div
              data-testid="agent-ticket-number"
              style={{ fontSize: "var(--kpi-value)", fontWeight: 600, color: "var(--brand)", lineHeight: 1 }}
            >
              {ticket.number}
            </div>
          ) : (
            <div data-testid="agent-ticket-empty" style={{ fontSize: "var(--kpi-value)", color: "var(--ink-soft)", lineHeight: 1 }}>
              —
            </div>
          )}
        </section>
        <section data-testid="agent-timer" aria-label={t("agent.timer", locale)} style={{ minWidth: "220px" }}>
          <div style={{ fontSize: "var(--caption)" }}>{t("agent.timer", locale)}</div>
          <div data-testid="agent-chrono" style={{ fontSize: "2rem", fontFamily: "monospace" }}>
            {chrono}
          </div>
        </section>
      </div>

      {/* Message humain (empty/error) — jamais de code d'erreur */}
      {message && (
        <div data-testid="agent-message" role="status" style={{ marginBottom: "1rem", color: "var(--ink-soft)" }}>
          {t(message as Parameters<typeof t>[0], locale)}
        </div>
      )}

      {/* 3 actions dans un ordre fixe */}
      <div data-testid="agent-actions" style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
        <button
          data-testid="agent-call-next"
          type="button"
          onClick={onCallNext}
          disabled={isLoading}
          aria-busy={isLoading}
          style={primaryButton}
        >
          {isLoading ? (
            <span data-testid="agent-spinner" aria-hidden="true">
              …
            </span>
          ) : (
            t("agent.call_next", locale)
          )}
        </button>

        {isServing && (
          <>
            <button data-testid="agent-finish" type="button" onClick={onFinish} disabled={isLoading} style={halfButton}>
              {t("agent.finish", locale)}
            </button>
            <button
              data-testid="agent-transfer"
              type="button"
              onClick={onOpenTransfer}
              disabled={isLoading}
              style={halfButton}
              aria-expanded={transferOpen}
            >
              {t("agent.transfer", locale)}
            </button>
          </>
        )}
      </div>

      {/* Sélecteur de transfert inline (aucune modale) */}
      {transferOpen && (
        <div data-testid="agent-transfer-selector" style={{ marginTop: "1rem", border: "1px solid var(--ink-soft)", borderRadius: "0.5rem", padding: "1rem" }}>
          <div style={{ fontSize: "var(--caption)", marginBottom: "0.5rem" }}>{t("agent.select_destination", locale)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {transferOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-testid="agent-transfer-option"
                onClick={() => onSelectTransfer?.(opt)}
                style={{ ...halfButton, width: "100%", minHeight: "56px" }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
