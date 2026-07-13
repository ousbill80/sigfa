/**
 * AuditLogTable — read-only audit trail table (SEC-001b).
 *
 * STRICTLY read-only (leçon SEC-F3-01): the DOM contains NO mutation element —
 * no create/edit/delete control, no form that POST/PATCH/DELETEs. The only
 * interactions are filters and pagination, which trigger a GET re-fetch through
 * the typed client (never a mutation). Design system v2 « Sérénité Premium »:
 * `@sigfa/ui` primitives only (Field / Button / SectionTitle / Overline / Badge
 * / Spinner / Skeleton / EmptyState / OfflineBanner), tokens only (never a hard
 * value), the 5 states (loading / ready / empty / error / offline), FR/EN.
 *
 * `--danger` is NEVER a solid fill: a destructive action verb (DELETE / revoke /
 * purge) is carried by a bordered `Badge` with a dot — never a red pavé.
 * @module components/audit/audit-log-table
 */
"use client";

import { type CSSProperties, type ReactElement } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  OfflineBanner,
  SectionTitle,
  Skeleton,
  Spinner,
  type BadgeTone,
} from "@sigfa/ui";
import { t, type Locale } from "@/lib/i18n";
import type {
  AuditEntryView,
  AuditFilters,
  AuditLoad,
} from "@/lib/use-audit-log";

/** Props for {@link AuditLogTable}. */
export interface AuditLogTableProps {
  /** Loaded entries for the current page. */
  entries: AuditEntryView[];
  /** Fetch lifecycle. */
  load: AuditLoad;
  /** Active filters (controlled). */
  filters: AuditFilters;
  /** Current page (1-based). */
  page: number;
  /** Total entries reported by the server. */
  total: number;
  /** Page size. */
  limit: number;
  /** Whether the app is offline (log may be stale). */
  offline?: boolean;
  /** Active locale. */
  locale?: Locale;
  /** Filter change handler (single field). */
  onFilterChange: (field: keyof AuditFilters, value: string) => void;
  /** Apply filters (triggers a GET re-fetch, page 1). */
  onApply: () => void;
  /** Reset filters (triggers a GET re-fetch, page 1). */
  onReset: () => void;
  /** Page change handler (triggers a GET re-fetch). */
  onPage: (page: number) => void;
}

/** Cell padding is roomy so dense audit rows stay legible. */
const cellStyle: CSSProperties = {
  padding: "var(--space-4) var(--space-3)",
  fontSize: "var(--text-sm)",
  color: "var(--ink)",
  verticalAlign: "top",
};

const headStyle: CSSProperties = {
  padding: "var(--space-3)",
  textAlign: "left",
  color: "var(--ink-soft)",
  fontSize: "var(--text-xs)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-tight)",
  fontWeight: 600,
};

/** Faint monospace meta line (UUIDs, secondary identifiers). */
const metaStyle: CSSProperties = {
  display: "block",
  color: "var(--ink-faint)",
  fontSize: "var(--text-xs)",
  fontFamily: "var(--font-mono, monospace)",
};

/** Destructive verbs get a bordered `danger` badge (dot, never a red fill). */
const DESTRUCTIVE_ACTION = /delete|revoke|purge|remove|révoqu|supprim|purg/i;

/** Maps an audit action to a bordered Badge tone (danger = dot, never fill). */
function actionTone(action: string): BadgeTone {
  return DESTRUCTIVE_ACTION.test(action) ? "danger" : "info";
}

/** Renders the page header (overline kicker + section title + subtitle). */
function headerBlock(locale: Locale): ReactElement {
  return (
    <header style={{ marginBottom: "var(--space-5)" }}>
      <SectionTitle size="xl">{t("audit.title", locale)}</SectionTitle>
      <p style={{ margin: "var(--space-1) 0 0", color: "var(--ink-soft)", fontSize: "var(--text-sm)" }}>
        {t("audit.subtitle", locale)}
      </p>
    </header>
  );
}

/** Renders the read-only filter form (submit triggers a GET re-fetch). */
function filterForm(
  props: Pick<AuditLogTableProps, "filters" | "locale" | "onFilterChange" | "onApply" | "onReset">,
): ReactElement {
  const locale = props.locale ?? "fr";
  const field = (key: keyof AuditFilters, labelKey: Parameters<typeof t>[0]): ReactElement => (
    <Field
      key={key}
      data-testid={`audit-filter-${key}`}
      label={t(labelKey, locale)}
      type={key === "from" || key === "to" ? "datetime-local" : "text"}
      value={props.filters[key] ?? ""}
      onChange={(e) => props.onFilterChange(key, e.target.value)}
      style={{ minWidth: "12rem", flex: 1 }}
    />
  );
  return (
    <form
      data-testid="audit-filters"
      onSubmit={(e) => {
        e.preventDefault();
        props.onApply();
      }}
      style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)", alignItems: "flex-end", marginBottom: "var(--space-5)" }}
    >
      {field("entityType", "audit.filter.entityType")}
      {field("entityId", "audit.filter.entityId")}
      {field("actorId", "audit.filter.actorId")}
      {field("from", "audit.filter.from")}
      {field("to", "audit.filter.to")}
      {/* Read-only navigation: submit issues a GET re-fetch, never a mutation. */}
      <Button type="submit" variant="primary" data-testid="audit-apply">
        {t("audit.filter.apply", locale)}
      </Button>
      <Button type="button" variant="ghost" data-testid="audit-reset" onClick={props.onReset}>
        {t("audit.filter.reset", locale)}
      </Button>
    </form>
  );
}

