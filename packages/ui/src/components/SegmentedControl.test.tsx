import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  SegmentedControl,
  type SegmentedOption,
} from "./SegmentedControl.js";

const OPTIONS: SegmentedOption[] = [
  { value: "day", label: "Jour" },
  { value: "week", label: "Semaine" },
  { value: "month", label: "Mois" },
];

describe("SegmentedControl", () => {
  it("renders an accessible radiogroup with radios", () => {
    render(<SegmentedControl ariaLabel="Période" options={OPTIONS} />);
    expect(
      screen.getByRole("radiogroup", { name: "Période" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("selects the first option by default", () => {
    render(<SegmentedControl ariaLabel="Période" options={OPTIONS} />);
    expect(screen.getByRole("radio", { name: "Jour" })).toBeChecked();
  });

  it("honours defaultValue (uncontrolled)", () => {
    render(
      <SegmentedControl
        ariaLabel="Période"
        options={OPTIONS}
        defaultValue="week"
      />,
    );
    expect(screen.getByRole("radio", { name: "Semaine" })).toBeChecked();
  });

  it("changes selection on click and fires onChange", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Période"
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Mois" }));
    expect(onChange).toHaveBeenCalledWith("month");
    expect(screen.getByRole("radio", { name: "Mois" })).toBeChecked();
  });

  it("respects a controlled value (does not self-mutate)", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Période"
        options={OPTIONS}
        value="day"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Semaine" }));
    expect(onChange).toHaveBeenCalledWith("week");
    // Value is caller-owned → still "day".
    expect(screen.getByRole("radio", { name: "Jour" })).toBeChecked();
  });

  it("moves selection with arrow keys (roving tabindex)", async () => {
    render(<SegmentedControl ariaLabel="Période" options={OPTIONS} />);
    const first = screen.getByRole("radio", { name: "Jour" });
    first.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Semaine" })).toBeChecked();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Jour" })).toBeChecked();
  });

  it("only the selected radio is in the tab order", () => {
    render(
      <SegmentedControl
        ariaLabel="Période"
        options={OPTIONS}
        defaultValue="week"
      />,
    );
    expect(screen.getByRole("radio", { name: "Semaine" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("radio", { name: "Jour" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("renders paired icons and honours disabled options", () => {
    render(
      <SegmentedControl
        ariaLabel="Vue"
        options={[
          { value: "a", label: "A", icon: <span data-testid="ic-a" /> },
          { value: "b", label: "B", disabled: true },
        ]}
      />,
    );
    expect(screen.getByTestId("ic-a")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "B" })).toBeDisabled();
  });

  it("kiosk: applies the kiosk modifier", () => {
    const { container } = render(
      <SegmentedControl ariaLabel="Période" options={OPTIONS} kiosk />,
    );
    expect(container.querySelector(".sig-segmented--kiosk")).not.toBeNull();
  });
});
