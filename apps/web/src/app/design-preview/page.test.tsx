/**
 * Tests for the /design-preview gallery — specifically the « Theming banque »
 * section that proves per-bank branding via `BankThemeProvider`. The rest of
 * the gallery is validated by visual review; here we assert that the demo
 * renders the same component block under multiple bank charters and that the
 * derived brand variables are actually injected.
 *
 * @module app/design-preview/page.test
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { deriveBankTheme } from "@sigfa/ui";
import DesignPreviewPage from "./page";

describe("design-preview — bank theming demo", () => {
  it("renders the « Theming banque » section heading", () => {
    render(<DesignPreviewPage />);
    expect(
      screen.getByRole("heading", { name: /theming banque/i }),
    ).toBeInTheDocument();
  });

  it("renders the same block under multiple bank charters (default + 3 banks)", () => {
    render(<DesignPreviewPage />);
    // Each chart carries a « Call next » primary button; there is also one in
    // the buttons section, so we expect at least the four demo charts.
    const callNext = screen.getAllByRole("button", {
      name: /appeler le suivant/i,
    });
    expect(callNext.length).toBeGreaterThanOrEqual(4);
  });

  it("injects derived brand variables for a themed bank (blue #1E5AA8)", () => {
    render(<DesignPreviewPage />);
    const theme = deriveBankTheme("#1E5AA8");
    // The provider wrapper sets --brand inline; find it by its computed value.
    const wrappers = Array.from(
      document.querySelectorAll<HTMLElement>("[style]"),
    );
    const blueWrapper = wrappers.find(
      (el) => el.style.getPropertyValue("--brand") === theme.brand,
    );
    expect(blueWrapper).toBeDefined();
    expect(blueWrapper?.style.getPropertyValue("--brand-contrast")).toBe(
      theme.brandContrast,
    );
  });
});
