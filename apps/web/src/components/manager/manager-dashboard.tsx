/**
 * ManagerDashboard — supervisor dashboard (WEB-003).
 * Z hierarchy: KPIs (top) → queue-by-service + agents grid (mid) → sparklines
 * + alerts (bottom). TMA 40px coloured by SLA ratio (--danger only on breach).
 * v2 « Sérénité Premium » — @sigfa/ui components + tokens only. Realtime
 * simulated (RT-001).
 * @module components/manager/manager-dashboard
 */
"use client";

import type { CSSProperties, ReactElement } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconAlerte,
  IconStatistiques,
  KpiTile,
  Skeleton,
} from "@sigfa/ui";
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

/** Section heading — overline caps, discreet ink-soft. */
const overlineStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-faint)",
  margin: "0 0 var(--space-3)",
};

/** KPI value glyph — 40px tabular, kept inline for the SLA colour token. */
const kpiValueStyle: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "40px",
  fontWeight: 600,
  lineHeight: 1,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "var(--tracking-numeric)",
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
      <div
        data-testid="manager-skeleton"
        aria-busy="true"
        style={{
          padding: "var(--space-8)",
          backgroundColor: "var(--surface-0)",
          maxWidth: "1200px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-6)",
        }}
      >
        <div style={{ display: "flex", gap: "var(--space-4)" }}>
          <Skeleton style={{ flex: 1, height: "132px", borderRadius: "var(--r-lg)" }} />
          <Skeleton style={{ flex: 1, height: "132px", borderRadius: "var(--r-lg)" }} />
          <Skeleton style={{ flex: 1, height: "132px", borderRadius: "var(--r-lg)" }} />
        </div>
        <Skeleton style={{ height: "220px", borderRadius: "var(--r-lg)" }} />
      </div>
    );
  }

  if (load === "empty" || state.kpis === null) {
    return (
      <div
        data-testid="manager-empty"
        style={{ padding: "var(--space-12) var(--space-6)", maxWidth: "1200px", margin: "0 auto" }}
      >
        <EmptyState
          icon={<IconStatistiques size="xl" />}
          title={t("manager.empty", locale)}
        />
      </div>
    );
  }

  const tma = state.kpis.tma;
  const ratio = tmaRatio(tma.value, state.slaMinutes);
  const tmaColor = slaColor(ratio);
  const tmaTrend = tmaDeltaJ7 === null ? "flat" : tmaDeltaJ7 <= 0 ? "down" : "up";

  return (
    <div
      data-testid="manager-dashboard"
      data-load={load}
      style={{
        padding: "var(--space-8)",
        maxWidth: "1200px",
        margin: "0 auto",
        backgroundColor: "var(--paper)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
      }}
    >
      {offline && (
        <div
          data-testid="manager-offline-badge"
          role="status"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
            alignSelf: "flex-start",
            backgroundColor: "var(--info-soft)",
            color: "var(--info)",
            padding: "var(--space-2) var(--space-4)",
            borderRadius: "var(--r-full)",
            fontSize: "var(--text-sm)",
            fontWeight: 500,
          }}
        >
          {t("offline.banner", locale)} {state.lastSync ? `— ${state.lastSync}` : ""}
        </div>
      )}

      {/* Z1 — KPIs globaux */}
      <section
        aria-label="KPIs"
        style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}
      >
        <Card data-testid="kpi-tma" style={{ flex: "1 1 240px" }}>
          <span style={overlineStyle}>{t("manager.tma", locale)}</span>
          <div
            data-testid="kpi-tma-value"
            style={{ ...kpiValueStyle, color: tmaColor }}
          >
            {tma.value === null ? "—" : `${tma.value}`}
          </div>
          {tmaDeltaJ7 !== null && (
            <div
              data-testid="kpi-tma-delta"
              style={{
                marginTop: "var(--space-2)",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
                color: tmaTrend === "up" ? "var(--warning)" : "var(--forest)",
              }}
            >
              {tmaDeltaJ7 <= 0 ? "▼" : "▲"} {Math.abs(tmaDeltaJ7)} {t("manager.vs_j7", locale)}
            </div>
          )}
          <Sparkline data={tmaSeries} label={`${t("manager.tma", locale)} 24h`} stroke="var(--brand)" />
        </Card>

        <Card data-testid="kpi-abandon" style={{ flex: "1 1 240px" }}>
          <KpiTile
            label={t("manager.abandon", locale)}
            value={`${state.kpis.tauxAbandon.value ?? "—"}%`}
          />
        </Card>

        <Card data-testid="kpi-nps" style={{ flex: "1 1 240px" }}>
          <KpiTile
            label={t("manager.nps", locale)}
            value={`${state.kpis.nps ?? "—"}`}
          />
        </Card>
      </section>

      <div
        style={{
          display: "grid",
          gap: "var(--space-6)",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)",
        }}
      >
        {/* Z2 — File par service */}
        <Card data-testid="queue-by-service" aria-label={t("manager.queues_by_service", locale)}>
          <p style={overlineStyle}>{t("manager.queues_by_service", locale)}</p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {state.queues.map((q) => (
              <li
                key={q.queueId}
                data-testid="queue-row"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "var(--space-3) 0",
                  borderBottom: "1px solid var(--hairline)",
                  fontFamily: "var(--font-text)",
                  color: "var(--ink)",
                }}
              >
                <span style={{ color: "var(--ink-soft)", fontVariantNumeric: "tabular-nums" }}>
                  {q.queueId.slice(0, 8)}
                </span>
                <Badge tone={q.length > 8 ? "warning" : "brand"}>{q.length}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        {/* Z2 — Grille agents */}
        <Card data-testid="agents-grid" aria-label={t("manager.agents_grid", locale)}>
          <p style={overlineStyle}>{t("manager.agents_grid", locale)}</p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-text)" }}>
            <tbody>
              {state.agents.map((a) => (
                <tr
                  key={a.counterId}
                  data-testid="agent-row"
                  data-alerted={a.alerted ? "on" : "off"}
                  style={{
                    borderBottom: "1px solid var(--hairline)",
                    color: a.alerted ? "var(--danger)" : "var(--ink)",
                  }}
                >
                  <td style={{ padding: "var(--space-3) var(--space-2)", fontWeight: 500 }}>
                    {a.alerted && (
                      <span
                        data-testid="agent-alert-icon"
                        aria-label="alerte"
                        role="img"
                        style={{
                          color: "var(--danger)",
                          marginRight: "var(--space-1)",
                          display: "inline-flex",
                          verticalAlign: "-3px",
                        }}
                      >
                        <IconAlerte size="sm" />
                      </span>
                    )}{" "}
                    {a.agentName}
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-2)", color: "var(--ink-soft)" }}>
                    {a.label}
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-2)" }}>
                    <Badge tone={a.status === "OPEN" ? "success" : "info"} dot>
                      {a.status}
                    </Badge>
                  </td>
                  <td
                    style={{
                      padding: "var(--space-3) var(--space-2)",
                      color: "var(--ink-soft)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {a.ticketNumber ?? "—"}
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-2)", textAlign: "right" }}>
                    {!readOnly && onToggleCounter && (
                      <Button
                        variant="secondary"
                        size="dense"
                        data-testid="agent-toggle"
                        onClick={() =>
                          onToggleCounter(a.counterId, a.status === "OPEN" ? "PAUSED" : "OPEN")
                        }
                      >
                        {a.status === "OPEN" ? t("manager.paused", locale) : t("manager.open", locale)}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Z3 — Alertes (--danger réservé aux alertes) */}
      <section data-testid="alerts-panel" aria-label={t("manager.alerts", locale)}>
        <p style={overlineStyle}>{t("manager.alerts", locale)}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {state.alerts.map((al) => (
            <div
              key={al.id}
              data-testid="alert-card"
              role="alert"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "var(--space-3) var(--space-4)",
                backgroundColor: "var(--danger-soft)",
                color: "var(--danger)",
                borderRadius: "var(--r-md)",
                borderLeft: "3px solid var(--danger)",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontWeight: 600 }}>
                <Badge tone="danger" dot>
                  {al.type}
                </Badge>
              </span>
              {!readOnly && onAcknowledge && (
                <Button
                  variant="ghost"
                  size="dense"
                  data-testid="alert-ack"
                  onClick={() => onAcknowledge(al.id)}
                >
                  {t("manager.acknowledge", locale)}
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
