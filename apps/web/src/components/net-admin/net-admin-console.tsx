/**
 * NetAdminConsole — Super Admin cross-tenant network console (NET-001-WEB).
 *
 * READ-ONLY pilotage: per-bank aggregates (agencies, kiosks online/offline,
 * aggregated tickets, uptime, health VERT/ORANGE/ROUGE) + a network synthesis.
 * ZERO customer data is ever rendered — the view model is already sanitized by
 * the client allow-list (net-admin-allowlist), and the guarantee notice
 * « Agrégat réseau — aucune donnée client » is visible on every cross-tenant
 * view. No mutation control exists in the DOM (no button/form/input that would
 * write): the surface is purely informational. Design System v2 « Sérénité
 * Premium »: @sigfa/ui primitives, tokens only, zero emoji, `--danger` as a
 * bordered pill/dot (never a solid red fill). FR/EN, icon+text paired.
 * @module components/net-admin/net-admin-console
 */
"use client";

import type { CSSProperties, ReactElement } from "react";
import {
  Badge,
  Card,
  EmptyState,
  Heading,
  KpiTile,
  OfflineBanner,
  Overline,
  SectionTitle,
  Skeleton,
} from "@sigfa/ui";
import { t, type Locale } from "@/lib/i18n";
import type {
  NetAdminLoad,
} from "@/lib/use-net-admin-console";
import type {
  NetworkBankRow,
  NetworkHealth,
  NetworkOverviewView,
} from "@/lib/net-admin-allowlist";

/** Props for {@link NetAdminConsole}. */
export interface NetAdminConsoleProps {
  /** Sanitized view model (null while loading/error). */
  view: NetworkOverviewView | null;
  /** Fetch lifecycle (one of the 5 states). */
  load: NetAdminLoad;
  /** Active locale. */
  locale?: Locale;
}

/** Number of tiles in the network synthesis. */
export const NET_SYNTHESIS_TILE_COUNT = 6;

const rootStyle: CSSProperties = {
  padding: "var(--space-6)",
  maxWidth: "1200px",
  margin: "0 auto",
  background: "var(--paper)",
};

const subtitleStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-sm)",
  color: "var(--ink-soft)",
  margin: "var(--space-1) 0 0",
};

const cellStyle: CSSProperties = {
  padding: "var(--space-3) var(--space-4)",
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-sm)",
  color: "var(--ink)",
  textAlign: "left",
  borderBottom: "1px solid var(--hairline)",
};

const headCellStyle: CSSProperties = {
  ...cellStyle,
  color: "var(--ink-soft)",
  fontWeight: 600,
  letterSpacing: "0.01em",
};

