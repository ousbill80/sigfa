/**
 * Badge / StatusPill — SIGFA v2. success / warning / info / brand-soft carry a
 * soft tinted background; `danger` is a bordered pill with a dot — NEVER a
 * solid red fill (design-system rule). Label comes from props.
 *
 * @module components/Badge
 */
import { type HTMLAttributes, type ReactNode } from "react";
import { clsx } from "clsx";

export type BadgeTone = "success" | "warning" | "danger" | "info" | "brand";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Semantic tone. */
  tone?: BadgeTone;
  /** Show a leading status dot. */
  dot?: boolean;
  children?: ReactNode;
}

export function Badge({
  tone = "brand",
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps): ReactNode {
  return (
    <span className={clsx("sig-badge", `sig-badge--${tone}`, className)} {...rest}>
      {dot && <span className="sig-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
