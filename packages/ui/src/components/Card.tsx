/**
 * Card / Surface — SIGFA v2. Elevated `--surface-1` panel. When `interactive`,
 * it gains hover elevation + a −2px lift and becomes keyboard-focusable.
 *
 * @module components/Card
 */
import {
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { clsx } from "clsx";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** When true, the card lifts on hover and is keyboard-activatable. */
  interactive?: boolean;
  /** Activation handler for interactive cards (click + Enter/Space). */
  onActivate?: () => void;
  children?: ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive = false, onActivate, className, children, onClick, ...rest },
  ref,
) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!interactive || !onActivate) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate();
    }
  }

  return (
    <div
      ref={ref}
      className={clsx(
        "sig-card",
        interactive && "sig-card--interactive",
        className,
      )}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (interactive) onActivate?.();
      }}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {children}
    </div>
  );
});
