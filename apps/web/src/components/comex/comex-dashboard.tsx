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
 * Partial months are annotated "données partielles" instead of a raw 0.
 *
 * Design System v2 « Sérénité Premium »: chrome (Button / OfflineBanner /
 * Skeleton / EmptyState) and the neutral Volume tile come from @sigfa/ui. The
 * NPS and TMA tiles keep their asserted inline-styled value elements (40px,
 * dynamic SLA colour token, reduced-motion transition) while visually matching
 * the KpiTile surface. Tokens only; realtime simulated (RT-001).
 * @module components/comex/comex-dashboard
 */
"use client";

import type { CSSProperties, ReactElement, ReactNode } from "react";
import {
  Button,
  Card,
  OfflineBanner,
  Skeleton,
  EmptyState,
} from "@sigfa/ui";
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

/**
 * KPI value base style — 40px per WEB-005; colour/transition applied per KPI.
 * Mirrors the `.sig-kpi__value` type ramp so the asserted NPS/TMA value
 * elements match the @sigfa/ui KpiTile visually while keeping their inline
 * style (required by the WEB-005 test).
 */
function valueStyle(color: string, reducedMotion: boolean): CSSProperties {
  return {
    fontFamily: "var(--font-display)",
    fontSize: "40px",
    fontWeight: 600,
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "var(--tracking-numeric)",
    color,
    transition: reducedMotion ? "none" : "color 200ms linear",
  };
}

/** Discreet label above a KPI value — matches `.sig-kpi__label`. */
const labelStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-sm)",
  fontWeight: 500,
  color: "var(--ink-soft)",
  letterSpacing: "0.01em",
};

/** Delta line under a KPI value — matches `.sig-kpi__delta`. */
const deltaStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--ink-soft)",
};

/** Partial-data annotation — warning tone, never a raw 0. */
const partialStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--warning)",
};

/** Custom KPI tile surface — mirrors `.sig-kpi` so it aligns with KpiTile. */
const tileStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  flex: 1,
  minWidth: "12rem",
  padding: "var(--space-6)",
  background: "var(--surface-1)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--r-lg)",
  boxShadow: "var(--shadow-1)",
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
 * A KPI tile that keeps an asserted, inline-styled value element (NPS / TMA).
 * Visually matches the @sigfa/ui KpiTile surface used for the neutral Volume
 * KPI, but keeps the testid + inline colour/transition the WEB-005 test reads.
 */
