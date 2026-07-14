/**
 * EmptyState — SIGFA v2. Never a bare "no data" — a calm illustration slot,
 * a title, a description and an optional action. All text from props.
 *
 * On dark surfaces (`--night` / `--night-2`), use `tone="inverse"`: the default
 * `--ink` title is invisible on night (1.02:1 — audit borne 2026-07-14, F1).
 * The inverse variant swaps to `--ink-inverse` / `--ink-inverse-soft`
 * (17.4:1 / 8.3:1 on `--night` — kiosk threshold ≥ 7:1).
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
  /**
   * Colour tone. `"inverse"` for dark backgrounds (kiosk / TV night surfaces):
   * title and description switch to the inverse ink ramp (≥ 7:1 on --night).
   * Defaults to `"default"` (light surfaces).
   */
  tone?: "default" | "inverse";
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  tone = "default",
  ...rest
}: EmptyStateProps): ReactNode {
  return (
    <div
      className={clsx(
        "sig-empty",
        tone === "inverse" && "sig-empty--inverse",
        className,
      )}
      {...rest}
    >
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
