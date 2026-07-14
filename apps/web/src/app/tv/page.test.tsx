/**
 * Tests for /tv page — écran TV public agence par défaut (composant serveur :
 * logo banque résolu via lib/bank-branding puis passé en prop).
 * @module app/tv/page.test
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TvPage from "./page";

describe("TV-001: /tv page", () => {
  it("TV-001: rend l'écran TV split (simulation sans provider) sans crash", () => {
    render(<TvPage />);
    expect(screen.getByTestId("tv-root")).toBeInTheDocument();
    expect(screen.getByTestId("tv-screen")).toBeInTheDocument();
    expect(screen.getByText("Banque du Commerce")).toBeInTheDocument();
  });

  it("TV-LOGO: sans NEXT_PUBLIC_BANK_LOGO_URL — repli pastille + initiale dans le bandeau", () => {
    render(<TvPage />);
    // Environnement de test non provisionné : convention lib/bank-branding →
    // pastille --brand-contrast avec l'initiale, jamais d'image requise.
    expect(screen.getByTestId("tv-brand-mark")).toHaveTextContent("B");
    expect(screen.queryByTestId("tv-brand-logo")).toBeNull();
  });
});
