/**
 * NetworkDashboard — network direction dashboard (WEB-004).
 *
 * Layout: agency ranking (sorted TMA-desc, coloured badges) + static CI SVG map
 * (Leaflet-free) + aggregated alert panel + network overview. `--danger` is
 * reserved for TMA > 2×SLA breaches and is never decorative; offline agencies
 * are shown with `--info`. Tokens only. Realtime is simulated (RT-001).
 * @module components/network/network-dashboard
 */
"use client";

import { useState, type CSSProperties, type ReactElement } from "react";
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

const badgeStyle = (token: string): CSSProperties => ({
  display: "inline-block",
  minWidth: "3.5rem",
  padding: "0.15rem 0.5rem",
  borderRadius: "0.375rem",
  backgroundColor: token,
  color: "var(--brand-contrast)",
  fontSize: "var(--caption)",
  fontWeight: 600,
  textAlign: "center",
});

const pageButton: CSSProperties = {
  minHeight: "40px",
  padding: "0 1rem",
  border: "1px solid var(--ink-soft)",
  borderRadius: "0.375rem",
  backgroundColor: "var(--surface-1)",
  color: "var(--ink-strong)",
  cursor: "pointer",
  fontSize: "var(--caption)",
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
      <div data-testid="network-skeleton" aria-busy="true" style={{ padding: "1.5rem", backgroundColor: "var(--surface-0)" }}>
        <div style={{ height: "40px", backgroundColor: "var(--surface-1)", borderRadius: "0.5rem", marginBottom: "1rem" }} />
        <div style={{ height: "320px", backgroundColor: "var(--surface-1)", borderRadius: "0.5rem" }} />
      </div>
    );
  }

  if (load === "error") {
    return (
      <div data-testid="network-error" role="alert" style={{ padding: "1.5rem", color: "var(--ink-strong)" }}>
        {t("network.error", locale)}
      </div>
    );
  }

  if (load === "empty" || state.agencies.length === 0) {
    return (
      <div data-testid="network-empty" style={{ padding: "1.5rem", color: "var(--ink-strong)" }}>
        <p>{t("network.empty", locale)}</p>
        <a data-testid="network-empty-cta" href={CREATE_AGENCY_HREF} style={{ ...pageButton, display: "inline-block", textDecoration: "none", marginTop: "0.75rem" }}>
          {t("network.empty_cta", locale)}
        </a>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(state.agencies.length / 20));
  const rows = paginate(state.agencies, page);

  return (
    <div data-testid="network-dashboard" style={{ padding: "1.5rem", maxWidth: "1200px", margin: "0 auto" }}>
      {state.connection === "offline" && (
        <div
          data-testid="network-offline-badge"
          role="status"
          style={{ backgroundColor: "var(--info)", color: "var(--brand-contrast)", padding: "0.5rem 1rem", borderRadius: "0.5rem", marginBottom: "1rem", fontSize: "var(--caption)" }}
        >
          {t("network.offline", locale)}
        </div>
      )}

      {/* Synthèse réseau (network-overview) */}
      {overview && (
        <section data-testid="network-overview" aria-label={t("network.overview", locale)} style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ flex: 1, padding: "1rem", border: "1px solid var(--surface-1)", borderRadius: "0.5rem" }}>
            <div style={{ fontSize: "var(--caption)", color: "var(--ink-soft)" }}>{t("network.overview", locale)}</div>
            <div style={{ fontSize: "28px", fontWeight: 600 }}>{overview.agencyCount}</div>
          </div>
        </section>
      )}

      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
        {/* Classement */}
        <section aria-label={t("network.ranking", locale)} style={{ flex: "2 1 480px", minWidth: 0 }}>
          <div style={{ fontSize: "var(--caption)", marginBottom: "0.5rem", color: "var(--ink-soft)" }}>{t("network.ranking", locale)}</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {rows.map((a) => {
                const token = benchmarkBadge(a.tma, slaMinutes, a.offline);
                const label = a.offline ? t("network.agency_offline", locale) : `${a.tma} min`;
                return (
                  <tr
                    key={a.agencyId}
                    data-testid="rank-row"
                    data-offline={a.offline ? "on" : "off"}
                    style={{ borderBottom: "1px solid var(--surface-1)", color: "var(--ink-strong)" }}
                  >
                    <td style={{ padding: "0.5rem", fontWeight: 600 }}>{a.agencyName}</td>
                    <td style={{ padding: "0.5rem", color: "var(--ink-soft)" }}>{a.city}</td>
                    <td style={{ padding: "0.5rem", textAlign: "right" }}>
                      <span data-testid="rank-badge" role="img" aria-label={label} style={badgeStyle(token)}>
                        {label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {totalPages > 1 && (
            <nav aria-label={t("network.page", locale)} style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "0.75rem" }}>
              <button type="button" data-testid="page-prev" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={pageButton}>
                {t("network.prev", locale)}
              </button>
              <span data-testid="page-indicator" style={{ fontSize: "var(--caption)" }}>
                {t("network.page", locale)} {page} / {totalPages}
              </span>
              <button type="button" data-testid="page-next" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} style={pageButton}>
                {t("network.next", locale)}
              </button>
            </nav>
          )}
        </section>

        {/* Carte SVG statique CI */}
        <section aria-label={t("network.map", locale)} style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div style={{ fontSize: "var(--caption)", marginBottom: "0.5rem", color: "var(--ink-soft)" }}>{t("network.map", locale)}</div>
          <CiMap agencies={state.agencies} slaMinutes={slaMinutes} />
        </section>
      </div>

      {/* Panneau alertes agrégé */}
      <section data-testid="network-alerts" aria-label={t("network.alerts", locale)} style={{ marginTop: "1.5rem" }}>
        <div style={{ fontSize: "var(--caption)", marginBottom: "0.5rem", color: "var(--ink-soft)" }}>{t("network.alerts", locale)}</div>
        {state.alerts.map((al) => (
          <div
            key={al.id}
            data-testid="network-alert"
            role="alert"
            style={{ display: "flex", gap: "0.75rem", alignItems: "center", padding: "0.75rem 1rem", marginBottom: "0.5rem", backgroundColor: "var(--danger)", color: "var(--brand-contrast)", borderRadius: "0.5rem" }}
          >
            <span aria-hidden="true">⚠</span>
            <span style={{ fontWeight: 600 }}>{al.agencyName || al.agencyId}</span>
            <span>{al.type}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
