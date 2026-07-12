import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiTile } from "./KpiTile.js";

describe("KpiTile", () => {
  it("renders label and value from props", () => {
    render(<KpiTile label="Temps d'attente moyen" value="4 min 12" />);
    expect(screen.getByText("Temps d'attente moyen")).toBeInTheDocument();
    expect(screen.getByText("4 min 12")).toBeInTheDocument();
  });

  it("renders a delta with the trend class", () => {
    const { container } = render(
      <KpiTile label="NPS" value="72" delta="+8 vs J-7" trend="up" />,
    );
    expect(screen.getByText("+8 vs J-7")).toBeInTheDocument();
    expect(container.querySelector(".sig-kpi__delta--up")).not.toBeNull();
  });

  it.each(["up", "down", "flat"] as const)(
    "applies the %s trend modifier",
    (trend) => {
      const { container } = render(
        <KpiTile label="x" value="1" delta="d" trend={trend} />,
      );
      expect(
        container.querySelector(`.sig-kpi__delta--${trend}`),
      ).not.toBeNull();
    },
  );

  it("omits the delta node when no delta is given", () => {
    const { container } = render(<KpiTile label="x" value="1" />);
    expect(container.querySelector(".sig-kpi__delta")).toBeNull();
  });

  it("renders a children slot (e.g. sparkline)", () => {
    render(
      <KpiTile label="x" value="1">
        <div data-testid="spark" />
      </KpiTile>,
    );
    expect(screen.getByTestId("spark")).toBeInTheDocument();
  });
});
