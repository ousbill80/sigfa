/**
 * TicketMoment — THE hero of SIGFA. The ticket number rendered in `--display`
 * (`--brand-inv`) on `--night`, wrapped in a discreet `--brand` halo,
 * entering with a soft spring. A
 * calming message + actions (SMS / voice) turn waiting into tranquillity.
 * Every string comes from props (i18n-agnostic).
 *
 * @module components/TicketMoment
 */
import { type HTMLAttributes, type ReactNode } from "react";
import { clsx } from "clsx";

export interface TicketMomentProps extends HTMLAttributes<HTMLDivElement> {
  /** Small uppercase eyebrow (e.g. "Votre ticket"). */
  eyebrow: string;
  /** The ticket number / code (e.g. "B-042"). */
  ticketNumber: string;
  /** Reassuring message under the number. */
  message: string;
  /** Actions row (e.g. SMS / voice buttons) — provided by the caller. */
  actions?: ReactNode;
}

export function TicketMoment({
  eyebrow,
  ticketNumber,
  message,
  actions,
  className,
  ...rest
}: TicketMomentProps): ReactNode {
  return (
    <section
      className={clsx("sig-ticket", className)}
      aria-label={`${eyebrow} ${ticketNumber}`}
      {...rest}
    >
      <span className="sig-ticket__halo" aria-hidden="true" />
      <p className="sig-ticket__eyebrow">{eyebrow}</p>
      <p className="sig-ticket__number" data-testid="ticket-number">
        {ticketNumber}
      </p>
      <p className="sig-ticket__message">{message}</p>
      {actions != null && <div className="sig-ticket__actions">{actions}</div>}
    </section>
  );
}
