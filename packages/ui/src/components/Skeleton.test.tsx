import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Skeleton } from "./Skeleton.js";

describe("Skeleton", () => {
  it("applies default dimensions", () => {
    render(<Skeleton />);
    const el = screen.getByTestId("skeleton");
    expect(el).toHaveClass("sig-skeleton");
    expect(el).toHaveStyle({ width: "100%", height: "1rem" });
  });

  it("honours width/height/radius overrides", () => {
    render(<Skeleton width="12rem" height="2rem" radius="999px" />);
    const el = screen.getByTestId("skeleton");
    expect(el).toHaveStyle({
      width: "12rem",
      height: "2rem",
      borderRadius: "999px",
    });
  });

  it("is hidden from assistive tech", () => {
    render(<Skeleton />);
    expect(screen.getByTestId("skeleton")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
