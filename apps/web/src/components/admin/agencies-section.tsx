/**
 * AgenciesSection — agency list + guarded deactivation dialog (WEB-006).
 *
 * Deactivating an agency that still has open tickets opens a confirmation dialog
 * (role="dialog") listing the concerned tickets; the user can cancel (no call)
 * or confirm the forced closure (→ onConfirmDeactivate, which the caller maps to
 * PATCH /agencies/{id} active:false or DELETE /agencies/{id}). Empty state when
 * no agency is configured. v2 « Sérénité Premium » — @sigfa/ui + tokens only.
 * @module components/admin/agencies-section
 */
"use client";

import { useState, type CSSProperties, type ReactElement } from "react";
import { Badge, Button, Dialog, EmptyState } from "@sigfa/ui";
import { t, type Locale } from "@/lib/i18n";

/** A minimal agency row for the list. */
export interface AgencyRow {
  id: string;
  name: string;
  active: boolean;
}

/** Props for {@link AgenciesSection}. */
export interface AgenciesSectionProps {
  /** The agencies to list. */
  agencies: AgencyRow[];
  /** Open ticket display numbers per agency id. */
  openTickets: Record<string, string[]>;
  /** Confirmed forced deactivation callback. */
  onConfirmDeactivate: (agencyId: string) => void;
  /** Active locale. */
  locale?: Locale;
}

const overlineStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-faint)",
  margin: "0 0 var(--space-4)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "var(--space-4)",
  padding: "var(--space-3) 0",
  borderBottom: "1px solid var(--hairline)",
};

/**
 * Agencies management section with a guarded deactivation dialog.
 * @param props - {@link AgenciesSectionProps}.
 * @returns The section element.
 */
export function AgenciesSection({ agencies, openTickets, onConfirmDeactivate, locale = "fr" }: AgenciesSectionProps): ReactElement {
  const [pending, setPending] = useState<AgencyRow | null>(null);
  const pendingTickets = pending ? (openTickets[pending.id] ?? []) : [];

  function requestDeactivate(agency: AgencyRow): void {
    const tickets = openTickets[agency.id] ?? [];
    if (tickets.length > 0) {
      setPending(agency); // needs confirmation dialog
    } else {
      onConfirmDeactivate(agency.id); // no open tickets → direct
    }
  }

  return (
    <section data-testid="agencies-section" aria-label={t("admin.section.agencies", locale)}>
      <p style={overlineStyle}>{t("admin.section.agencies", locale)}</p>

      {agencies.length === 0 ? (
        <div data-testid="agencies-empty">
          <EmptyState title={t("admin.empty_agencies", locale)} />
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {agencies.map((agency) => (
            <li key={agency.id} data-testid={`agency-row-${agency.id}`} style={rowStyle}>
              <span style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", color: "var(--ink)", fontWeight: 500 }}>
                {agency.name}
                <Badge tone={agency.active ? "success" : "info"} dot>
                  {agency.active ? t("admin.confirm", locale) : t("admin.deactivate", locale)}
                </Badge>
              </span>
              <Button
                type="button"
                variant="danger"
                size="dense"
                data-testid={`deactivate-${agency.id}`}
                onClick={() => requestDeactivate(agency)}
              >
                {t("admin.deactivate", locale)}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending ? `${t("admin.deactivate_tickets_title", locale)} — ${pending.name}` : ""}
        actions={
          <>
            <Button type="button" variant="secondary" data-testid="dialog-cancel" onClick={() => setPending(null)}>
              {t("admin.cancel", locale)}
            </Button>
            <Button
              type="button"
              variant="danger"
              data-testid="dialog-confirm"
              onClick={() => {
                if (pending) onConfirmDeactivate(pending.id);
                setPending(null);
              }}
            >
              {t("admin.confirm", locale)}
            </Button>
          </>
        }
      >
        <ul data-testid="deactivate-tickets" style={{ margin: 0, paddingLeft: "var(--space-6)", color: "var(--ink)" }}>
          {pendingTickets.map((ticket) => (
            <li key={ticket}>{ticket}</li>
          ))}
        </ul>
      </Dialog>
    </section>
  );
}