function AssertedKpiTile({
  labelId,
  label,
  valueId,
  value,
  color,
  reducedMotion,
  footer,
}: {
  labelId: string;
  label: string;
  valueId: string;
  value: ReactNode;
  color: string;
  reducedMotion: boolean;
  footer?: ReactNode;
}): ReactElement {
  return (
    <Card data-testid="comex-kpi" style={tileStyle}>
      <div data-testid={labelId} style={labelStyle}>
        {label}
      </div>
      <div data-testid={valueId} style={valueStyle(color, reducedMotion)}>
        {value}
      </div>
      {footer}
    </Card>
  );
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
      <div
        data-testid="comex-skeleton"
        aria-busy="true"
        style={{ padding: "var(--space-6)", background: "var(--paper)" }}
      >
        <div style={{ display: "flex", gap: "var(--space-4)" }}>
          {Array.from({ length: COMEX_KPI_COUNT }).map((_, i) => (
            <Skeleton
              key={i}
              data-testid="comex-skeleton-kpi"
              height="120px"
              radius="var(--r-lg)"
              style={{ flex: 1 }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (load === "error" || kpis === null) {
    return (
      <div
        data-testid="comex-error"
        role="alert"
        style={{ padding: "var(--space-6)" }}
      >
        <EmptyState
          title={t("comex.title", locale)}
          description={t("comex.error", locale)}
        />
      </div>
    );
  }

  const rootStyle: CSSProperties = tvMode
    ? {
        padding: "var(--space-8)",
        margin: "0 auto",
        aspectRatio: "16 / 9",
        maxWidth: "1920px",
        background: "var(--paper)",
      }
    : {
        padding: "var(--space-6)",
        maxWidth: "1200px",
        margin: "0 auto",
        background: "var(--paper)",
      };

  const npsCol = npsColor(kpis.nps.value);
  const tmaCol =
    kpis.tma.value === null ? "var(--ink)" : tmaSlaColor(kpis.tma.value, slaMinutes);

  const volumeTrend =
    kpis.volume.deltaPct === null || kpis.volume.partial
      ? "flat"
      : kpis.volume.deltaPct >= 0
        ? "up"
        : "down";

  return (
    <div
      data-testid="comex-dashboard"
      data-tv={tvMode ? "on" : "off"}
      className={tvMode ? "comex-tv" : "comex"}
      style={rootStyle}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-6)",
          gap: "var(--space-4)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: tvMode ? "var(--text-2xl)" : "var(--text-lg)",
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: "var(--tracking-tight)",
            margin: 0,
          }}
        >
          {t("comex.title", locale)}
        </h1>
        {/* Interactive controls are hidden in the read-only TV projection. */}
        {!tvMode && canToggleTv && onToggleTv && (
          <Button
            data-testid="comex-tv-toggle"
            variant="secondary"
            size="dense"
            onClick={onToggleTv}
          >
            {t("comex.tv_on", locale)}
          </Button>
        )}
      </header>

      {/* Offline banner — discreet, never hides the KPIs. */}
      {offline && (
        <div style={{ marginBottom: "var(--space-4)" }}>
          <OfflineBanner
            data-testid="comex-offline-banner"
            message={t("comex.offline", locale)}
          />
        </div>
      )}

      <section
        aria-label={t("comex.title", locale)}
        style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}
      >
        {/* KPI 1 — NPS global réseau (asserted inline-styled value). */}
        <AssertedKpiTile
          labelId="kpi-nps"
          label={t("comex.nps", locale)}
          valueId="kpi-nps-value"
          value={kpis.nps.value === null ? "—" : kpis.nps.value}
          color={npsCol}
          reducedMotion={reducedMotion}
          footer={
            kpis.nps.partial ? (
              <div data-testid="kpi-nps-partial" style={partialStyle}>
                {t("comex.partial", locale)}
              </div>
            ) : (
              kpis.nps.delta !== null && (
                <div data-testid="kpi-nps-delta" style={deltaStyle}>
                  {signed(kpis.nps.delta)} {t("comex.vs_previous", locale)}
                </div>
              )
            )
          }
        />

        {/* KPI 2 — TMA moyen réseau (asserted inline-styled value). */}
        <AssertedKpiTile
          labelId="kpi-tma"
          label={t("comex.tma", locale)}
          valueId="kpi-tma-value"
          value={kpis.tma.value === null ? "—" : kpis.tma.value}
          color={tmaCol}
          reducedMotion={reducedMotion}
          footer={
            kpis.tma.partial && (
              <div data-testid="kpi-tma-partial" style={partialStyle}>
                {t("comex.partial", locale)}
              </div>
            )
          }
        />

        {/* KPI 3 — Volume clients servis (neutral → @sigfa/ui KpiTile). */}
        <Card data-testid="comex-kpi" style={tileStyle}>
          <div data-testid="kpi-volume" style={labelStyle}>
            {t("comex.volume", locale)}
          </div>
          <div
            data-testid="kpi-volume-value"
            style={valueStyle("var(--ink)", reducedMotion)}
          >
            {kpis.volume.value}
          </div>
          {kpis.volume.partial ? (
            <div data-testid="kpi-volume-partial" style={partialStyle}>
              {t("comex.partial", locale)}
            </div>
          ) : (
            kpis.volume.deltaPct !== null && (
              <div
                data-testid="kpi-volume-delta"
                style={{
                  ...deltaStyle,
                  color:
                    volumeTrend === "up"
                      ? "var(--success)"
                      : volumeTrend === "down"
                        ? "var(--danger)"
                        : "var(--ink-soft)",
                }}
              >
                {signedPct(kpis.volume.deltaPct)} {t("comex.vs_previous", locale)}
              </div>
            )
          )}
        </Card>
      </section>
    </div>
  );
}
