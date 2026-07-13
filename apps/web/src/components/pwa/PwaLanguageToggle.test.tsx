/**
 * NOTIF-005-B — tests for the FR/EN language toggle.
 * @module components/pwa/PwaLanguageToggle.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PwaLanguageToggle } from "./PwaLanguageToggle";

describe("NOTIF-005-B: PwaLanguageToggle (FR/EN only)", () => {
  it("renders exactly two options and marks the active one", () => {
    render(<PwaLanguageToggle locale="fr" onChange={() => {}} />);
    expect(screen.getByTestId("pwa-lang-fr")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("pwa-lang-en")).toHaveAttribute("aria-pressed", "false");
  });

  it("invokes onChange with the chosen locale", async () => {
    const onChange = vi.fn();
    render(<PwaLanguageToggle locale="fr" onChange={onChange} />);
    await userEvent.click(screen.getByTestId("pwa-lang-en"));
    expect(onChange).toHaveBeenCalledWith("en");
  });
});
