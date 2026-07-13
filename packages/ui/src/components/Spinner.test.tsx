import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "./Spinner.js";

describe("Spinner", () => {
  it("exposes an ARIA status with the label for AT", () => {
    render(<Spinner label="Chargement…" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Chargement…");
    expect(status).toHaveClass("sig-spinner", "sig-spinner--md");
  });

  it("renders the animated ring aria-hidden", () => {
    const { container } = render(<Spinner label="Chargement" />);
    const ring = container.querySelector(".sig-spinner__ring");
    expect(ring).not.toBeNull();
    expect(ring).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the label visually hidden by default", () => {
    render(<Spinner label="Chargement" />);
    expect(screen.getByTestId("spinner-label")).toHaveClass(
      "sig-spinner__label--sr",
    );
  });

  it("shows the label when showLabel is set", () => {
    render(<Spinner label="Chargement" showLabel />);
    expect(screen.getByTestId("spinner-label")).not.toHaveClass(
      "sig-spinner__label--sr",
    );
  });

  it.each(["sm", "md", "lg"] as const)("supports the %s size", (size) => {
    render(<Spinner label="x" size={size} />);
    expect(screen.getByRole("status")).toHaveClass(`sig-spinner--${size}`);
  });
});
