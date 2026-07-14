import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stepper } from "./Stepper.js";

const STEPS = ["Banque", "Agence", "Services", "Terminé"] as const;

describe("Stepper", () => {
  it("renders every step label", () => {
    render(<Stepper steps={STEPS} current={1} />);
    for (const label of STEPS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("marks the current step with aria-current=step", () => {
    render(<Stepper steps={STEPS} current={2} />);
    const current = screen.getByText("Services").closest("li");
    expect(current).toHaveAttribute("aria-current", "step");
    expect(current).toHaveClass("sig-stepper__step--current");
  });

  it("marks earlier steps as done with the SIGFA check icon (no glyph)", () => {
    const { container } = render(<Stepper steps={STEPS} current={2} />);
    const done = container.querySelectorAll(".sig-stepper__step--done");
    expect(done).toHaveLength(2);
    expect(
      container.querySelectorAll('svg[data-icon="valider"]'),
    ).toHaveLength(2);
  });

  it("marks later steps as upcoming", () => {
    const { container } = render(<Stepper steps={STEPS} current={0} />);
    expect(
      container.querySelectorAll(".sig-stepper__step--upcoming"),
    ).toHaveLength(3);
  });

  it("renders as an ordered list", () => {
    render(<Stepper steps={STEPS} current={0} />);
    expect(screen.getByRole("list")).toBeInTheDocument();
  });
});
