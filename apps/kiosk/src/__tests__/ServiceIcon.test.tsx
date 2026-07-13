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
  isServiceIconName,
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
    // Catalogue borne BNI — nouvelles familles d'icônes.
    ["Demande de carte", "card"],
    ["Carte prépayée", "card"],
    ["Rechargement de carte prépayée", "card"],
    ["Retrait de carte/code", "card"],
    ["Demande de chéquier", "cheque"],
    ["Retrait chèque/effet", "cheque"],
    ["Remise chèque/effet", "cheque"],
    ["Demande de relevé", "statement"],
    ["Demande de relevé/solde", "statement"],
    ["Demande d'opposition carte/chèque", "opposition"],
    ["Paiement divers", "payment"],
    ["Souscription autre produit", "contract"],
    ["Dépôt de courriers", "mail"],
    ["Demande d'informations", "info"],
    ["Plan Épargne / PEE", "savings"],
    ["Transfert Orange Money", "transfer"],
    ["Réclamations", "complaint"],
    ["Ouverture de compte", "account"],
    ["Clôture de compte", "account"],
    ["Demande de crédit", "credit"],
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
    ["card", "card"],
    ["cheque", "cheque"],
    ["statement", "statement"],
    ["opposition", "opposition"],
    ["payment", "payment"],
    ["contract", "contract"],
    ["mail", "mail"],
    ["info", "info"],
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
    "card",
    "cheque",
    "statement",
    "opposition",
    "payment",
    "contract",
    "mail",
    "info",
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
