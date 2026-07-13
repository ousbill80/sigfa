/**
 * KioskSupervision — kiosk supervision screen (ADM-003b).
 *
 * Two views over the same live state (SILENT-first ordering, calm density):
 *   - agency: a grid of kiosk tiles with a `@sigfa/ui` `Badge` status pill
 *     (ONLINE=success, DEGRADED=warning, SILENT=danger — a bordered pill, NEVER
 *     a solid red fill, DS v2 §1/§4 — NEVER_SEEN=info neutral), a human label as
 *     title and the UUID as faint meta, a relative "last seen" and an
 *     active-alert counter; silent tiles surface on top;
 *   - network: status counters (KpiTile — the tile IS the card, no double
 *     border) + agencies holding ≥1 silent kiosk, ordered by severity, with a
 *     positive EmptyState when none is silent.
 * Five states covered (loading skeleton / empty / error / stale-offline / ready).
 * Tokens only, zero emoji, icon+label always paired, @sigfa/ui primitives. The
 * clock is injected (`nowMs`) so the relative time is deterministic in tests.
 * @module components/admin/kiosk-supervision
 */
"use client";

import { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import {
  Badge,
  EmptyState,
  KpiTile,
  OfflineBanner,
  SectionTitle,
  SegmentedControl,
  Skeleton,
  type BadgeTone,
} from "@sigfa/ui";
import { t, type Locale } from "@/lib/i18n";
import {
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

/** Design-System Badge tone for a supervision status. */
const STATUS_TONE: Record<KioskStatus, BadgeTone> = {
  ONLINE: "success",
  DEGRADED: "warning",
  SILENT: "danger",
  NEVER_SEEN: "info",
};

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

/** Human label from an id: a friendly noun + short handle (UUID stays as meta). */
function shortHandle(id: string): string {
  return id.slice(0, 8);
}

const tileStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  padding: "var(--space-4)",
  background: "var(--surface-1)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--r-lg)",
  boxShadow: "var(--shadow-1)",
};

const shell: CSSProperties = {
  padding: "var(--space-0)",
};

/** A single kiosk tile in the agency grid. */
function KioskCard({
  kiosk,
  locale,
  nowMs,
}: {
  kiosk: SupervisedKiosk;
  locale: Locale;
  nowMs: number;
}): ReactElement {
  const isSilent = kiosk.status === "SILENT";
  const rel = relativeLastSeen(kiosk.lastSeen, nowMs, locale);
  const label = isSilent
    ? t("admSuper.silent_label", locale)
    : statusLabel(kiosk.status, locale);
  return (
    <div
      data-testid="kiosk-card"
      data-status={kiosk.status}
      style={{
        ...tileStyle,
        borderColor: isSilent ? "var(--danger)" : "var(--hairline)",
      }}
    >
      <Badge
        data-testid="kiosk-status-pill"
        tone={STATUS_TONE[kiosk.status]}
        dot
        role="img"
        aria-label={label}
      >
        {label}
      </Badge>
      {/* Human label as title, UUID demoted to faint meta. */}
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          color: "var(--ink)",
          fontSize: "var(--text-md)",
        }}
      >
        {t("admSuper.kiosk_label", locale)} · {shortHandle(kiosk.kioskId)}
      </span>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
        {t("admSuper.id_meta", locale)} : {kiosk.kioskId}
      </span>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--ink-soft)" }}>
        {rel
          ? `${t("admSuper.last_seen", locale)} · ${rel}`
          : t("admSuper.never_seen_hint", locale)}
      </span>
    </div>
  );
}

/** Counter tiles shared by both views — KpiTile IS the card (no Card wrapper). */
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
      <KpiTile label={t("admSuper.count.online", locale)} value={String(counts.online)} />
      <KpiTile label={t("admSuper.count.degraded", locale)} value={String(counts.degraded)} />
      <KpiTile label={t("admSuper.count.silent", locale)} value={String(counts.silent)} />
      <KpiTile label={t("admSuper.count.never_seen", locale)} value={String(counts.neverSeen)} />
    </section>
  );
}

/** Small triangle glyph for the error EmptyState (icon+text pairing). */
function WarnGlyph(): ReactElement {
  return (
    <svg width="28" height="28" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5 15 14H1L8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M8 6v3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.85" fill="currentColor" />
    </svg>
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
        <Skeleton style={{ height: "2.75rem", marginBottom: "var(--space-6)" }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--space-4)" }}>
          <Skeleton style={{ height: "7.5rem" }} />
          <Skeleton style={{ height: "7.5rem" }} />
          <Skeleton style={{ height: "7.5rem" }} />
        </div>
      </div>
    );
  }

  if (load === "error") {
    return (
      <div style={shell}>
        <div data-testid="supervision-error" role="alert">
          <EmptyState icon={<WarnGlyph />} title={t("admSuper.error", locale)} />
        </div>
      </div>
    );
  }

  if (load === "empty" || state.kiosks.length === 0) {
    return (
      <div style={shell}>
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
        <div style={{ marginBottom: "var(--space-6)" }}>
          <SegmentedControl
            ariaLabel={t("admSuper.title", locale)}
            value={view}
            onChange={(v) => setView(v === "network" ? "network" : "agency")}
            options={[
              { value: "agency", label: t("admSuper.view.agency", locale) },
              { value: "network", label: t("admSuper.view.network", locale) },
            ]}
          />
        </div>
      )}

      <CounterRow kiosks={state.kiosks} locale={locale} />

      {view === "agency" || !networkEnabled ? (
        <section aria-label={t("admSuper.view.agency", locale)}>
          <SectionTitle style={{ marginBottom: "var(--space-3)" }}>{t("admSuper.view.agency", locale)}</SectionTitle>
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
          <SectionTitle style={{ marginBottom: "var(--space-3)" }}>{t("admSuper.network.agencies", locale)}</SectionTitle>
          {rollup.length === 0 ? (
            <div data-testid="network-no-silent">
              <EmptyState
                icon={
                  <span style={{ color: "var(--forest)" }}>
                    <CheckGlyph />
                  </span>
                }
                title={t("admSuper.network.no_silent", locale)}
              />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {rollup.map((r) => (
                <div
                  key={r.agencyId}
                  data-testid="network-agency-row"
                  style={{ ...tileStyle, flexDirection: "row", alignItems: "center", gap: "var(--space-4)" }}
                >
                  <Badge tone="danger" dot>
                    {r.counts.silent} {t("admSuper.count.silent", locale)}
                  </Badge>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600, color: "var(--ink)", fontSize: "var(--text-md)" }}>
                      {t("admSuper.agency_label", locale)} · {shortHandle(r.agencyId)}
                    </span>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
                      {t("admSuper.id_meta", locale)} : {r.agencyId}
                    </span>
                  </div>
                  <span style={{ marginLeft: "auto", fontSize: "var(--text-xs)", color: "var(--ink-soft)" }}>
                    {r.counts.online} {t("admSuper.count.online", locale)} ·{" "}
                    {r.counts.degraded} {t("admSuper.count.degraded", locale)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** Positive check glyph for the "no silent kiosk" EmptyState (forest tone). */
function CheckGlyph(): ReactElement {
  return (
    <svg width="28" height="28" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M5 8.2 7 10.2 11 6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
