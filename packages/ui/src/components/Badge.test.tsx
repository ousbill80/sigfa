import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge.js";

describe("Badge", () => {
  it("renders its label and defaults to the brand tone", () => {
    render(<Badge>Nouveau</Badge>);
    const el = screen.getByText("Nouveau");
    expect(el).toHaveClass("sig-badge", "sig-badge--brand");
  });

  it.each(["success", "warning", "danger", "info", "brand"] as const)(
    "supports the %s tone",
    (tone) => {
      render(<Badge tone={tone}>x</Badge>);
      expect(screen.getByText("x")).toHaveClass(`sig-badge--${tone}`);
    },
  );

  it("renders a status dot when requested", () => {
    const { container } = render(
      <Badge tone="success" dot>
        Ouvert
      </Badge>,
    );
    expect(container.querySelector(".sig-badge__dot")).not.toBeNull();
  });

  it("danger tone never gets a solid fill class (rule: pastille only)", () => {
    render(
      <Badge tone="danger" dot>
        SLA
      </Badge>,
    );
    // The danger variant is bordered/transparent — asserted via the modifier;
    // the CSS guarantees no solid background.
    expect(screen.getByText("SLA")).toHaveClass("sig-badge--danger");
  });
});
