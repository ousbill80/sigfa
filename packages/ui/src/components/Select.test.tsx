import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select, type SelectOption } from "./Select.js";

const OPTIONS: SelectOption[] = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
];

describe("Select", () => {
  it("binds the label to the control for accessibility", () => {
    render(<Select label="Langue" options={OPTIONS} />);
    expect(screen.getByLabelText("Langue")).toBeInTheDocument();
  });

  it("renders declarative options", () => {
    render(<Select label="Langue" options={OPTIONS} />);
    expect(
      screen.getByRole("option", { name: "Français" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "English" }),
    ).toBeInTheDocument();
  });

  it("renders children options too", () => {
    render(
      <Select label="Langue">
        <option value="es">Español</option>
      </Select>,
    );
    expect(screen.getByRole("option", { name: "Español" })).toBeInTheDocument();
  });

  it("shows a disabled placeholder as the first option", () => {
    render(
      <Select label="Langue" options={OPTIONS} placeholder="Choisir…" />,
    );
    const placeholder = screen.getByRole("option", { name: "Choisir…" });
    expect(placeholder).toBeDisabled();
  });

  it("lets the user pick an option", async () => {
    render(<Select label="Langue" options={OPTIONS} />);
    const select = screen.getByLabelText("Langue");
    await userEvent.selectOptions(select, "en");
    expect(select).toHaveValue("en");
  });

  it("renders the tokenised chevron", () => {
    const { container } = render(<Select label="Langue" options={OPTIONS} />);
    expect(container.querySelector(".sig-select__chevron")).not.toBeNull();
  });

  it("error: sets aria-invalid + exposes an alert", () => {
    render(
      <Select label="Langue" options={OPTIONS} error="Sélection requise" />,
    );
    const select = screen.getByLabelText("Langue");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Sélection requise");
  });

  it("required: marks the control + shows the asterisk", () => {
    render(<Select label="Langue" options={OPTIONS} required />);
    const select = screen.getByLabelText(/Langue/);
    expect(select).toBeRequired();
    expect(select).toHaveAttribute("aria-required", "true");
  });

  it("kiosk: applies the kiosk size modifier", () => {
    const { container } = render(
      <Select label="Langue" options={OPTIONS} kiosk />,
    );
    expect(container.querySelector(".sig-field--kiosk")).not.toBeNull();
  });

  it("disabled: control is disabled", () => {
    render(<Select label="Langue" options={OPTIONS} disabled />);
    expect(screen.getByLabelText("Langue")).toBeDisabled();
  });
});
