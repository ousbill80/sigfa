/**
 * Tests for Sparkline (WEB-003).
 * @module components/manager/sparkline.test
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sparkline } from "./sparkline";

const data24 = Array.from({ length: 24 }, (_, i) => i);

describe("Sparkline", () => {
  it("WEB-003: sparkline Recharts — 24 points rendus", () => {
    render(<Sparkline data={data24} label="TMA 24h" />);
    const el = screen.getByTestId("sparkline");
    expect(el).toHaveAttribute("data-points", "24");
    expect(el).toHaveAttribute("aria-label", "TMA 24h");
  });

  it("WEB-003: fond transparent + rendu sans axes (aucun texte d'axe)", () => {
    const { container } = render(<Sparkline data={data24} />);
    // no axis ticks text rendered
    expect(container.querySelector(".recharts-cartesian-axis")).toBeNull();
    expect(screen.getByTestId("sparkline").getAttribute("style")).toContain("transparent");
  });

  it("WEB-003: trait --brand (stroke tokenisé)", () => {
    const { container } = render(<Sparkline data={data24} />);
    const path = container.querySelector("path.recharts-line-curve");
    expect(path?.getAttribute("stroke")).toBe("var(--brand)");
  });
});
