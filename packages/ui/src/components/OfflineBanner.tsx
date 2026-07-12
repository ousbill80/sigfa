/**
 * OfflineBanner — SIGFA v2. Soft `--info` banner (never alarming). Message from
 * props. Announced politely to assistive tech via `role="status"`.
 *
 * @module components/OfflineBanner
 */
import { type HTMLAttributes, type ReactNode } from "react";
import { clsx } from "clsx";

export interface OfflineBannerProps extends HTMLAttributes<HTMLDivElement> {
  /** The offline message (e.g. "Mode hors-ligne — reconnexion en cours"). */
  message: string;
  children?: ReactNode;
}

export function OfflineBanner({
  message,
  className,
  children,
  ...rest
}: OfflineBannerProps): ReactNode {
  return (
    <div
      className={clsx("sig-offline", className)}
      role="status"
      aria-live="polite"
      {...rest}
    >
      <span className="sig-offline__dot" aria-hidden="true" />
      <span>{message}</span>
      {children}
    </div>
  );
}
