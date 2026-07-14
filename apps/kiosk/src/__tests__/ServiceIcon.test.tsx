/**
 * Tests du jeu d'icônes des services (migration ICONS-001 — set SIGFA duotone).
 * Couvre le mapping par mot-clé (FR/EN), le fallback générique et le rendu
 * délégué à `SigfaIcon` (@sigfa/ui) avec API et `data-icon` conservés.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  ServiceIcon,
  resolveServiceIcon,
  isServiceIconName,
  type ServiceIconName,
} from "@/components/icons/ServiceIcon";
import {
  AccessibilityIcon,
  ChevronIcon,
  OperationIcon,
  PersonIcon,
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

describe("MODEL-KIOSK-A: iconKey contrat honoré tel quel (opérations)", () => {
  it.each<[string, ServiceIconName]>([
    ["deposit", "deposit"],
    ["credit", "credit"],
    ["transfer", "transfer"],
    ["generic", "generic"],
  ])("iconKey %s → %s (clé exacte du jeu)", (iconKey, expected) => {
    expect(isServiceIconName(iconKey)).toBe(true);
    expect(resolveServiceIcon(iconKey)).toBe(expected);
  });

  it("iconKey inconnu retombe sur le mapping mot-clé puis generic", () => {
    expect(isServiceIconName("cash")).toBe(false);
    // "cash" n'est pas une clé du jeu mais est un mot-clé mappé (withdrawal).
    expect(resolveServiceIcon("cash")).toBe("withdrawal");
    expect(resolveServiceIcon("xyz-unknown")).toBe("generic");
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

  it.each(allNames)("rend l'icône SIGFA duotone pour %s", (name) => {
    const { container } = render(<ServiceIcon name={name} data-testid="svc-svg" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("stroke", "currentColor");
    // L'API historique est conservée : data-icon = clé métier du jeu.
    expect(svg).toHaveAttribute("data-icon", name);
    // ICONS-001 : rendu délégué au set SIGFA — deux couches duotone.
    expect(svg?.querySelector("[data-layer='duo']")).toBeInTheDocument();
    expect(svg?.querySelector("[data-layer='line']")).toBeInTheDocument();
    expect(svg?.querySelectorAll("path, circle, rect").length).toBeGreaterThan(0);
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
    ["person", <PersonIcon key="pe" data-testid="ui" />],
    ["operation", <OperationIcon key="o" data-testid="ui" />],
  ])("%s rend un SVG stroke=currentColor sans emoji", (_label, element) => {
    const { container } = render(element);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(container.textContent).toBe("");
  });

  it.each([
    ["accessibility", <AccessibilityIcon key="a" />, "accessibilite"],
    ["person", <PersonIcon key="pe" />, "conseiller"],
    ["operation", <OperationIcon key="o" />, "guichet"],
    // ICONS-002 : chevron et téléphone rejoignent le set SIGFA duotone.
    ["chevron", <ChevronIcon key="c" />, "chevron"],
    ["phone", <PhoneIcon key="p" />, "telephone"],
  ])(
    "ICONS-001: %s est rendue par le set SIGFA duotone",
    (_label, element, sigfaName) => {
      const { container } = render(element);
      const svg = container.querySelector("svg");
      expect(svg).toHaveAttribute("data-icon", sigfaName);
      expect(svg?.querySelector("[data-layer='duo']")).toBeInTheDocument();
      expect(svg?.querySelector("[data-layer='line']")).toBeInTheDocument();
    },
  );
});
