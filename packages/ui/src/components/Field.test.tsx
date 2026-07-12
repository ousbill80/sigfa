import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Field } from "./Field.js";

describe("Field", () => {
  it("binds the label to the input for accessibility", () => {
    render(<Field label="Numéro de téléphone" />);
    expect(
      screen.getByLabelText("Numéro de téléphone"),
    ).toBeInTheDocument();
  });

  it("accepts typing", async () => {
    render(<Field label="Nom" />);
    const input = screen.getByLabelText("Nom");
    await userEvent.type(input, "Awa");
    expect(input).toHaveValue("Awa");
  });

  it("shows a hint linked via aria-describedby", () => {
    render(<Field label="Email" hint="Nous ne le partageons jamais" />);
    const input = screen.getByLabelText("Email");
    const hint = screen.getByText("Nous ne le partageons jamais");
    expect(input.getAttribute("aria-describedby")).toContain(hint.id);
  });

  it("error: sets aria-invalid, exposes an alert, hides the hint", () => {
    render(
      <Field
        label="Email"
        hint="indice"
        error="Adresse invalide"
      />,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Adresse invalide");
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
    expect(screen.queryByText("indice")).not.toBeInTheDocument();
  });

  it("required: marks the input and shows the asterisk", () => {
    render(<Field label="PIN" required />);
    const input = screen.getByLabelText(/PIN/);
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("aria-required", "true");
  });

  it("kiosk: applies the kiosk size modifier", () => {
    const { container } = render(<Field label="Code" kiosk />);
    expect(container.querySelector(".sig-field--kiosk")).not.toBeNull();
  });

  it("disabled: input is not editable", async () => {
    render(<Field label="Verrou" disabled />);
    const input = screen.getByLabelText("Verrou");
    expect(input).toBeDisabled();
    await userEvent.type(input, "x");
    expect(input).toHaveValue("");
  });
});
