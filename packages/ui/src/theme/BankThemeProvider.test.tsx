import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BankThemeProvider, useBankLogo } from "./BankThemeProvider.js";
import { deriveBankTheme } from "./bank-theme.js";

function LogoProbe(): React.ReactElement {
  const logo = useBankLogo();
  return <span data-testid="logo">{logo ?? "none"}</span>;
}

describe("BankThemeProvider", () => {
  it("renders its children", () => {
    render(
      <BankThemeProvider>
        <span data-testid="child">hi</span>
      </BankThemeProvider>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("injects the derived brand tokens as inline CSS variables", () => {
    render(
      <BankThemeProvider brandColor="#1E5AA8">
        <span data-testid="child">hi</span>
      </BankThemeProvider>,
    );
    const wrapper = screen.getByTestId("child").parentElement as HTMLElement;
    const theme = deriveBankTheme("#1E5AA8");
    expect(wrapper.style.getPropertyValue("--tenant-brand")).toBe(theme.brand);
    expect(wrapper.style.getPropertyValue("--brand")).toBe(theme.brand);
    expect(wrapper.style.getPropertyValue("--brand-strong")).toBe(
      theme.brandStrong,
    );
    expect(wrapper.style.getPropertyValue("--brand-soft")).toBe(
      theme.brandSoft,
    );
    expect(wrapper.style.getPropertyValue("--brand-contrast")).toBe(
      theme.brandContrast,
    );
    expect(wrapper.style.getPropertyValue("--brand-inv")).toBe(theme.brandInv);
  });

  it("without a brandColor injects NO brand overrides (default deep blue kept)", () => {
    render(
      <BankThemeProvider>
        <span data-testid="child">hi</span>
      </BankThemeProvider>,
    );
    const wrapper = screen.getByTestId("child").parentElement as HTMLElement;
    expect(wrapper.style.getPropertyValue("--tenant-brand")).toBe("");
    expect(wrapper.style.getPropertyValue("--brand")).toBe("");
  });

  it("exposes the logo url via context when provided", () => {
    render(
      <BankThemeProvider brandColor="#0B7A4B" logoUrl="/banks/acme.svg">
        <LogoProbe />
      </BankThemeProvider>,
    );
    expect(screen.getByTestId("logo")).toHaveTextContent("/banks/acme.svg");
  });

  it("useBankLogo returns undefined outside any provider", () => {
    render(<LogoProbe />);
    expect(screen.getByTestId("logo")).toHaveTextContent("none");
  });

  it("forwards className and extra props to the wrapper", () => {
    render(
      <BankThemeProvider brandColor="#6B3FA0" className="tenant-scope">
        <span data-testid="child">hi</span>
      </BankThemeProvider>,
    );
    const wrapper = screen.getByTestId("child").parentElement as HTMLElement;
    expect(wrapper).toHaveClass("tenant-scope");
  });

  it("merges caller-supplied inline style with the theme variables", () => {
    render(
      <BankThemeProvider brandColor="#1E5AA8" style={{ padding: "8px" }}>
        <span data-testid="child">hi</span>
      </BankThemeProvider>,
    );
    const wrapper = screen.getByTestId("child").parentElement as HTMLElement;
    expect(wrapper.style.padding).toBe("8px");
    expect(wrapper.style.getPropertyValue("--brand")).not.toBe("");
  });
});
