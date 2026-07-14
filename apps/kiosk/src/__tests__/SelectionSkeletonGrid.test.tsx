/**
 * AUDIT-F20 — Tests TDD pour SelectionSkeletonGrid.tsx
 * Écrits AVANT l'implémentation (phase rouge).
 *
 * L'état loading des écrans de sélection (services / opérations / conseillers)
 * était une icône statique + texte : la borne semblait FIGÉE. Le design system
 * v2 prévoit un composant Skeleton (shimmer doux, reduced-motion respecté) —
 * ce composant l'assemble en GRILLE DE TUILES qui préfigure les cartes réelles.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { SelectionSkeletonGrid } from "@/components/SelectionSkeletonGrid";

describe("AUDIT-F20: SelectionSkeletonGrid", () => {
  it("AUDIT-F20: rend 6 tuiles squelettes par défaut, en grille comme les cartes réelles", () => {
    render(<SelectionSkeletonGrid label="Chargement des opérations..." />);
    const tiles = screen.getAllByTestId("skeleton-tile");
    expect(tiles).toHaveLength(6);
    // Chaque tuile préfigure une carte : cercle d'icône + ligne de libellé +
    // pill d'attente = 3 placeholders shimmer du design system (.sig-skeleton).
    tiles.forEach((tile) => {
      expect(tile.querySelectorAll(".sig-skeleton").length).toBe(3);
      // Même gabarit que les cartes réelles (≥ 96 px, rayon carte, surface claire).
      expect((tile as HTMLElement).style.minHeight).toBe("96px");
      expect((tile as HTMLElement).style.backgroundColor).toBe("var(--surface-1)");
    });
  });

  it("AUDIT-F20: nombre de tuiles paramétrable (tileCount)", () => {
    render(<SelectionSkeletonGrid label="Chargement..." tileCount={4} />);
    expect(screen.getAllByTestId("skeleton-tile")).toHaveLength(4);
  });

  it("AUDIT-F20: l'animation vient de la classe DS .sig-skeleton (shimmer + prefers-reduced-motion gérés par @sigfa/ui)", () => {
    const { container } = render(<SelectionSkeletonGrid label="Chargement..." />);
    // Le shimmer et sa désactivation reduced-motion vivent dans components.css
    // (@sigfa/ui) : le composant ne fait QUE poser la classe, aucune animation
    // en dur ici.
    const shimmers = container.querySelectorAll(".sig-skeleton");
    expect(shimmers.length).toBeGreaterThanOrEqual(18);
    shimmers.forEach((s) => {
      expect(s).toHaveAttribute("aria-hidden", "true");
    });
  });

  it("AUDIT-F20: région role=status + message visible 24px (annonce du chargement, texte porteur de sens)", () => {
    render(
      <SelectionSkeletonGrid label="Chargement des conseillers..." data-testid="managers-loading" />
    );
    const region = screen.getByTestId("managers-loading");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    const label = screen.getByText("Chargement des conseillers...");
    expect(label).toBeInTheDocument();
    expect((label as HTMLElement).style.fontSize).toBe("24px");
  });

  it("AUDIT-F20: la grille de tuiles est masquée aux lecteurs d'écran (seul le message est annoncé)", () => {
    const { container } = render(<SelectionSkeletonGrid label="Chargement..." />);
    const grid = container.querySelector("[data-testid='skeleton-tile']")?.parentElement;
    expect(grid).toHaveAttribute("aria-hidden", "true");
  });
});
