/**
 * Skeleton — SIGFA v2 loading placeholder. Warm shimmer, honours
 * prefers-reduced-motion (handled in CSS). `aria-hidden` so screen readers
 * skip the placeholder; pair with a live region for the loading announcement.
 *
 * @module components/Skeleton
 */
import { type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { clsx } from "clsx";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** CSS width (e.g. "100%", "12rem"). */
  width?: string;
  /** CSS height (e.g. "1rem"). */
  height?: string;
  /** Border radius override (defaults to `--r-md`). */
  radius?: string;
}

export function Skeleton({
  width = "100%",
  height = "1rem",
  radius,
  className,
  style,
  ...rest
}: SkeletonProps): ReactNode {
  const merged: CSSProperties = {
    width,
    height,
    ...(radius != null ? { borderRadius: radius } : null),
    ...style,
  };
  return (
    <div
      className={clsx("sig-skeleton", className)}
      style={merged}
      aria-hidden="true"
      data-testid="skeleton"
      {...rest}
    />
  );
}
