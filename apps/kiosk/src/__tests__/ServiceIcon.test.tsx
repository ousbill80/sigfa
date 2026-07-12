/**
 * Tests du jeu d'icônes SVG des services (refonte v2 — fin des emoji).
 * Couvre le mapping par mot-clé (FR/EN), le fallback générique et le rendu SVG.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  ServiceIcon,
  resolveServiceIcon,
  type ServiceIconName,
} from "@/components/icons/ServiceIcon";
import {
  AccessibilityIcon,
  ChevronIcon,
  PhoneIcon,
} from "@/components/icons/UiIcons";

describe("ServiceIcon: mapping par mot-clé", () => {
  it.each<[string, ServiceIconName]>([
    ["Dépôt", "deposit"],
    ["Deposit", "deposit"],
    ["Retrait", "withdrawal"],
    ["Cash withdrawal", "withdrawal"],
    ["Virement international", "transfer"],
    ["Transfer", "transfer"],
    ["Réclamation", "complaint"],
    ["Complaint", "complaint"],
    ["Ouverture de compte", "account"],
    ["Account", "account"],
    ["Crédit", "credit"],
    ["Loan", "credit"],
    ["Épargne", "savings"],
    ["Savings", "savings"],
    ["Change de devises", "exchange"],
    ["Currency exchange", "exchange"],
    ["Conseiller", "advisor"],
    ["Rendez-vous", "advisor"],
    ["Service inconnu XYZ", "generic"],
  ])("%s → %s", (keyword, expected) => {
    expect(resolveServiceIcon(keyword)).toBe(expected);
  });
});

describe("ServiceIcon: rendu SVG", () => {
  const allNames: ServiceIconName[] = [
    "deposit",
    "withdrawal",
    "transfer",
    "complaint",
    "account",
    "credit",
    "savings",
    "exchange",
    "advisor",
    "generic",
  ];

  it.each(allNames)("rend un SVG stroke=currentColor pour %s", (name) => {
    const { container } = render(<ServiceIcon name={name} data-testid="svc-svg" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("data-icon", name);
    expect(svg?.querySelectorAll("path, circle").length).toBeGreaterThan(0);
    // Aucun glyphe emoji : le contenu textuel est vide.
    expect(container.textContent).toBe("");
  });

  it("mappe via keyword quand name absent", () => {
    const { container } = render(<ServiceIcon keyword="Virement" />);
    expect(container.querySelector("svg")).toHaveAttribute("data-icon", "transfer");
  });

  it("retombe sur generic sans name ni keyword", () => {
    const { container } = render(<ServiceIcon />);
    expect(container.querySelector("svg")).toHaveAttribute("data-icon", "generic");
  });

  it("respecte la taille demandée", () => {
    const { container } = render(<ServiceIcon name="deposit" size={64} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "64");
    expect(svg).toHaveAttribute("height", "64");
  });
});

describe("UiIcons: icônes d'interface", () => {
  it.each([
    ["chevron", <ChevronIcon key="c" data-testid="ui" />],
    ["phone", <PhoneIcon key="p" data-testid="ui" />],
    ["accessibility", <AccessibilityIcon key="a" data-testid="ui" />],
  ])("%s rend un SVG stroke=currentColor sans emoji", (_label, element) => {
    const { container } = render(element);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(container.textContent).toBe("");
  });
});
