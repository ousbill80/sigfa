/**
 * NOTIF-005-B — step 3: Moment Ticket + live tracking.
 *
 * The hero is `TicketMoment` (`@sigfa/ui`) — the same premium moment as the
 * kiosk. Below it, live position + estimated wait update on their own via
 * `useLiveTracking` (polling max-age=30, offline keeps last known state). The
 * 5 states are honoured: loading / ready / offline / error, plus a called-now
 * highlight. Zero PII beyond the trackingId already in the URL flow.
 *
 * @module components/pwa/PwaTicketStep
 */
"use client";

import type { ReactElement } from "react";
import { Badge, Button, Card, TicketMoment } from "@sigfa/ui";
import { pt, type PwaKey, type PwaLocale } from "@/lib/pwa/pwa-i18n";
import { useLiveTracking } from "@/lib/pwa/use-live-tracking";
import { PwaStateView } from "@/components/pwa/PwaStateView";
import type { PublicTicketCreated } from "@/lib/pwa/pwa-client";

/** Props for {@link PwaTicketStep}. */
export interface PwaTicketStepProps {
  readonly baseUrl: string;
  readonly created: PublicTicketCreated;
  readonly locale: PwaLocale;
  readonly onNewTicket: () => void;
  /** Poll cadence override (tests). */
  readonly intervalMs?: number;
}

/** Maps a ticket status to its localized label key. */
function statusKey(status: string): PwaKey {
  const known: Record<string, PwaKey> = {
    WAITING: "pwa.ticket.status.WAITING",
    CALLED: "pwa.ticket.status.CALLED",
    SERVING: "pwa.ticket.status.SERVING",
    DONE: "pwa.ticket.status.DONE",
    NO_SHOW: "pwa.ticket.status.NO_SHOW",
    ABANDONED: "pwa.ticket.status.ABANDONED",
    TRANSFERRED: "pwa.ticket.status.TRANSFERRED",
  };
  return known[status] ?? "pwa.ticket.status.WAITING";
}

/**
 * Renders the Moment Ticket + live tracking step.
 *
 * @param props - Base URL, created ticket, locale, handlers.
 * @returns The step element.
 */
export function PwaTicketStep({
  baseUrl,
  created,
  locale,
  onNewTicket,
  intervalMs,
}: PwaTicketStepProps): ReactElement {
  const { ticket, phase, refresh } = useLiveTracking(baseUrl, created.trackingId, intervalMs);

  // Prefer the live payload; fall back to the creation payload so the hero
  // number is instant and never blank.
  const displayNumber = ticket?.displayNumber ?? created.displayNumber ?? created.number;
  const status = ticket?.status ?? created.status;
  const position = ticket?.position ?? created.position;
  const wait = ticket?.estimatedWaitMinutes ?? created.estimatedWaitMinutes;
  const isCalled = status === "CALLED" || status === "SERVING";
  const isDone = status === "DONE" || status === "NO_SHOW" || status === "ABANDONED";

  return (
    <section data-testid="pwa-ticket-step" aria-label={pt("pwa.ticket.eyebrow", locale)}>
      <TicketMoment
        data-testid="pwa-ticket-moment"
        eyebrow={pt("pwa.ticket.eyebrow", locale)}
        ticketNumber={displayNumber}
        message={
          isCalled
            ? pt("pwa.ticket.called_now", locale)
            : isDone
              ? pt("pwa.ticket.done", locale)
              : pt("pwa.ticket.message", locale)
        }
        actions={
          <Badge tone={isCalled ? "success" : isDone ? "info" : "brand"} data-testid="pwa-ticket-status" dot>
            {pt(statusKey(status), locale)}
          </Badge>
        }
      />

      {phase === "offline" && <PwaStateView state="offline" locale={locale} />}
      {phase === "error" && !ticket && <PwaStateView state="error" locale={locale} onRetry={refresh} />}
      {phase === "loading" && !ticket && <PwaStateView state="loading" locale={locale} />}

      {!isDone && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "var(--space-4)",
            marginTop: "var(--space-6)",
          }}
        >
          <Card style={{ padding: "var(--space-4)", textAlign: "center" }}>
            <span style={{ display: "block", color: "var(--ink-soft)", fontSize: "var(--text-sm)" }}>
              {pt("pwa.ticket.position", locale)}
            </span>
            <span
              data-testid="pwa-ticket-position"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-3xl)",
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                color: "var(--ink)",
              }}
            >
              {position}
            </span>
          </Card>
          <Card style={{ padding: "var(--space-4)", textAlign: "center" }}>
            <span style={{ display: "block", color: "var(--ink-soft)", fontSize: "var(--text-sm)" }}>
              {pt("pwa.ticket.wait", locale)}
            </span>
            <span
              data-testid="pwa-ticket-wait"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-3xl)",
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                color: "var(--ink)",
              }}
            >
              {pt("pwa.ticket.minutes", locale, { minutes: wait })}
            </span>
          </Card>
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
        <Button variant="secondary" onClick={refresh} data-testid="pwa-ticket-refresh">
          {pt("pwa.ticket.refresh", locale)}
        </Button>
        {isDone && (
          <Button variant="primary" onClick={onNewTicket} data-testid="pwa-ticket-new" style={{ flex: 1 }}>
            {pt("pwa.ticket.new", locale)}
          </Button>
        )}
      </div>
    </section>
  );
}
