import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Textarea } from "./Textarea.js";

describe("Textarea", () => {
  it("binds the label to the control for accessibility", () => {
    render(<Textarea label="Motif" />);
    expect(screen.getByLabelText("Motif")).toBeInTheDocument();
  });

  it("accepts multiline typing", async () => {
    render(<Textarea label="Note" />);
    const area = screen.getByLabelText("Note");
    await userEvent.type(area, "Ligne 1{enter}Ligne 2");
    expect(area).toHaveValue("Ligne 1\nLigne 2");
  });

  it("renders the multiline skin class and default rows", () => {
    render(<Textarea label="Note" />);
    const area = screen.getByLabelText("Note");
    expect(area).toHaveClass("sig-field__input--multiline");
    expect(area).toHaveAttribute("rows", "4");
  });

  it("shows a hint linked via aria-describedby", () => {
    render(<Textarea label="Note" hint="Facultatif" />);
    const area = screen.getByLabelText("Note");
    const hint = screen.getByText("Facultatif");
    expect(area.getAttribute("aria-describedby")).toContain(hint.id);
  });

  it("error: sets aria-invalid, exposes an alert, hides the hint", () => {
    render(<Textarea label="Note" hint="indice" error="Champ requis" />);
    const area = screen.getByLabelText("Note");
    expect(area).toHaveAttribute("aria-invalid", "true");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Champ requis");
    expect(area.getAttribute("aria-describedby")).toContain(alert.id);
    expect(screen.queryByText("indice")).not.toBeInTheDocument();
  });

  it("renders the error icon paired with the message", () => {
    render(
      <Textarea
        label="Note"
        error="Requis"
        errorIcon={<span data-testid="err-ic" />}
      />,
    );
    expect(screen.getByTestId("err-ic")).toBeInTheDocument();
  });

  it("required: marks the control + shows the asterisk", () => {
    render(<Textarea label="Motif" required />);
    const area = screen.getByLabelText(/Motif/);
    expect(area).toBeRequired();
    expect(area).toHaveAttribute("aria-required", "true");
  });

  it("kiosk: applies the kiosk size modifier", () => {
    const { container } = render(<Textarea label="Motif" kiosk />);
    expect(container.querySelector(".sig-field--kiosk")).not.toBeNull();
  });

  it("disabled: control is not editable", async () => {
    render(<Textarea label="Verrou" disabled />);
    const area = screen.getByLabelText("Verrou");
    expect(area).toBeDisabled();
    await userEvent.type(area, "x");
    expect(area).toHaveValue("");
  });
});
