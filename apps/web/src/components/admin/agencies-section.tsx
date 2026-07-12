/**
 * AgenciesSection — agency list + guarded deactivation dialog (WEB-006).
 *
 * Deactivating an agency that still has open tickets opens a confirmation dialog
 * (role="dialog") listing the concerned tickets; the user can cancel (no call)
 * or confirm the forced closure (→ onConfirmDeactivate, which the caller maps to
 * PATCH /agencies/{id} active:false or DELETE /agencies/{id}). Empty state when
 * no agency is configured. Tokens only.
 * @module components/admin/agencies-section
 */
"use client";

import { useState, type CSSProperties, type ReactElement } from "react";
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

const dialogStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "rgba(0,0,0,0.4)",
};
const panelStyle: CSSProperties = {
  backgroundColor: "var(--surface-0)",
  color: "var(--ink-strong)",
  padding: "1.5rem",
  borderRadius: "0.5rem",
  maxWidth: "28rem",
  width: "90%",
};
const btnStyle: CSSProperties = {
  minHeight: "40px",
  padding: "0 1rem",
  borderRadius: "0.375rem",
  cursor: "pointer",
  fontSize: "1rem",
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
      {agencies.length === 0 ? (
        <div data-testid="agencies-empty" style={{ color: "var(--ink-soft)", padding: "1rem" }}>
          {t("admin.empty_agencies", locale)}
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {agencies.map((agency) => (
            <li key={agency.id} data-testid={`agency-row-${agency.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid var(--surface-1)" }}>
              <span style={{ color: "var(--ink-strong)" }}>{agency.name}</span>
              <button
                type="button"
                data-testid={`deactivate-${agency.id}`}
                onClick={() => requestDeactivate(agency)}
                style={{ ...btnStyle, border: "1px solid var(--danger)", backgroundColor: "var(--surface-0)", color: "var(--danger)" }}
              >
                {t("admin.deactivate", locale)}
              </button>
            </li>
          ))}
        </ul>
      )}

      {pending && (
        <div style={dialogStyle}>
          <div role="dialog" aria-modal="true" aria-labelledby="deactivate-title" data-testid="deactivate-dialog" style={panelStyle}>
            <h2 id="deactivate-title" style={{ fontSize: "1.125rem", margin: "0 0 0.75rem" }}>
              {t("admin.deactivate_tickets_title", locale)} — {pending.name}
            </h2>
            <ul data-testid="deactivate-tickets" style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
              {pendingTickets.map((ticket) => (
                <li key={ticket} style={{ color: "var(--ink-strong)" }}>{ticket}</li>
              ))}
            </ul>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button type="button" data-testid="dialog-cancel" onClick={() => setPending(null)} style={{ ...btnStyle, border: "1px solid var(--ink-soft)", backgroundColor: "var(--surface-1)", color: "var(--ink-strong)" }}>
                {t("admin.cancel", locale)}
              </button>
              <button
                type="button"
                data-testid="dialog-confirm"
                onClick={() => {
                  onConfirmDeactivate(pending.id);
                  setPending(null);
                }}
                style={{ ...btnStyle, border: "none", backgroundColor: "var(--danger)", color: "var(--brand-contrast)" }}
              >
                {t("admin.confirm", locale)}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
