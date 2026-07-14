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

  // Audit UX borne 2026-07-14 — F1 : sur fond --night, le titre forcé à
  // --ink rendait l'état vide invisible (1.02:1). La variante inverse doit
  // exister et être opt-in (le défaut reste l'encre sur fond clair).
  it("F1: tone='inverse' adds the on-night modifier class", () => {
    const { container } = render(
      <EmptyState title="t" description="d" tone="inverse" />,
    );
    const root = container.querySelector(".sig-empty");
    expect(root).not.toBeNull();
    expect(root!.classList.contains("sig-empty--inverse")).toBe(true);
  });

  it("F1: default tone does NOT carry the inverse modifier", () => {
    const { container } = render(<EmptyState title="t" />);
    const root = container.querySelector(".sig-empty");
    expect(root!.classList.contains("sig-empty--inverse")).toBe(false);
  });
});
