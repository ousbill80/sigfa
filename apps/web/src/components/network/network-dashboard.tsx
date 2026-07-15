/**
 * NetworkDashboard — network direction dashboard (WEB-004).
 *
 * Layout: agency ranking (sorted TMA-desc, token-coloured status pills) + static
 * CI SVG map (Leaflet-free) + aggregated alert panel + network overview. Visual
 * refonte on design system v3 « Neutre Premium »: calm surfaces, --font-display
 * rank numerals, --brand accent for #1. `--danger` stays reserved for TMA > 2×SLA
 * breaches (pill/dot, never a solid fill); offline agencies use `--info`. Tokens
 * only. Realtime is simulated (RT-001).
 * @module components/network/network-dashboard
 */
"use client";

import { useState, type CSSProperties, type ReactElement } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconEntreprise,
  IconEtoile,
  KpiTile,
  OfflineBanner,
  Skeleton,
} from "@sigfa/ui";
import { t, type Locale } from "@/lib/i18n";
import {
  benchmarkBadge,
  paginate,
  type NetworkState,
} from "@/lib/network-state";
import type { NetworkLoad, NetworkOverview } from "@/lib/use-network-dashboard";
import { CiMap } from "./ci-map";

/** Route to WEB-006 agency creation (empty-state CTA target). */
const CREATE_AGENCY_HREF = "/admin/agencies/new";

/** Props for {@link NetworkDashboard}. */
export interface NetworkDashboardProps {
  /** Dashboard state. */
  state: NetworkState;
  /** Fetch lifecycle. */
  load: NetworkLoad;
  /** Configured SLA target in minutes. */
  slaMinutes: number;
  /** Network aggregate KPIs. */
  overview?: NetworkOverview | null;
  /** Active locale. */
  locale?: Locale;
}

/** Soft-tinted background derived from a functional token. */
const softOf: Record<string, string> = {
  "var(--success)": "var(--success-soft)",
  "var(--warning)": "var(--warning-soft)",
  "var(--danger)": "var(--danger-soft)",
  "var(--info)": "var(--info-soft)",
};

/**
 * Status pill for a ranking row. The functional token is carried in the inline
 * style (dot + border + ink), never as a solid fill — `--danger` stays a
 * bordered/dotted pill per the design system.
 */
const badgeStyle = (token: string): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-2)",
  minWidth: "5rem",
  padding: "var(--space-1) var(--space-3)",
  borderRadius: "var(--r-full)",
  backgroundColor: softOf[token] ?? "var(--surface-2)",
  border: `1px solid ${token}`,
  color: "var(--ink)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "var(--tracking-numeric)",
  justifyContent: "center",
  whiteSpace: "nowrap",
});

const sectionLabel: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  letterSpacing: "var(--tracking-tight)",
  textTransform: "uppercase",
  color: "var(--ink-soft)",
  marginBottom: "var(--space-3)",
};

/**
 * Network direction dashboard.
 * @param props - {@link NetworkDashboardProps}.
 * @returns The dashboard element.
 */
