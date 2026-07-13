/**
 * SegmentedControl — SIGFA v2. A 2–3 option toggle that replaces native radio
 * groups and fake tab-bars: a `--brand` marker slides under the active option,
 * each segment is keyboard-focusable with a `--focus-ring`. Implemented as an
 * ARIA `radiogroup` for accessibility. Controlled or uncontrolled.
 * All labels come from props (i18n-agnostic).
 *
 * @module components/SegmentedControl
 */
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import { clsx } from "clsx";

export interface SegmentedOption {
  /** Underlying value. */
  value: string;
  /** Visible label. */
  label: string;
  /** Optional leading icon (paired with the label). */
  icon?: ReactNode;
  /** Disable this segment. */
  disabled?: boolean;
}

export interface SegmentedControlProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Accessible group label (required — describes the choice). */
  ariaLabel: string;
  /** 2–3 options. */
  options: readonly SegmentedOption[];
  /** Controlled selected value. */
  value?: string;
  /** Uncontrolled initial value. */
  defaultValue?: string;
  /** Fired with the newly selected value. */
  onChange?: (value: string) => void;
  /** Kiosk profile bumps target size to ≥ 72px. */
  kiosk?: boolean;
}

export function SegmentedControl({
  ariaLabel,
  options,
  value,
  defaultValue,
  onChange,
  kiosk = false,
  className,
  ...rest
}: SegmentedControlProps): ReactNode {
  const groupId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [internal, setInternal] = useState<string>(
    defaultValue ?? options[0]?.value ?? "",
  );
  const isControlled = value !== undefined;
  const selected = isControlled ? value : internal;

  const select = (next: string): void => {
    if (!isControlled) setInternal(next);
    onChange?.(next);
  };

  /** Arrow keys move selection (roving-tabindex radiogroup semantics). */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const { key } = event;
    if (
      key !== "ArrowRight" &&
      key !== "ArrowDown" &&
      key !== "ArrowLeft" &&
      key !== "ArrowUp"
    ) {
      return;
    }
    const enabled = options.filter((o) => !o.disabled);
    if (enabled.length === 0) return;
    const currentIdx = Math.max(
      0,
      enabled.findIndex((o) => o.value === selected),
    );
    const forward = key === "ArrowRight" || key === "ArrowDown";
    const nextIdx =
      (currentIdx + (forward ? 1 : -1) + enabled.length) % enabled.length;
    const next = enabled[nextIdx];
    if (!next) return;
    event.preventDefault();
    select(next.value);
    rootRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${groupId}-${next.value}`)}`)
      ?.focus();
  };

  return (
    <div
      ref={rootRef}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={clsx(
        "sig-segmented",
        kiosk && "sig-segmented--kiosk",
        className,
      )}
      {...rest}
    >
      {options.map((opt) => {
        const isSelected = opt.value === selected;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            id={`${groupId}-${opt.value}`}
            aria-checked={isSelected}
            disabled={opt.disabled}
            tabIndex={isSelected ? 0 : -1}
            className={clsx(
              "sig-segmented__option",
              isSelected && "sig-segmented__option--selected",
            )}
            onClick={() => select(opt.value)}
          >
            {opt.icon != null && (
              <span className="sig-segmented__icon" aria-hidden="true">
                {opt.icon}
              </span>
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
