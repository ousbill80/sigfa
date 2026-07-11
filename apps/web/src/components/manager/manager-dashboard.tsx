/**
 * ManagerDashboard — supervisor dashboard (WEB-003).
 * Z hierarchy: KPIs (top) → queue-by-service + agents grid (mid) → sparklines
 * + alerts (bottom). TMA 40px coloured by SLA ratio (--danger only on breach).
 * Tokens only. Realtime simulated (RT-001).
 * @module components/manager/manager-dashboard
 */
"use client";

import type { CSSProperties, ReactElement } from "react";
import { t, type Locale } from "@/lib/i18n";
import { slaColor, tmaRatio, type ManagerState } from "@/lib/manager-state";
import type { DashboardLoad } from "@/lib/use-manager-dashboard";
import { Sparkline } from "./sparkline";

/** Props for {@link ManagerDashboard}. */
export interface ManagerDashboardProps {
  /** Dashboard state. */
  state: ManagerState;
  /** Fetch lifecycle. */
  load: DashboardLoad;
  /** Read-only viewer (AUDITOR) — no action buttons. */
  readOnly?: boolean;
  /** 24h TMA sparkline series. */
  tmaSeries?: number[];
  /** J-7 delta for TMA (minutes; negative = improvement). */
  tmaDeltaJ7?: number | null;
  /** Offline flag. */
  offline?: boolean;
  /** Active locale. */
  locale?: Locale;
  /** Toggles a counter OPEN/PAUSED. */
  onToggleCounter?: (counterId: string, status: "OPEN" | "PAUSED") => void;
  /** Acknowledges an alert card. */
  onAcknowledge?: (id: string) => void;
}

const kpiValueStyle: CSSProperties = { fontSize: "40px", fontWeight: 600, lineHeight: 1 };
const inlineButton: CSSProperties = {
  minHeight: "40px",
  padding: "0 0.75rem",
  border: "1px solid var(--ink-soft)",
  borderRadius: "0.375rem",
  backgroundColor: "var(--surface-1)",
  color: "var(--ink-strong)",
  cursor: "pointer",
  fontSize: "var(--caption)",
};

/**
 * Supervisor dashboard.
 * @param props - {@link ManagerDashboardProps}.
 * @returns The dashboard element.
 */
