/**
 * Button — SIGFA v2. Primary / secondary / ghost / danger, dense-web & kiosk
 * sizes. Text and icons come from props (i18n-agnostic). All 5 states are
 * covered by CSS: rest / hover / active-pressed / focus-visible / disabled.
 *
 * @module components/Button
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { clsx } from "clsx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "dense" | "md" | "kiosk";

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual intent. */
  variant?: ButtonVariant;
  /** Size profile — `kiosk` guarantees a ≥ 72px touch target. */
  size?: ButtonSize;
  /** Optional leading icon (paired with the label, per the design system). */
  iconStart?: ReactNode;
  /** Optional trailing icon. */
  iconEnd?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      iconStart,
      iconEnd,
      className,
      type = "button",
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={clsx(
          "sig-btn",
          `sig-btn--${variant}`,
          `sig-btn--${size}`,
          className,
        )}
        {...rest}
      >
        {iconStart != null && (
          <span className="sig-btn__icon" aria-hidden="true">
            {iconStart}
          </span>
        )}
        {children}
        {iconEnd != null && (
          <span className="sig-btn__icon" aria-hidden="true">
            {iconEnd}
          </span>
        )}
      </button>
    );
  },
);
