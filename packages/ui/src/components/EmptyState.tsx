/**
 * EmptyState — SIGFA v2. Never a bare "no data" — a calm illustration slot,
 * a title, a description and an optional action. All text from props.
 *
 * @module components/EmptyState
 */
import { type HTMLAttributes, type ReactNode } from "react";
import { clsx } from "clsx";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional icon / illustration. */
  icon?: ReactNode;
  /** Headline. */
  title: string;
  /** Supporting description. */
  description?: string;
  /** Optional call to action (e.g. a Button). */
  action?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...rest
}: EmptyStateProps): ReactNode {
  return (
    <div className={clsx("sig-empty", className)} {...rest}>
      {icon != null && (
        <div className="sig-empty__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="sig-empty__title">{title}</p>
      {description != null && (
        <p className="sig-empty__desc">{description}</p>
      )}
      {action != null && <div className="sig-empty__actions">{action}</div>}
    </div>
  );
}