export function ManagerDashboard({
  state,
  load,
  readOnly = false,
  tmaSeries = [],
  tmaDeltaJ7 = null,
  offline = false,
  locale = "fr",
  onToggleCounter,
  onAcknowledge,
}: ManagerDashboardProps): ReactElement {
  if (load === "loading") {
    return (
      <div data-testid="manager-skeleton" aria-busy="true" style={{ padding: "1.5rem", backgroundColor: "var(--surface-0)" }}>
        <div style={{ height: "40px", backgroundColor: "var(--surface-1)", borderRadius: "0.5rem", marginBottom: "1rem" }} />
        <div style={{ height: "200px", backgroundColor: "var(--surface-1)", borderRadius: "0.5rem" }} />
      </div>
    );
  }

  if (load === "empty" || state.kpis === null) {
    return (
      <div data-testid="manager-empty" style={{ padding: "1.5rem" }}>
        {t("manager.empty", locale)}
      </div>
    );
  }

  const tma = state.kpis.tma;
  const ratio = tmaRatio(tma.value, state.slaMinutes);
  const tmaColor = slaColor(ratio);

  return (
    <div data-testid="manager-dashboard" data-load={load} style={{ padding: "1.5rem", maxWidth: "1200px", margin: "0 auto" }}>
      {offline && (
        <div
          data-testid="manager-offline-badge"
          role="status"
          style={{ backgroundColor: "var(--warning)", color: "var(--ink-strong)", padding: "0.5rem 1rem", borderRadius: "0.5rem", marginBottom: "1rem", fontSize: "var(--caption)" }}
        >
          {t("offline.banner", locale)} {state.lastSync ? `— ${state.lastSync}` : ""}
        </div>
      )}

      {/* Z1 — KPIs globaux */}
      <section aria-label="KPIs" style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
        <div data-testid="kpi-tma" style={{ flex: 1, padding: "1rem", border: "1px solid var(--surface-1)", borderRadius: "0.5rem" }}>
          <div style={{ fontSize: "var(--caption)" }}>{t("manager.tma", locale)}</div>
          <div data-testid="kpi-tma-value" style={{ ...kpiValueStyle, color: tmaColor }}>
            {tma.value === null ? "—" : `${tma.value}`}
          </div>
          {tmaDeltaJ7 !== null && (
            <div data-testid="kpi-tma-delta" style={{ fontSize: "var(--caption)", color: "var(--ink-soft)" }}>
              {tmaDeltaJ7 <= 0 ? "▼" : "▲"} {Math.abs(tmaDeltaJ7)} {t("manager.vs_j7", locale)}
            </div>
          )}
          <Sparkline data={tmaSeries} label={`${t("manager.tma", locale)} 24h`} />
        </div>
        <div data-testid="kpi-abandon" style={{ flex: 1, padding: "1rem", border: "1px solid var(--surface-1)", borderRadius: "0.5rem" }}>
          <div style={{ fontSize: "var(--caption)" }}>{t("manager.abandon", locale)}</div>
          <div style={kpiValueStyle}>{state.kpis.tauxAbandon.value ?? "—"}%</div>
        </div>
        <div data-testid="kpi-nps" style={{ flex: 1, padding: "1rem", border: "1px solid var(--surface-1)", borderRadius: "0.5rem" }}>
          <div style={{ fontSize: "var(--caption)" }}>{t("manager.nps", locale)}</div>
          <div style={kpiValueStyle}>{state.kpis.nps ?? "—"}</div>
        </div>
      </section>

      {/* Z2 — File par service */}
      <section data-testid="queue-by-service" aria-label={t("manager.queues_by_service", locale)} style={{ marginBottom: "1.5rem" }}>
        <div style={{ fontSize: "var(--caption)", marginBottom: "0.5rem" }}>{t("manager.queues_by_service", locale)}</div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {state.queues.map((q) => (
            <li key={q.queueId} data-testid="queue-row" style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid var(--surface-1)" }}>
              <span>{q.queueId.slice(0, 8)}</span>
              <span>{q.length}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Z2 — Grille agents */}
      <section data-testid="agents-grid" aria-label={t("manager.agents_grid", locale)} style={{ marginBottom: "1.5rem" }}>
        <div style={{ fontSize: "var(--caption)", marginBottom: "0.5rem" }}>{t("manager.agents_grid", locale)}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {state.agents.map((a) => (
              <tr
                key={a.counterId}
                data-testid="agent-row"
                data-alerted={a.alerted ? "on" : "off"}
                style={{ borderBottom: "1px solid var(--surface-1)", color: a.alerted ? "var(--danger)" : "var(--ink-strong)" }}
              >
                <td style={{ padding: "0.5rem" }}>
                  {a.alerted && (
                    <span data-testid="agent-alert-icon" aria-label="alerte" role="img" style={{ color: "var(--danger)" }}>
                      ⚠
                    </span>
                  )}{" "}
                  {a.agentName}
                </td>
                <td style={{ padding: "0.5rem" }}>{a.label}</td>
                <td style={{ padding: "0.5rem" }}>{a.status}</td>
                <td style={{ padding: "0.5rem" }}>{a.ticketNumber ?? "—"}</td>
                <td style={{ padding: "0.5rem" }}>
                  {!readOnly && onToggleCounter && (
                    <button
                      type="button"
                      data-testid="agent-toggle"
                      onClick={() => onToggleCounter(a.counterId, a.status === "OPEN" ? "PAUSED" : "OPEN")}
                      style={inlineButton}
                    >
                      {a.status === "OPEN" ? t("manager.paused", locale) : t("manager.open", locale)}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Z3 — Alertes (--danger réservé aux alertes) */}
      <section data-testid="alerts-panel" aria-label={t("manager.alerts", locale)}>
        <div style={{ fontSize: "var(--caption)", marginBottom: "0.5rem" }}>{t("manager.alerts", locale)}</div>
        {state.alerts.map((al) => (
          <div
            key={al.id}
            data-testid="alert-card"
            role="alert"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1rem", marginBottom: "0.5rem", backgroundColor: "var(--danger)", color: "var(--brand-contrast)", borderRadius: "0.5rem" }}
          >
            <span>{al.type}</span>
            {!readOnly && onAcknowledge && (
              <button
                type="button"
                data-testid="alert-ack"
                onClick={() => onAcknowledge(al.id)}
                style={{ ...inlineButton, backgroundColor: "var(--surface-0)" }}
              >
                {t("manager.acknowledge", locale)}
              </button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