const numCellStyle: CSSProperties = {
  ...cellStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

/** Maps aggregated health to a Badge tone (danger = dot, never a solid fill). */
function healthTone(health: NetworkHealth | null): "success" | "warning" | "danger" | "info" {
  switch (health) {
    case "VERT":
      return "success";
    case "ORANGE":
      return "warning";
    case "ROUGE":
      return "danger";
    default:
      return "info";
  }
}

/** i18n label for an aggregated health value. */
function healthLabel(health: NetworkHealth | null, locale: Locale): string {
  switch (health) {
    case "VERT":
      return t("netAdmin.health.vert", locale);
    case "ORANGE":
      return t("netAdmin.health.orange", locale);
    case "ROUGE":
      return t("netAdmin.health.rouge", locale);
    default:
      return t("netAdmin.health.na", locale);
  }
}

/** Formats a nullable percentage. */
function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} %`;
}

/** The always-visible guarantee notice (aucune donnée client). */
function GuaranteeNotice({ locale }: { locale: Locale }): ReactElement {
  return (
    <div
      data-testid="net-admin-guarantee"
      role="note"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        marginTop: "var(--space-3)",
        padding: "var(--space-2) var(--space-3)",
        background: "var(--success-soft)",
        borderRadius: "var(--r-full)",
        fontFamily: "var(--font-text)",
        fontSize: "var(--text-sm)",
        fontWeight: 600,
        color: "var(--success)",
      }}
    >
      {/* Icône bouclier (SVG token-colored) appariée au texte — zéro emoji. */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M8 1.5 2.5 3.5v4C2.5 11 5 13.5 8 14.5c3-1 5.5-3.5 5.5-7v-4L8 1.5Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="m5.8 8 1.6 1.6L10.4 6.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {t("netAdmin.guarantee", locale)}
    </div>
  );
}

/** Console header with title, subtitle, read-only + guarantee notices. */
function ConsoleHeader({ locale }: { locale: Locale }): ReactElement {
  return (
    <header style={{ marginBottom: "var(--space-6)" }}>
      <Overline>{t("netAdmin.guarantee", locale)}</Overline>
      <Heading size="xl">{t("netAdmin.title", locale)}</Heading>
      <p style={subtitleStyle}>{t("netAdmin.subtitle", locale)}</p>
      <p
        data-testid="net-admin-read-only"
        style={{ ...subtitleStyle, color: "var(--ink-faint)" }}
      >
        {t("netAdmin.read_only", locale)}
      </p>
      <GuaranteeNotice locale={locale} />
    </header>
  );
}

/**
 * Super Admin cross-tenant network console. Read-only; no mutation control.
 * @param props - {@link NetAdminConsoleProps}.
 * @returns The console element.
 */
export function NetAdminConsole({
  view,
  load,
  locale = "fr",
}: NetAdminConsoleProps): ReactElement {
  // ── State: loading (skeleton) ──────────────────────────────────────────────
  if (load === "loading") {
    return (
      <div data-testid="net-admin-skeleton" aria-busy="true" style={rootStyle}>
        <ConsoleHeader locale={locale} />
        <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
          {Array.from({ length: NET_SYNTHESIS_TILE_COUNT }).map((_, i) => (
            <Skeleton key={i} height="96px" radius="var(--r-lg)" style={{ flex: 1, minWidth: "10rem" }} />
          ))}
        </div>
      </div>
    );
  }

  // ── State: error ───────────────────────────────────────────────────────────
  if (load === "error" || view === null) {
    return (
      <div data-testid="net-admin-error" role="alert" style={rootStyle}>
        <ConsoleHeader locale={locale} />
        <EmptyState title={t("netAdmin.title", locale)} description={t("netAdmin.error", locale)} />
      </div>
    );
  }

  // ── State: empty (no bank) ─────────────────────────────────────────────────
  if (load === "empty" || view.banks.length === 0) {
    return (
      <div data-testid="net-admin-empty" style={rootStyle}>
        <ConsoleHeader locale={locale} />
        <EmptyState title={t("netAdmin.banks.title", locale)} description={t("netAdmin.empty", locale)} />
      </div>
    );
  }

  const s = view.synthesis;
  const offline = load === "offline";

  const tiles: { key: string; label: string; value: string }[] = [
    { key: "banks", label: t("netAdmin.synthesis.banks", locale), value: String(s.bankCount) },
    { key: "agencies", label: t("netAdmin.synthesis.agencies", locale), value: String(s.agencyCount) },
    { key: "online", label: t("netAdmin.synthesis.kiosks_online", locale), value: String(s.kiosksOnline) },
    { key: "offline", label: t("netAdmin.synthesis.kiosks_offline", locale), value: String(s.kiosksOffline) },
    { key: "muted", label: t("netAdmin.synthesis.muted_rate", locale), value: `${s.mutedRatePercent.toFixed(1)} %` },
    { key: "incidents", label: t("netAdmin.synthesis.open_incidents", locale), value: String(s.openIncidents) },
  ];

  // ── State: nominal (ready) + offline overlay (frozen data) ─────────────────
  return (
    <div
      data-testid="net-admin-console"
      data-state={offline ? "offline" : "ready"}
      style={rootStyle}
    >
      <ConsoleHeader locale={locale} />

      {offline && (
        <div style={{ marginBottom: "var(--space-4)" }}>
          <OfflineBanner data-testid="net-admin-offline-banner" message={t("netAdmin.offline", locale)} />
        </div>
      )}

      {/* Synthèse réseau */}
      <section aria-label={t("netAdmin.synthesis.title", locale)} style={{ marginBottom: "var(--space-8)" }}>
        <SectionTitle style={{ marginBottom: "var(--space-4)" }}>{t("netAdmin.synthesis.title", locale)}</SectionTitle>
        <div
          data-testid="net-admin-synthesis"
          style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}
        >
          {tiles.map((tile) => (
            <KpiTile
              key={tile.key}
              data-testid={`net-synth-${tile.key}`}
              label={tile.label}
              value={tile.value}
              style={{ flex: 1, minWidth: "10rem" }}
            />
          ))}
        </div>
      </section>

      {/* Vue par banque */}
      <section aria-label={t("netAdmin.banks.title", locale)}>
        <SectionTitle style={{ marginBottom: "var(--space-4)" }}>{t("netAdmin.banks.title", locale)}</SectionTitle>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table
            data-testid="net-admin-banks"
            style={{ width: "100%", borderCollapse: "collapse" }}
          >
            <thead>
              <tr>
                <th style={headCellStyle} scope="col">{t("netAdmin.col.bank", locale)}</th>
                <th style={{ ...headCellStyle, textAlign: "right" }} scope="col">{t("netAdmin.col.agencies", locale)}</th>
                <th style={{ ...headCellStyle, textAlign: "right" }} scope="col">{t("netAdmin.col.kiosks", locale)}</th>
                <th style={{ ...headCellStyle, textAlign: "right" }} scope="col">{t("netAdmin.col.tickets", locale)}</th>
                <th style={{ ...headCellStyle, textAlign: "right" }} scope="col">{t("netAdmin.col.uptime", locale)}</th>
                <th style={headCellStyle} scope="col">{t("netAdmin.col.health", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {view.banks.map((bank: NetworkBankRow) => (
                <tr key={bank.bankId} data-testid={`net-bank-row-${bank.bankId}`}>
                  <td style={cellStyle}>{bank.bankLabel}</td>
                  <td style={numCellStyle}>{bank.agencyCount}</td>
                  <td style={numCellStyle}>
                    {bank.kiosksOnline} / {bank.kiosksOffline}
                    <span style={{ color: "var(--ink-faint)", fontSize: "var(--text-xs)", display: "block" }}>
                      {t("netAdmin.kiosks_split", locale)}
                    </span>
                  </td>
                  <td style={numCellStyle}>{bank.totalTickets}</td>
                  <td style={numCellStyle}>{pct(bank.uptimePercent)}</td>
                  <td style={cellStyle}>
                    <Badge
                      data-testid={`net-bank-health-${bank.bankId}`}
                      tone={healthTone(bank.health)}
                      dot
                    >
                      {healthLabel(bank.health, locale)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Mention de garantie répétée en pied de la vue cross-tenant. */}
        <div style={{ marginTop: "var(--space-4)" }}>
          <GuaranteeNotice locale={locale} />
        </div>
      </section>
    </div>
  );
}
