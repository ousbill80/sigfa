/**
 * Spinner — SIGFA v2. A `--brand` ring that rotates for indeterminate waits.
 * Respects `prefers-reduced-motion` (handled in CSS — the ring stops spinning).
 * Announces itself as an ARIA `status`; the visible/hidden label comes from
 * props (i18n-agnostic).
 *
 * @module components/Spinner
 */
import { type HTMLAttributes, type ReactNode } from "react";
import { clsx } from "clsx";

export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Ring size. Defaults to `md`. */
  size?: SpinnerSize;
  /** Accessible label announced by screen readers (e.g. "Chargement…"). */
  label: string;
  /** When true the label is shown next to the ring, not just to AT. */
  showLabel?: boolean;
}

export function Spinner({
  size = "md",
  label,
  showLabel = false,
  className,
  ...rest
}: SpinnerProps): ReactNode {
  return (
    <span
      role="status"
      aria-live="polite"
      className={clsx("sig-spinner", `sig-spinner--${size}`, className)}
      {...rest}
    >
      <span className="sig-spinner__ring" aria-hidden="true" />
      <span
        className={clsx(!showLabel && "sig-spinner__label--sr")}
        data-testid="spinner-label"
      >
        {label}
      </span>
    </span>
  );
}
