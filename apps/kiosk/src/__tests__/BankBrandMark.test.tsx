/**
 * KIOSK-HOME (retour visuel PO) — Tests TDD pour components/BankBrandMark.tsx
 * Marque tenant de l'ecran d'accueil : logo (plaque claire) quand l'URL est
 * fournie, repli monogramme (pastille --brand) sinon ou en echec de chargement.
 * JAMAIS d'image cassee. Ecrits AVANT l'implementation (phase rouge).
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BankBrandMark } from "@/components/BankBrandMark";

describe("KIOSK-HOME: BankBrandMark", () => {
  it("sans logoUrl : pastille monogramme --brand + nom de banque, aucune image", () => {
    const { container } = render(<BankBrandMark bankName="Banque Atlantique" />);

    const monogram = container.querySelector("[data-testid='bank-monogram']");
    expect(monogram).toBeInTheDocument();
    expect(monogram?.textContent).toBe("BA");
    expect((monogram as HTMLElement).style.backgroundColor).toBe("var(--brand)");
    expect((monogram as HTMLElement).style.color).toBe("var(--brand-contrast)");
    // Decoratif : le nom en toutes lettres porte le sens.
    expect(monogram?.getAttribute("aria-hidden")).toBe("true");

    const name = container.querySelector("[data-testid='bank-name']");
    expect(name?.textContent).toBe("Banque Atlantique");

    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("avec logoUrl : logo rendu (alt = nom de banque) sur plaque claire + nom", () => {
    const { container } = render(
      <BankBrandMark bankName="BNCI" logoUrl="/mock/bank/logo.svg" />
    );

    const logo = container.querySelector("[data-testid='bank-logo']");
    expect(logo).toBeInTheDocument();
    expect(logo?.getAttribute("src")).toBe("/mock/bank/logo.svg");
    expect(logo?.getAttribute("alt")).toBe("BNCI");

    // Le nom accompagne TOUJOURS le logo (exigence PO).
    const name = container.querySelector("[data-testid='bank-name']");
    expect(name?.textContent).toBe("BNCI");

    // Pas de monogramme quand le logo est affiche.
    expect(
      container.querySelector("[data-testid='bank-monogram']")
    ).not.toBeInTheDocument();
  });

  it("echec de chargement du logo (onError) : bascule sur le monogramme, jamais d'image cassee", () => {
    const { container } = render(
      <BankBrandMark bankName="Banque Atlantique" logoUrl="/logo-404.png" />
    );

    const logo = container.querySelector("[data-testid='bank-logo']");
    expect(logo).toBeInTheDocument();

    fireEvent.error(logo as HTMLElement);

    expect(container.querySelector("img")).not.toBeInTheDocument();
    const monogram = container.querySelector("[data-testid='bank-monogram']");
    expect(monogram).toBeInTheDocument();
    expect(monogram?.textContent).toBe("BA");
  });

  it("logoUrl null (contrat : banque sans logo) : repli monogramme", () => {
    const { container } = render(
      <BankBrandMark bankName="SIGFA" logoUrl={null} />
    );

    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(
      container.querySelector("[data-testid='bank-monogram']")?.textContent
    ).toBe("S");
  });
});