export function NetworkDashboard({
  state,
  load,
  slaMinutes,
  overview = null,
  locale = "fr",
}: NetworkDashboardProps): ReactElement {
  const [page, setPage] = useState(1);

  if (load === "loading") {
    return (
      <div
        data-testid="network-skeleton"
        aria-busy="true"
        style={{ padding: "var(--space-6)", backgroundColor: "var(--paper)", maxWidth: "1200px", margin: "0 auto" }}
      >
        <Skeleton style={{ height: "44px", marginBottom: "var(--space-6)" }} />
        <div style={{ display: "flex", gap: "var(--space-6)", flexWrap: "wrap" }}>
          <Skeleton style={{ flex: "2 1 480px", height: "360px" }} />
          <Skeleton style={{ flex: "1 1 320px", height: "360px" }} />
        </div>
      </div>
    );
  }

  if (load === "error") {
    return (
      <div style={{ padding: "var(--space-6)", maxWidth: "1200px", margin: "0 auto" }}>
        <Card data-testid="network-error" role="alert" style={{ padding: "var(--space-8)", textAlign: "center", color: "var(--ink)" }}>
          <p style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "var(--text-lg)", fontWeight: 600 }}>
            {t("network.error", locale)}
          </p>
        </Card>
      </div>
    );
  }

  if (load === "empty" || state.agencies.length === 0) {
    return (
      <div style={{ padding: "var(--space-6)", maxWidth: "1200px", margin: "0 auto" }}>
        <Card style={{ padding: "var(--space-8)" }}>
          <EmptyState
            data-testid="network-empty"
            icon={<IconEntreprise size="xl" />}
            title={t("network.empty", locale)}
            action={
              <a
                data-testid="network-empty-cta"
                href={CREATE_AGENCY_HREF}
                className="sig-btn sig-btn--primary sig-btn--md"
                style={{ textDecoration: "none" }}
              >
                {t("network.empty_cta", locale)}
              </a>
            }
          />
        </Card>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(state.agencies.length / 20));
  const rows = paginate(state.agencies, page);
  // Rank offset so #1 stays #1 across pages (page 2 continues 21, 22…).
  const rankBase = (page - 1) * 20;

  return (
    <div
      data-testid="network-dashboard"
      style={{ padding: "var(--space-6)", maxWidth: "1200px", margin: "0 auto", backgroundColor: "var(--paper)" }}
    >
      <header style={{ marginBottom: "var(--space-6)" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-3xl)",
            fontWeight: 600,
            letterSpacing: "var(--tracking-tight)",
            lineHeight: "var(--leading-tight)",
            color: "var(--ink)",
          }}
        >
          {t("network.title", locale)}
        </h1>
      </header>

      {state.connection === "offline" && (
        <div data-testid="network-offline-badge" style={{ marginBottom: "var(--space-6)" }}>
          <OfflineBanner message={t("network.offline", locale)} />
        </div>
      )}

      {/* Synthèse réseau (network-overview) */}
      {overview && (
        <section
          data-testid="network-overview"
          aria-label={t("network.overview", locale)}
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-4)", marginBottom: "var(--space-8)" }}
        >
          <Card style={{ padding: "var(--space-4)" }}>
            <KpiTile label={t("network.overview", locale)} value={String(overview.agencyCount)} />
          </Card>
          <Card style={{ padding: "var(--space-4)" }}>
            <KpiTile label="TMA moyen" value={`${overview.avgTma} min`} />
          </Card>
          <Card style={{ padding: "var(--space-4)" }}>
            <KpiTile label="Taux SLA moyen" value={`${overview.avgTauxSLA} %`} />
          </Card>
        </section>
      )}

      <div style={{ display: "flex", gap: "var(--space-6)", flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* Classement */}
        <section aria-label={t("network.ranking", locale)} style={{ flex: "2 1 480px", minWidth: 0 }}>
          <div style={sectionLabel}>{t("network.ranking", locale)}</div>
          <Card style={{ padding: "var(--space-2)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {rows.map((a, i) => {
                  const token = benchmarkBadge(a.tma, slaMinutes, a.offline);
                  const label = a.offline ? t("network.agency_offline", locale) : `${a.tma} min`;
                  const rank = rankBase + i + 1;
                  const isTop = rank === 1;
                  return (
                    <tr
                      key={a.agencyId}
                      data-testid="rank-row"
                      data-offline={a.offline ? "on" : "off"}
                      style={{ borderBottom: "1px solid var(--hairline)", color: "var(--ink)" }}
                    >
                      <td style={{ padding: "var(--space-3)", width: "3rem", textAlign: "right" }}>
                        <span
                          style={{
                            fontFamily: "var(--font-display)",
                            fontSize: "var(--text-lg)",
                            fontWeight: 700,
                            fontVariantNumeric: "tabular-nums",
                            letterSpacing: "var(--tracking-numeric)",
                            color: isTop ? "var(--brand-strong)" : "var(--ink-faint)",
                          }}
                        >
                          {rank}
                        </span>
                      </td>
                      <td style={{ padding: "var(--space-3)", fontWeight: 600 }}>
                        {a.agencyName}
                        {isTop && (
                          <span
                            aria-hidden="true"
                            style={{
                              marginLeft: "var(--space-2)",
                              color: "var(--brand)",
                              verticalAlign: "-2px",
                              display: "inline-flex",
                            }}
                          >
                            <IconEtoile size="sm" />
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "var(--space-3)", color: "var(--ink-soft)", fontSize: "var(--text-sm)" }}>
                        {a.city}
                      </td>
                      <td style={{ padding: "var(--space-3)", textAlign: "right" }}>
                        <span data-testid="rank-badge" role="img" aria-label={label} style={badgeStyle(token)}>
                          <span aria-hidden="true" style={{ width: "6px", height: "6px", borderRadius: "var(--r-full)", backgroundColor: token }} />
                          {label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {totalPages > 1 && (
            <nav
              aria-label={t("network.page", locale)}
              style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", marginTop: "var(--space-4)" }}
            >
              <Button
                variant="secondary"
                size="dense"
                data-testid="page-prev"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t("network.prev", locale)}
              </Button>
              <span data-testid="page-indicator" style={{ fontSize: "var(--text-sm)", color: "var(--ink-soft)", fontVariantNumeric: "tabular-nums" }}>
                {t("network.page", locale)} {page} / {totalPages}
              </span>
              <Button
                variant="secondary"
                size="dense"
                data-testid="page-next"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t("network.next", locale)}
              </Button>
            </nav>
          )}
        </section>

        {/* Carte SVG statique CI */}
        <section aria-label={t("network.map", locale)} style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div style={sectionLabel}>{t("network.map", locale)}</div>
          <Card style={{ padding: "var(--space-4)" }}>
            <CiMap agencies={state.agencies} slaMinutes={slaMinutes} />
          </Card>
        </section>
      </div>

      {/* Panneau alertes agrégé */}
      <section data-testid="network-alerts" aria-label={t("network.alerts", locale)} style={{ marginTop: "var(--space-8)" }}>
        <div style={sectionLabel}>{t("network.alerts", locale)}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {state.alerts.map((al) => (
            <Card
              key={al.id}
              data-testid="network-alert"
              role="alert"
              style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", padding: "var(--space-4)" }}
            >
              <Badge tone="danger" dot>
                {al.type}
              </Badge>
              <span style={{ fontWeight: 600, color: "var(--ink)" }}>{al.agencyName || al.agencyId}</span>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
