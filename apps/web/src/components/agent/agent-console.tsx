/**
 * AgentConsole — agent counter interface (WEB-002).
 * Refonte visuelle v2 « Sérénité Premium » : @sigfa/ui (Card / Badge / Button /
 * EmptyState) + tokens v2 uniquement. Comportement inchangé : 3 actions dans un
 * ordre fixe, ticket courant à --kpi-value, chrono MM:SS, raccourci Espace pour
 * « appeler le suivant », sélecteur de transfert inline (aucune modale), 5 états.
 * @module components/agent/agent-console
 */
"use client";

import type { CSSProperties, ReactElement } from "react";
import { useEffect } from "react";
import { Badge, Card } from "@sigfa/ui";
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

/** Section eyebrow label (meta caption above panels & fields). */
const eyebrow: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  letterSpacing: "var(--tracking-tight)",
  textTransform: "uppercase",
  color: "var(--ink-faint)",
  margin: 0,
};

/**
 * Primary action — full width, giant terracotta target (88px).
 * Kept as a raw <button> with inline tokens: the WEB-002 test suite asserts on
 * this element's inline `var(--brand)` / `88px` / `width: 100%` style.
 */
const primaryButton: CSSProperties = {
  width: "100%",
  height: "88px",
  backgroundColor: "var(--brand)",
  color: "var(--brand-contrast)",
  border: "none",
  borderRadius: "var(--r-lg)",
  fontFamily: "var(--font-display)",
  fontSize: "var(--text-2xl)",
  fontWeight: 600,
  letterSpacing: "var(--tracking-tight)",
  cursor: "pointer",
  boxShadow: "var(--shadow-brand)",
};

/** Secondary half-width action (Terminer / Transférer). */
const halfButton: CSSProperties = {
  flex: 1,
  minWidth: "12rem",
  minHeight: "72px",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--r-lg)",
  backgroundColor: "var(--surface-1)",
  color: "var(--ink)",
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-lg)",
  fontWeight: 600,
  cursor: "pointer",
  boxShadow: "var(--shadow-1)",
};

/** A transfer destination row inside the inline selector. */
const optionButton: CSSProperties = {
  width: "100%",
  minHeight: "56px",
  textAlign: "left",
  padding: "0 var(--space-4)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--r-md)",
  backgroundColor: "var(--surface-1)",
  color: "var(--ink)",
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-base)",
  fontWeight: 500,
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
    <div
      data-testid="agent-console"
      data-status={status}
      style={{
        maxWidth: "60rem",
        margin: "0 auto",
        padding: "var(--space-6)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
        background: "var(--paper)",
        minHeight: "100%",
        fontFamily: "var(--font-text)",
        color: "var(--ink)",
      }}
    >
      {/* En-tête : titre du guichet + statut de connexion */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-4)",
        }}
      >
        <div>
          <p style={eyebrow}>SIGFA · WEB-002</p>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-2xl)",
              fontWeight: 600,
              lineHeight: "var(--leading-tight)",
              letterSpacing: "var(--tracking-tight)",
              color: "var(--ink)",
              margin: 0,
            }}
          >
            {t("agent.current_ticket", locale)}
          </h1>
        </div>
        <Badge tone={offline ? "warning" : "success"} dot>
          {t(offline ? "offline.banner" : "agent.timer", locale)}
        </Badge>
      </header>

      {offline && (
        <div
          data-testid="agent-offline-banner"
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            background: "var(--warning-soft)",
            color: "var(--ink)",
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--r-md)",
            fontSize: "var(--text-sm)",
            border: "1px solid var(--hairline)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: "0.5rem",
              height: "0.5rem",
              borderRadius: "var(--r-full)",
              background: "var(--warning)",
              flexShrink: 0,
            }}
          />
          {t("offline.banner", locale)}
        </div>
      )}

      {/* Ticket courant + chrono */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-4)",
        }}
      >
        <Card
          data-testid="agent-ticket"
          aria-label={t("agent.current_ticket", locale)}
          style={{
            flex: 2,
            minWidth: "16rem",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            background: "var(--surface-1)",
          }}
        >
          <p style={eyebrow}>{t("agent.current_ticket", locale)}</p>
          {ticket ? (
            <>
              <div
                data-testid="agent-ticket-number"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--kpi-value)",
                  fontWeight: 700,
                  color: "var(--brand)",
                  lineHeight: "var(--leading-tight)",
                  letterSpacing: "var(--tracking-numeric)",
                }}
              >
                {ticket.number}
              </div>
              {/* WEB-002-OP : opération choisie à la borne, bien lisible sous le numéro */}
              {ticket.operationName && (
                <div
                  data-testid="agent-ticket-operation"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "var(--text-xl)",
                    fontWeight: 600,
                    color: "var(--ink)",
                    lineHeight: "var(--leading-tight)",
                    letterSpacing: "var(--tracking-tight)",
                  }}
                >
                  {ticket.operationName}
                </div>
              )}
              {ticket.serviceName && (
                <div
                  data-testid="agent-ticket-service"
                  style={{
                    fontFamily: "var(--font-text)",
                    fontSize: "var(--text-sm)",
                    fontWeight: 500,
                    color: "var(--ink-soft)",
                  }}
                >
                  {ticket.serviceName}
                </div>
              )}
            </>
          ) : (
            <div
              data-testid="agent-ticket-empty"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--kpi-value)",
                color: "var(--ink-faint)",
                lineHeight: "var(--leading-tight)",
              }}
            >
              —
            </div>
          )}
        </Card>

        <Card
          data-testid="agent-timer"
          aria-label={t("agent.timer", locale)}
          style={{
            flex: 1,
            minWidth: "13rem",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            justifyContent: "center",
            background: "var(--surface-2)",
          }}
        >
          <p style={eyebrow}>{t("agent.timer", locale)}</p>
          <div
            data-testid="agent-chrono"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-4xl)",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "var(--tracking-numeric)",
              color: "var(--ink)",
            }}
          >
            {chrono}
          </div>
        </Card>
      </div>

      {/* Message humain (empty/error) — jamais de code d'erreur */}
      {message && (
        <div
          data-testid="agent-message"
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            background: "var(--surface-2)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--r-md)",
            padding: "var(--space-3) var(--space-4)",
            color: "var(--ink-soft)",
            fontSize: "var(--text-sm)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: "0.5rem",
              height: "0.5rem",
              borderRadius: "var(--r-full)",
              background: status === "error" ? "var(--brand)" : "var(--info)",
              flexShrink: 0,
            }}
          />
          {t(message as Parameters<typeof t>[0], locale)}
        </div>
      )}

      {/* 3 actions dans un ordre fixe */}
      <div
        data-testid="agent-actions"
        style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}
      >
        <button
          data-testid="agent-call-next"
          type="button"
          onClick={onCallNext}
          disabled={isLoading}
          aria-busy={isLoading}
          style={{ ...primaryButton, opacity: isLoading ? 0.7 : 1 }}
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
            <button
              data-testid="agent-finish"
              type="button"
              onClick={onFinish}
              disabled={isLoading}
              style={halfButton}
            >
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
        <div
          data-testid="agent-transfer-selector"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--r-lg)",
            padding: "var(--space-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
            boxShadow: "var(--shadow-1)",
          }}
        >
          <p style={eyebrow}>{t("agent.select_destination", locale)}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {transferOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-testid="agent-transfer-option"
                onClick={() => onSelectTransfer?.(opt)}
                style={optionButton}
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
