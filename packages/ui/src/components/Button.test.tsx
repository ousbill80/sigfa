import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { Button } from "./Button.js";

describe("Button", () => {
  it("renders its label from props (i18n-agnostic)", () => {
    render(<Button>Appeler le suivant</Button>);
    expect(
      screen.getByRole("button", { name: "Appeler le suivant" }),
    ).toBeInTheDocument();
  });

  it("defaults to primary + md and applies variant/size classes", () => {
    render(<Button>Go</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("sig-btn", "sig-btn--primary", "sig-btn--md");
  });

  it.each(["primary", "secondary", "ghost", "danger"] as const)(
    "supports the %s variant",
    (variant) => {
      render(<Button variant={variant}>x</Button>);
      expect(screen.getByRole("button")).toHaveClass(`sig-btn--${variant}`);
    },
  );

  it.each(["dense", "md", "kiosk"] as const)(
    "supports the %s size",
    (size) => {
      render(<Button size={size}>x</Button>);
      expect(screen.getByRole("button")).toHaveClass(`sig-btn--${size}`);
    },
  );

  it("defaults type to button (never accidental submit)", () => {
    render(<Button>x</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("fires onClick when activated", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>x</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is keyboard-focusable and activates via Enter/Space", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>x</Button>);
    await userEvent.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("disabled: not clickable, not focusable", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        x
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders start and end icons marked aria-hidden", () => {
    render(
      <Button
        iconStart={<span data-testid="i1">a</span>}
        iconEnd={<span data-testid="i2">b</span>}
      >
        x
      </Button>,
    );
    expect(screen.getByTestId("i1").parentElement).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("i2")).toBeInTheDocument();
  });

  it("forwards a ref to the underlying button", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>x</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
