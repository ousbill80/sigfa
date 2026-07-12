/**
 * Stepper — SIGFA v2 onboarding progress. Marks steps done / current / upcoming.
 * Labels come from props. Exposes `aria-current="step"` on the active step and
 * a list semantic so assistive tech can announce progress.
 *
 * @module components/Stepper
 */
import { Fragment, type HTMLAttributes, type ReactNode } from "react";
import { clsx } from "clsx";

export interface StepperProps extends HTMLAttributes<HTMLOListElement> {
  /** Ordered step labels. */
  steps: readonly string[];
  /** Zero-based index of the current step. */
  current: number;
}

type StepStatus = "done" | "current" | "upcoming";

function statusFor(index: number, current: number): StepStatus {
  if (index < current) return "done";
  if (index === current) return "current";
  return "upcoming";
}

export function Stepper({
  steps,
  current,
  className,
  ...rest
}: StepperProps): ReactNode {
  return (
    <ol className={clsx("sig-stepper", className)} {...rest}>
      {steps.map((label, index) => {
        const status = statusFor(index, current);
        return (
          <Fragment key={`${index}-${label}`}>
            {index > 0 && (
              <li
                aria-hidden="true"
                className={clsx(
                  "sig-stepper__connector",
                  index <= current && "sig-stepper__connector--done",
                )}
              />
            )}
            <li
              className={clsx(
                "sig-stepper__step",
                `sig-stepper__step--${status}`,
              )}
              aria-current={status === "current" ? "step" : undefined}
            >
              <span className="sig-stepper__marker">
                {status === "done" ? (
                  <span aria-hidden="true">✓</span>
                ) : (
                  index + 1
                )}
              </span>
              <span className="sig-stepper__label">{label}</span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
