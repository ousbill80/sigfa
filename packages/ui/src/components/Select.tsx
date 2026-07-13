/**
 * Select — SIGFA v2. A tokenised native `<select>`: `--hairline` border,
 * `--surface-2` rest surface, a token chevron, and a `:focus-visible`
 * `--focus-ring` (`--brand`, 3px). Shares {@link Field}'s label / hint / error
 * scaffolding. Options are provided declaratively (`options`) or as children.
 * All text comes from props (i18n-agnostic).
 *
 * @module components/Select
 */
import {
  forwardRef,
  useId,
  type SelectHTMLAttributes,
  type ReactNode,
} from "react";
import { clsx } from "clsx";

export interface SelectOption {
  /** Underlying value. */
  value: string;
  /** Visible label. */
  label: string;
  /** Disable this option. */
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  /** Visible label text (required — accessibility). */
  label: string;
  /** Optional helper text shown under the control. */
  hint?: string;
  /** Inline error message; presence flips the control into the error state. */
  error?: string;
  /** Marks the control visually + semantically required. */
  required?: boolean;
  /** Kiosk profile bumps size to ≥ 72px. */
  kiosk?: boolean;
  /** Declarative options (alternative to passing `<option>` children). */
  options?: readonly SelectOption[];
  /** Optional placeholder rendered as a disabled first option. */
  placeholder?: string;
  children?: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      label,
      hint,
      error,
      required = false,
      kiosk = false,
      options,
      placeholder,
      className,
      id,
      children,
      defaultValue,
      value,
      ...rest
    },
    ref,
  ) {
    const autoId = useId();
    const selectId = id ?? autoId;
    const errorId = `${selectId}-error`;
    const hintId = `${selectId}-hint`;
    const describedBy =
      [error ? errorId : null, hint ? hintId : null]
        .filter(Boolean)
        .join(" ") || undefined;
    // A placeholder is only "selected by default" when the caller does not
    // control the value nor set a default — keeps it a controlled-friendly hint.
    const uncontrolled = value === undefined && defaultValue === undefined;

    return (
      <div
        className={clsx(
          "sig-field",
          "sig-select",
          kiosk && "sig-field--kiosk",
          className,
        )}
      >
        <label className="sig-field__label" htmlFor={selectId}>
          {label}
          {required && (
            <span className="sig-field__req" aria-hidden="true">
              *
            </span>
          )}
        </label>
        <div className="sig-select__wrap">
          <select
            ref={ref}
            id={selectId}
            className="sig-field__input sig-select__control"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            aria-required={required || undefined}
            required={required}
            value={value}
            defaultValue={
              uncontrolled && placeholder ? "" : defaultValue
            }
            {...rest}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options?.map((opt) => (
              <option
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
              >
                {opt.label}
              </option>
            ))}
            {children}
          </select>
          <span className="sig-select__chevron" aria-hidden="true">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </span>
        </div>
        {hint && !error && (
          <p id={hintId} className="sig-field__hint">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="sig-field__error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);
