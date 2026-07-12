/**
 * ComexDashboard — quality steering / COMEX dashboard (WEB-005).
 *
 * Renders EXACTLY 3 KPIs (Design System "une information principale") — NPS
 * global réseau, TMA moyen réseau, Volume clients servis — each at 40px. Data
 * comes from the canonical GET /reports/kpis?scope=network route (never the
 * rejected /reports/comex). TV mode applies the `comex-tv` root class (typo +
 * spacing ×1.5 via `--scale-tv: 1.5`) at a 16:9 aspect ratio, hides interactive
 * controls (read-only projection), and keeps the KPIs live. `--danger` is
 * reserved for real alerts (TMA > 2×SLA, negative NPS) — never decorative.
 * Partial months are annotated "données partielles" instead of a raw 0. Tokens
 * only; realtime simulated (RT-001).
 * @module components/comex/comex-dashboard
 */
"use client";

import type { CSSProperties, ReactElement } from "react";
import { t, type Locale } from "@/lib/i18n";
import {
  npsColor,
  tmaSlaColor,
  COMEX_KPI_COUNT,
  type ComexKpis,
} from "@/lib/comex-state";
import type { ComexLoad } from "@/lib/use-comex-dashboard";

/** Props for {@link ComexDashboard}. */
export interface ComexDashboardProps {
  /** The derived 3 KPIs (null while loading/error). */
  kpis: ComexKpis | null;
  /** Fetch lifecycle. */
  load: ComexLoad;
  /** Configured network SLA target in minutes (TMA colouring). */
  slaMinutes: number;
  /** TV projection mode (typo/spacing ×1.5, controls hidden, read-only). */
  tvMode?: boolean;
  /** Whether the viewer may toggle TV mode (BANK_ADMIN+). */
  canToggleTv?: boolean;
  /** Toggle handler for TV mode (shown only when {@link canToggleTv} and not already in TV mode). */
  onToggleTv?: () => void;
  /** Offline flag — discreet banner, KPIs kept visible. */
  offline?: boolean;
  /** prefers-reduced-motion — KPI transitions become instant. */
  reducedMotion?: boolean;
  /** Active locale. */
  locale?: Locale;
}

/** KPI value base style — 40px per WEB-005; colour/transition applied per KPI. */
function valueStyle(color: string, reducedMotion: boolean): CSSProperties {
  return {
    fontSize: "40px",
    fontWeight: 600,
    lineHeight: 1,
    color,
    transition: reducedMotion ? "none" : "color 200ms linear",
  };
}

const cardStyle: CSSProperties = {
  flex: 1,
  minWidth: "12rem",
  padding: "1rem",
  border: "1px solid var(--surface-1)",
  borderRadius: "0.5rem",
  backgroundColor: "var(--surface-0)",
};

const labelStyle: CSSProperties = { fontSize: "var(--caption)", color: "var(--ink-soft)" };
const deltaStyle: CSSProperties = { fontSize: "var(--caption)", color: "var(--ink-soft)" };
const partialStyle: CSSProperties = { fontSize: "var(--caption)", color: "var(--warning)" };

const toggleStyle: CSSProperties = {
  minHeight: "40px",
  padding: "0 1rem",
  border: "1px solid var(--ink-soft)",
  borderRadius: "0.375rem",
  backgroundColor: "var(--surface-1)",
  color: "var(--ink-strong)",
  cursor: "pointer",
  fontSize: "var(--caption)",
};

/** Formats a signed delta with an arrow (▲/▼). */
function signed(delta: number): string {
  const arrow = delta >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(delta)}`;
}

/** Formats a signed percentage delta. */
function signedPct(delta: number): string {
  const arrow = delta >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(delta).toFixed(1)} %`;
}

/**
 * COMEX quality dashboard.
 * @param props - {@link ComexDashboardProps}.
 * @returns The dashboard element.
 */
