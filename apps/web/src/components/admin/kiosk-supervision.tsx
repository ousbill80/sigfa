/**
 * KioskSupervision — kiosk supervision screen (ADM-003b).
 *
 * Two views over the same live state (SILENT-first ordering, calm density):
 *   - agency: a grid of StatusPill cards (ONLINE=--success, DEGRADED=--warning,
 *     SILENT=--danger as a dotted/bordered pill — NEVER a solid red fill, DS v2
 *     §1/§4 — NEVER_SEEN neutral) with a relative "last seen" and an active-alert
 *     counter; silent cards surface on top;
 *   - network: status counters + agencies holding ≥1 silent kiosk, ordered by
 *     severity.
 * Five states covered (loading skeleton / empty / error / stale-offline / ready).
 * Tokens only, zero emoji, icon+label always paired, @sigfa/ui components. The
 * clock is injected (`nowMs`) so the relative time is deterministic in tests.
 * @module components/admin/kiosk-supervision
 */
"use client";

import { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { Badge, Button, Card, EmptyState, KpiTile, OfflineBanner, Skeleton } from "@sigfa/ui";
import { t, type Locale } from "@/lib/i18n";
import {
  statusToken,
  orderBySeverity,
  countStatuses,
  activeAlertCount,
  rollupByAgency,
  relativeLastSeen,
  type KioskStatus,
  type KioskSupervisionState,
  type SupervisedKiosk,
} from "@/lib/kiosk-supervision-state";
import type { SupervisionLoad } from "@/lib/use-kiosk-supervision";

/** Onboarding route (ADM-002) — empty-state CTA target. */
const ONBOARDING_HREF = "/admin/onboarding";

/** The two supervision views. */
export type SupervisionView = "agency" | "network";

/** Props for {@link KioskSupervision}. */
export interface KioskSupervisionProps {
  /** The supervision state. */
  state: KioskSupervisionState;
  /** Fetch lifecycle. */
  load: SupervisionLoad;
  /** Active locale. */
  locale?: Locale;
  /** Whether the network view is available (BANK_ADMIN+). */
  networkEnabled?: boolean;
  /** Injected clock (epoch ms) for deterministic relative time. */
  nowMs?: number;
}

/** i18n label for a status. */
function statusLabel(status: KioskStatus, locale: Locale): string {
  switch (status) {
    case "ONLINE":
      return t("admSuper.status.online", locale);
    case "DEGRADED":
      return t("admSuper.status.degraded", locale);
    case "SILENT":
      return t("admSuper.status.silent", locale);
    case "NEVER_SEEN":
    default:
      return t("admSuper.status.never_seen", locale);
  }
}

/** Soft-tinted background derived from a functional token (never a solid fill). */
const softOf: Record<string, string> = {
  "var(--success)": "var(--success-soft)",
  "var(--warning)": "var(--warning-soft)",
  "var(--danger)": "var(--danger-soft)",
  "var(--ink-faint)": "var(--surface-2)",
};

/**
 * StatusPill style — the functional token drives the dot + border + ink only.
 * `--danger` (SILENT) stays a bordered/dotted pill; the background is a soft tint,
 * NEVER a solid red fill (DS v2 §1/§4).
 */
const pillStyle = (token: string): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "var(--space-1) var(--space-3)",
  borderRadius: "var(--r-full)",
  backgroundColor: softOf[token] ?? "var(--surface-2)",
  border: `1px solid ${token}`,
  color: "var(--ink)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
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

const shell: CSSProperties = {
  padding: "var(--space-6)",
  maxWidth: "1200px",
  margin: "0 auto",
  backgroundColor: "var(--paper)",
};

/** A single kiosk card in the agency grid. */
function KioskCard({
  kiosk,
  locale,
  nowMs,
}: {
  kiosk: SupervisedKiosk;
  locale: Locale;
  nowMs: number;
}): ReactElement {
  const token = statusToken(kiosk.status);
  const isSilent = kiosk.status === "SILENT";
  const rel = relativeLastSeen(kiosk.lastSeen, nowMs, locale);
  const label = isSilent
    ? t("admSuper.silent_label", locale)
    : statusLabel(kiosk.status, locale);
  return (
    <Card
      data-testid="kiosk-card"
      data-status={kiosk.status}
      style={{
        padding: "var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        borderColor: isSilent ? "var(--danger)" : "var(--hairline)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
        <span
          data-testid="kiosk-status-pill"
          role="img"
          aria-label={label}
          style={pillStyle(token)}
        >
          <span
            aria-hidden="true"
            style={{ width: "8px", height: "8px", borderRadius: "var(--r-full)", backgroundColor: token }}
          />
          {label}
        </span>
      </div>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          color: "var(--ink)",
          fontVariantNumeric: "tabular-nums",
          fontSize: "var(--text-sm)",
        }}
      >
        {kiosk.kioskId.slice(0, 8)}
      </span>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--ink-soft)" }}>
        {rel
          ? `${t("admSuper.last_seen", locale)} · ${rel}`
          : t("admSuper.never_seen_hint", locale)}
      </span>
    </Card>
  );
}

