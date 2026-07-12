import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState.js";

describe("EmptyState", () => {
  it("renders title and description from props", () => {
    render(
      <EmptyState
        title="Aucun ticket en attente"
        description="La file est vide pour le moment."
      />,
    );
    expect(screen.getByText("Aucun ticket en attente")).toBeInTheDocument();
    expect(
      screen.getByText("La file est vide pour le moment."),
    ).toBeInTheDocument();
  });

  it("renders the icon slot marked aria-hidden", () => {
    const { container } = render(
      <EmptyState title="t" icon={<span data-testid="ic" />} />,
    );
    expect(screen.getByTestId("ic").parentElement).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(container.querySelector(".sig-empty__icon")).not.toBeNull();
  });

  it("renders an action slot", () => {
    render(<EmptyState title="t" action={<button>Actualiser</button>} />);
    expect(
      screen.getByRole("button", { name: "Actualiser" }),
    ).toBeInTheDocument();
  });

  it("omits optional slots when not provided", () => {
    const { container } = render(<EmptyState title="t" />);
    expect(container.querySelector(".sig-empty__desc")).toBeNull();
    expect(container.querySelector(".sig-empty__actions")).toBeNull();
    expect(container.querySelector(".sig-empty__icon")).toBeNull();
  });
});