export function ComexDashboard({
  kpis,
  load,
  slaMinutes,
  tvMode = false,
  canToggleTv = false,
  onToggleTv,
  offline = false,
  reducedMotion = false,
  locale = "fr",
}: ComexDashboardProps): ReactElement {
  if (load === "loading") {
    return (
      <div data-testid="comex-skeleton" aria-busy="true" style={{ padding: "1.5rem", backgroundColor: "var(--surface-0)" }}>
        <div style={{ display: "flex", gap: "1rem" }}>
          {Array.from({ length: COMEX_KPI_COUNT }).map((_, i) => (
            <div
              key={i}
              data-testid="comex-skeleton-kpi"
              style={{ flex: 1, height: "120px", backgroundColor: "var(--surface-1)", borderRadius: "0.5rem" }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (load === "error" || kpis === null) {
    return (
      <div data-testid="comex-error" role="alert" style={{ padding: "1.5rem", color: "var(--ink-strong)" }}>
        {t("comex.error", locale)}
      </div>
    );
  }

  const rootStyle: CSSProperties = tvMode
    ? { padding: "2.25rem", margin: "0 auto", aspectRatio: "16 / 9", maxWidth: "1920px", backgroundColor: "var(--surface-0)" }
    : { padding: "1.5rem", maxWidth: "1200px", margin: "0 auto", backgroundColor: "var(--surface-0)" };

  const npsCol = npsColor(kpis.nps.value);
  const tmaCol = kpis.tma.value === null ? "var(--ink-strong)" : tmaSlaColor(kpis.tma.value, slaMinutes);

  return (
    <div
      data-testid="comex-dashboard"
      data-tv={tvMode ? "on" : "off"}
      className={tvMode ? "comex-tv" : "comex"}
      style={rootStyle}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: tvMode ? "1.5rem" : "1.125rem", color: "var(--ink-strong)", margin: 0 }}>
          {t("comex.title", locale)}
        </h1>
        {/* Interactive controls are hidden in the read-only TV projection. */}
        {!tvMode && canToggleTv && onToggleTv && (
          <button type="button" data-testid="comex-tv-toggle" onClick={onToggleTv} style={toggleStyle}>
            {t("comex.tv_on", locale)}
          </button>
        )}
      </header>

      {/* Offline banner — discreet, never hides the KPIs. */}
      {offline && (
        <div
          data-testid="comex-offline-banner"
          role="status"
          aria-live="polite"
          style={{ backgroundColor: "var(--warning)", color: "var(--ink-strong)", padding: "0.5rem 1rem", borderRadius: "0.5rem", marginBottom: "1rem", fontSize: "var(--caption)" }}
        >
          {t("comex.offline", locale)}
        </div>
      )}

      <section aria-label={t("comex.title", locale)} style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {/* KPI 1 — NPS global réseau */}
        <div data-testid="comex-kpi" style={cardStyle}>
          <div data-testid="kpi-nps" style={labelStyle}>{t("comex.nps", locale)}</div>
          <div data-testid="kpi-nps-value" style={valueStyle(npsCol, reducedMotion)}>
            {kpis.nps.value === null ? "—" : kpis.nps.value}
          </div>
          {kpis.nps.partial ? (
            <div data-testid="kpi-nps-partial" style={partialStyle}>{t("comex.partial", locale)}</div>
          ) : (
            kpis.nps.delta !== null && (
              <div data-testid="kpi-nps-delta" style={deltaStyle}>
                {signed(kpis.nps.delta)} {t("comex.vs_previous", locale)}
              </div>
            )
          )}
        </div>

        {/* KPI 2 — TMA moyen réseau */}
        <div data-testid="comex-kpi" style={cardStyle}>
          <div data-testid="kpi-tma" style={labelStyle}>{t("comex.tma", locale)}</div>
          <div data-testid="kpi-tma-value" style={valueStyle(tmaCol, reducedMotion)}>
            {kpis.tma.value === null ? "—" : kpis.tma.value}
          </div>
          {kpis.tma.partial && (
            <div data-testid="kpi-tma-partial" style={partialStyle}>{t("comex.partial", locale)}</div>
          )}
        </div>

        {/* KPI 3 — Volume clients servis */}
        <div data-testid="comex-kpi" style={cardStyle}>
          <div data-testid="kpi-volume" style={labelStyle}>{t("comex.volume", locale)}</div>
          <div data-testid="kpi-volume-value" style={valueStyle("var(--ink-strong)", reducedMotion)}>
            {kpis.volume.value}
          </div>
          {kpis.volume.partial ? (
            <div data-testid="kpi-volume-partial" style={partialStyle}>{t("comex.partial", locale)}</div>
          ) : (
            kpis.volume.deltaPct !== null && (
              <div data-testid="kpi-volume-delta" style={deltaStyle}>
                {signedPct(kpis.volume.deltaPct)} {t("comex.vs_previous", locale)}
              </div>
            )
          )}
        </div>
      </section>
    </div>
  );
}