/** Counter tiles shared by both views. */
function CounterRow({
  kiosks,
  locale,
}: {
  kiosks: SupervisedKiosk[];
  locale: Locale;
}): ReactElement {
  const counts = countStatuses(kiosks);
  return (
    <section
      data-testid="supervision-counters"
      aria-label={t("admSuper.count.kiosks", locale)}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: "var(--space-4)",
        marginBottom: "var(--space-8)",
      }}
    >
      <Card style={{ padding: "var(--space-4)" }}>
        <KpiTile label={t("admSuper.count.online", locale)} value={String(counts.online)} />
      </Card>
      <Card style={{ padding: "var(--space-4)" }}>
        <KpiTile label={t("admSuper.count.degraded", locale)} value={String(counts.degraded)} />
      </Card>
      <Card style={{ padding: "var(--space-4)" }}>
        <KpiTile label={t("admSuper.count.silent", locale)} value={String(counts.silent)} />
      </Card>
      <Card style={{ padding: "var(--space-4)" }}>
        <KpiTile label={t("admSuper.count.never_seen", locale)} value={String(counts.neverSeen)} />
      </Card>
    </section>
  );
}

/**
 * Kiosk supervision screen.
 * @param props - {@link KioskSupervisionProps}.
 * @returns The supervision element.
 */
