import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OfflineBanner } from "./OfflineBanner.js";

describe("OfflineBanner", () => {
  it("renders the message from props", () => {
    render(<OfflineBanner message="Mode hors-ligne — reconnexion en cours" />);
    expect(
      screen.getByText("Mode hors-ligne — reconnexion en cours"),
    ).toBeInTheDocument();
  });

  it("announces politely via role=status / aria-live", () => {
    render(<OfflineBanner message="hors-ligne" />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-live", "polite");
    expect(el).toHaveClass("sig-offline");
  });

  it("renders extra children", () => {
    render(
      <OfflineBanner message="m">
        <span data-testid="extra" />
      </OfflineBanner>,
    );
    expect(screen.getByTestId("extra")).toBeInTheDocument();
  });
});
