/**
 * Field / Input — SIGFA v2. `--surface-2` at rest, `--brand` 3px focus ring,
 * inline error under the field (never a modal). Label, hint and error text all
 * come from props (i18n-agnostic). Accessible: label bound via `htmlFor`,
 * `aria-invalid` + `aria-describedby` wire the error/hint to the input.
 *
 * @module components/Field
 */
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { clsx } from "clsx";

export interface FieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Visible label text (required — accessibility). */
  label: string;
  /** Optional helper text shown under the field. */
  hint?: string;
  /** Inline error message; presence flips the field into the error state. */
  error?: string;
  /** Marks the field visually + semantically required. */
  required?: boolean;
  /** Kiosk profile bumps size to ≥ 72px. */
  kiosk?: boolean;
  /** Optional error icon (paired with the message). */
  errorIcon?: ReactNode;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  {
    label,
    hint,
    error,
    required = false,
    kiosk = false,
    errorIcon,
    className,
    id,
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
      <input
        ref={ref}
        id={inputId}
        className="sig-field__input"
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
          {errorIcon != null && (
            <span aria-hidden="true">{errorIcon}</span>
          )}
          {error}
        </p>
      )}
    </div>
  );
});
