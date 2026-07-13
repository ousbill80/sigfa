/**
 * Textarea — SIGFA v2. The multiline sibling of {@link Field}: identical label,
 * hint, inline error, `--surface-2` rest surface and `--brand` 3px focus ring.
 * Accessible: label bound via `htmlFor`, `aria-invalid` + `aria-describedby`
 * wire the error/hint to the control. All text comes from props (i18n-agnostic).
 *
 * @module components/Textarea
 */
import {
  forwardRef,
  useId,
  type TextareaHTMLAttributes,
  type ReactNode,
} from "react";
import { clsx } from "clsx";

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Visible label text (required — accessibility). */
  label: string;
  /** Optional helper text shown under the field. */
  hint?: string;
  /** Inline error message; presence flips the field into the error state. */
  error?: string;
  /** Marks the field visually + semantically required. */
  required?: boolean;
  /** Kiosk profile bumps size to ≥ 72px min-height + larger text. */
  kiosk?: boolean;
  /** Optional error icon (paired with the message). */
  errorIcon?: ReactNode;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      label,
      hint,
      error,
      required = false,
      kiosk = false,
      errorIcon,
      className,
      id,
      rows = 4,
      ...rest
    },
    ref,
  ) {
    const autoId = useId();
    const inputId = id ?? autoId;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;
    const describedBy =
      [error ? errorId : null, hint ? hintId : null]
        .filter(Boolean)
        .join(" ") || undefined;

    return (
      <div className={clsx("sig-field", kiosk && "sig-field--kiosk", className)}>
        <label className="sig-field__label" htmlFor={inputId}>
          {label}
          {required && (
            <span className="sig-field__req" aria-hidden="true">
              *
            </span>
          )}
        </label>
        <textarea
          ref={ref}
          id={inputId}
          rows={rows}
          className="sig-field__input sig-field__input--multiline"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          required={required}
          {...rest}
        />
        {hint && !error && (
          <p id={hintId} className="sig-field__hint">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="sig-field__error" role="alert">
            {errorIcon != null && <span aria-hidden="true">{errorIcon}</span>}
            {error}
          </p>
        )}
      </div>
    );
  },
);
