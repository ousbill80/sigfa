import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Card } from "./Card.js";

describe("Card", () => {
  it("renders children in a static surface by default", () => {
    render(<Card>contenu</Card>);
    const el = screen.getByText("contenu");
    expect(el).toHaveClass("sig-card");
    expect(el).not.toHaveClass("sig-card--interactive");
    expect(el).not.toHaveAttribute("role", "button");
  });

  it("interactive: becomes a focusable button role", () => {
    render(
      <Card interactive onActivate={() => {}}>
        c
      </Card>,
    );
    const el = screen.getByRole("button");
    expect(el).toHaveClass("sig-card--interactive");
    expect(el).toHaveAttribute("tabindex", "0");
  });

  it("interactive: activates on click", async () => {
    const onActivate = vi.fn();
    render(
      <Card interactive onActivate={onActivate}>
        c
      </Card>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("interactive: activates on Enter and Space", async () => {
    const onActivate = vi.fn();
    render(
      <Card interactive onActivate={onActivate}>
        c
      </Card>,
    );
    await userEvent.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it("non-interactive: ignores keyboard activation", async () => {
    const onActivate = vi.fn();
    render(<Card onActivate={onActivate}>c</Card>);
    await userEvent.keyboard("{Enter}");
    expect(onActivate).not.toHaveBeenCalled();
  });
});