export function KioskSupervision({
  state,
  load,
  locale = "fr",
  networkEnabled = false,
  nowMs = Date.now(),
}: KioskSupervisionProps): ReactElement {
  const [view, setView] = useState<SupervisionView>("agency");

  const ordered = useMemo(() => orderBySeverity(state.kiosks), [state.kiosks]);
  const alerts = useMemo(() => activeAlertCount(state.kiosks), [state.kiosks]);
  const rollup = useMemo(
    () => rollupByAgency(state.kiosks).filter((r) => r.counts.silent > 0),
    [state.kiosks],
  );

  if (load === "loading") {
    return (
      <div data-testid="supervision-skeleton" aria-busy="true" style={shell}>
        <Skeleton style={{ height: "44px", marginBottom: "var(--space-6)" }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--space-4)" }}>
          <Skeleton style={{ height: "120px" }} />
          <Skeleton style={{ height: "120px" }} />
          <Skeleton style={{ height: "120px" }} />
        </div>
      </div>
    );
  }

  if (load === "error") {
    return (
      <div style={shell}>
        <Card data-testid="supervision-error" role="alert" style={{ padding: "var(--space-8)", textAlign: "center", color: "var(--ink)" }}>
          <p style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "var(--text-lg)", fontWeight: 600 }}>
            {t("admSuper.error", locale)}
          </p>
        </Card>
      </div>
    );
  }

  if (load === "empty" || state.kiosks.length === 0) {
    return (
      <div style={shell}>
        <Card style={{ padding: "var(--space-8)" }}>
          <EmptyState
            data-testid="supervision-empty"
            title={t("admSuper.empty", locale)}
            action={
              <a
                data-testid="supervision-empty-cta"
                href={ONBOARDING_HREF}
                className="sig-btn sig-btn--primary sig-btn--md"
                style={{ textDecoration: "none" }}
              >
                {t("admSuper.empty_cta", locale)}
              </a>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div data-testid="kiosk-supervision" style={shell}>
      <header style={{ marginBottom: "var(--space-6)", display: "flex", flexWrap: "wrap", gap: "var(--space-4)", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
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
            {t("admSuper.title", locale)}
          </h1>
          <p style={{ margin: "var(--space-1) 0 0", color: "var(--ink-soft)", fontSize: "var(--text-sm)" }}>
            {t("admSuper.subtitle", locale)}
          </p>
        </div>
        {/* Active-alert counter — icon (dot) + text always paired. */}
        <div data-testid="alert-counter">
          <Badge tone={alerts > 0 ? "danger" : "success"} dot>
            {alerts} {t("admSuper.alerts_active", locale)}
          </Badge>
        </div>
      </header>

      {load === "stale" && (
        <div data-testid="supervision-stale" style={{ marginBottom: "var(--space-6)" }}>
          <OfflineBanner message={t("admSuper.stale", locale)} />
        </div>
      )}
      {load !== "stale" && state.connection === "offline" && (
        <div data-testid="supervision-offline" style={{ marginBottom: "var(--space-6)" }}>
          <OfflineBanner message={t("admSuper.offline", locale)} />
        </div>
      )}

      {networkEnabled && (
        <nav
          role="tablist"
          aria-label={t("admSuper.title", locale)}
          style={{ display: "flex", gap: "var(--space-3)", marginBottom: "var(--space-6)" }}
        >
          <Button
            role="tab"
            aria-selected={view === "agency"}
            data-testid="view-agency"
            variant={view === "agency" ? "primary" : "secondary"}
            size="dense"
            onClick={() => setView("agency")}
          >
            {t("admSuper.view.agency", locale)}
          </Button>
          <Button
            role="tab"
            aria-selected={view === "network"}
            data-testid="view-network"
            variant={view === "network" ? "primary" : "secondary"}
            size="dense"
            onClick={() => setView("network")}
          >
            {t("admSuper.view.network", locale)}
          </Button>
        </nav>
      )}

      <CounterRow kiosks={state.kiosks} locale={locale} />

      {view === "agency" || !networkEnabled ? (
        <section aria-label={t("admSuper.view.agency", locale)}>
          <div style={sectionLabel}>{t("admSuper.view.agency", locale)}</div>
          <div
            data-testid="kiosk-grid"
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--space-4)" }}
          >
            {ordered.map((k) => (
              <KioskCard key={k.kioskId} kiosk={k} locale={locale} nowMs={nowMs} />
            ))}
          </div>
        </section>
      ) : (
        <section data-testid="network-view" aria-label={t("admSuper.view.network", locale)}>
          <div style={sectionLabel}>{t("admSuper.network.agencies", locale)}</div>
          {rollup.length === 0 ? (
            <Card data-testid="network-no-silent" style={{ padding: "var(--space-6)", color: "var(--ink-soft)" }}>
              {t("admSuper.network.no_silent", locale)}
            </Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {rollup.map((r) => (
                <Card
                  key={r.agencyId}
                  data-testid="network-agency-row"
                  style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", padding: "var(--space-4)" }}
                >
                  <Badge tone="danger" dot>
                    {r.counts.silent} {t("admSuper.count.silent", locale)}
                  </Badge>
                  <span style={{ fontWeight: 600, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
                    {r.agencyId.slice(0, 8)}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: "var(--text-xs)", color: "var(--ink-soft)" }}>
                    {r.counts.online} {t("admSuper.count.online", locale)} ·{" "}
                    {r.counts.degraded} {t("admSuper.count.degraded", locale)}
                  </span>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