/** Renders a compact diff (before/after) as read-only text. */
function diffCell(entry: AuditEntryView, locale: Locale): ReactElement {
  if (!entry.diff) return <span style={{ color: "var(--ink-faint)" }}>{t("audit.diff.none", locale)}</span>;
  const before = (entry.diff as { before?: unknown }).before;
  const after = (entry.diff as { after?: unknown }).after;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "var(--text-xs)" }}>
      {before !== undefined && (
        <span style={{ color: "var(--ink-soft)" }}>
          {t("audit.diff.before", locale)}: <code>{JSON.stringify(before)}</code>
        </span>
      )}
      {after !== undefined && (
        <span style={{ color: "var(--ink)" }}>
          {t("audit.diff.after", locale)}: <code>{JSON.stringify(after)}</code>
        </span>
      )}
      {before === undefined && after === undefined && (
        <code>{JSON.stringify(entry.diff)}</code>
      )}
    </div>
  );
}

/** Renders read-only pagination controls (GET re-fetch). */
function pagination(
  page: number,
  total: number,
  limit: number,
  locale: Locale,
  onPage: (page: number) => void,
): ReactElement {
  const lastPage = Math.max(1, Math.ceil(total / limit));
  return (
    <nav
      data-testid="audit-pagination"
      aria-label={t("audit.pagination.page", locale)}
      style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "var(--space-5)", color: "var(--ink-soft)", fontSize: "var(--text-sm)" }}
    >
      <Button
        type="button"
        variant="secondary"
        data-testid="audit-prev"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {t("audit.pagination.prev", locale)}
      </Button>
      <span data-testid="audit-page-indicator" style={{ fontVariantNumeric: "tabular-nums" }}>
        {t("audit.pagination.page", locale)} {page} / {lastPage}
      </span>
      <Button
        type="button"
        variant="secondary"
        data-testid="audit-next"
        disabled={page >= lastPage}
        onClick={() => onPage(page + 1)}
      >
        {t("audit.pagination.next", locale)}
      </Button>
    </nav>
  );
}

/**
 * Read-only audit trail table (SEC-001b).
 * @param props - {@link AuditLogTableProps}.
 * @returns The table element.
 */
export function AuditLogTable(props: AuditLogTableProps): ReactElement {
  const locale = props.locale ?? "fr";
  const filters = filterForm(props);

  if (props.load === "loading") {
    return (
      <Card data-testid="audit-loading" aria-busy="true" style={{ padding: "var(--space-6)" }}>
        {headerBlock(locale)}
        {filters}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-4)", color: "var(--ink-soft)", fontSize: "var(--text-sm)" }}>
          <Spinner size="sm" showLabel label={t("audit.loading", locale)} />
        </div>
        <Skeleton style={{ height: "220px" }} />
      </Card>
    );
  }

  if (props.load === "error") {
    return (
      <Card data-testid="audit-error" role="alert" style={{ padding: "var(--space-6)" }}>
        {headerBlock(locale)}
        {filters}
        <EmptyState title={t("audit.error", locale)} />
      </Card>
    );
  }

  if (props.load === "empty" || props.entries.length === 0) {
    return (
      <Card data-testid="audit-empty" style={{ padding: "var(--space-6)" }}>
        {headerBlock(locale)}
        {filters}
        <EmptyState title={t("audit.empty", locale)} />
      </Card>
    );
  }

  return (
    <Card data-testid="audit-table" style={{ padding: "var(--space-6)" }}>
      {headerBlock(locale)}
      {filters}

      {props.offline && (
        <div data-testid="audit-offline" style={{ marginBottom: "var(--space-4)" }}>
          <OfflineBanner message={t("audit.offline", locale)} />
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--hairline)" }}>
            <th style={headStyle}>{t("audit.col.timestamp", locale)}</th>
            <th style={headStyle}>{t("audit.col.actor", locale)}</th>
            <th style={headStyle}>{t("audit.col.action", locale)}</th>
            <th style={headStyle}>{t("audit.col.entity", locale)}</th>
            <th style={headStyle}>{t("audit.col.ip", locale)}</th>
            <th style={headStyle}>{t("audit.col.diff", locale)}</th>
          </tr>
        </thead>
        <tbody>
          {props.entries.map((entry, i) => (
            <tr
              key={`${entry.timestamp}-${entry.entityId}-${i}`}
              data-testid="audit-row"
              style={{ borderBottom: "1px solid var(--hairline)" }}
            >
              <td style={cellStyle}>
                <time dateTime={entry.timestamp} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatTimestamp(entry.timestamp)}
                </time>
              </td>
              <td style={cellStyle}>
                <span style={{ fontWeight: 600 }}>{entry.actor.email ?? entry.actor.id}</span>
                {entry.actor.role && <span style={metaStyle}>{entry.actor.role}</span>}
              </td>
              <td style={cellStyle}>
                <Badge tone={actionTone(entry.action)} dot data-testid="audit-action-badge">
                  {entry.action}
                </Badge>
              </td>
              <td style={cellStyle}>
                <span>{entry.entityType}</span>
                {entry.entityId && <span style={metaStyle}>{entry.entityId}</span>}
              </td>
              <td style={{ ...cellStyle, fontVariantNumeric: "tabular-nums" }}>{entry.ip}</td>
              <td style={cellStyle}>{diffCell(entry, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {pagination(props.page, props.total, props.limit, locale, props.onPage)}
    </Card>
  );
}

/** Formats an ISO timestamp for display (locale-neutral, agency timezone kept). */
function formatTimestamp(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}
