/**
 * Tests du set d'icônes SIGFA duotone (ICONS-001).
 *
 * Spécification :
 * - grille 24×24, deux couches (`duo` fond currentColor opacité ~0.2, `line`
 *   trait currentColor 2px arrondi) — AUCUNE couleur en dur ;
 * - un composant par icône + composant générique `<SigfaIcon name=… />` ;
 * - `aria-hidden` par défaut (icône + texte appariés), `title` optionnel ;
 * - tailles par alias sm/md/lg/xl (16/24/32/48) ou nombre libre ;
 * - mapping complet métier banque + UI, zéro emoji dans les sources.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SigfaIcon,
  ICON_NAMES,
  DUO_OPACITY,
  type IconName,
} from "./SigfaIcon";
import * as Icons from "./icons";

/** Icônes MÉTIER exigées par la story (banque / file d'attente). */
const BUSINESS_NAMES: IconName[] = [
  "ticket",
  "guichet",
  "file-attente",
  "conseiller",
  "depot",
  "retrait",
  "virement",
  "change-devises",
  "credit",
  "epargne",
  "compte",
  "carte-bancaire",
  "chequier",
  "entreprise",
  "international",
];

/** Icônes UI exigées par la story. */
const UI_NAMES: IconName[] = [
  "imprimer",
  "audio",
  "langue",
  "accessibilite",
  "hors-ligne",
  "valider",
  "retour",
  "information",
  "alerte",
  "horloge",
  "statistiques",
  "parametres",
  // Complément du set (GO PO 2026-07) : dicter, navigation, CTA SMS.
  "micro",
  "chevron",
  "telephone",
];

describe("ICONS-001: registre du set", () => {
  it("contient toutes les icônes métier banque/file d'attente", () => {
    for (const name of BUSINESS_NAMES) {
      expect(ICON_NAMES, `icône métier manquante: ${name}`).toContain(name);
    }
  });

  it("contient toutes les icônes UI", () => {
    for (const name of UI_NAMES) {
      expect(ICON_NAMES, `icône UI manquante: ${name}`).toContain(name);
    }
  });

  it("expose un composant React par icône (name-mapping complet)", () => {
    const exported = Object.keys(Icons).filter((k) => k.startsWith("Icon"));
    expect(exported).toHaveLength(ICON_NAMES.length);
    // Chaque nom du registre a son composant dédié qui rend la même icône.
    for (const name of ICON_NAMES) {
      const pascal = `Icon${name
        .split("-")
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join("")}`;
      const Component = Icons[pascal as keyof typeof Icons];
      expect(Component, `composant manquant: ${pascal}`).toBeTypeOf(
        "function",
      );
      const { container, unmount } = render(
        <Component data-testid={`icon-${name}`} />,
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("data-icon")).toBe(name);
      unmount();
    }
  });
});

describe("ICONS-001: rendu SVG duotone", () => {
  it("rend chaque icône en 24×24 avec les deux couches duotone", () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<SigfaIcon name={name} />);
      const svg = container.querySelector("svg");
      expect(svg, `svg absent pour ${name}`).not.toBeNull();
      expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");

      const duo = svg?.querySelector('[data-layer="duo"]');
      const line = svg?.querySelector('[data-layer="line"]');
      expect(duo, `couche duo absente pour ${name}`).not.toBeNull();
      expect(line, `couche trait absente pour ${name}`).not.toBeNull();
      expect(duo?.getAttribute("fill")).toBe("currentColor");
      expect(Number(duo?.getAttribute("opacity"))).toBeCloseTo(DUO_OPACITY);
      expect(line?.getAttribute("stroke")).toBe("currentColor");
      expect(line?.getAttribute("stroke-width")).toBe("2");
      expect(line?.getAttribute("stroke-linecap")).toBe("round");
      expect(line?.getAttribute("stroke-linejoin")).toBe("round");
      // Les deux couches dessinent réellement quelque chose.
      expect(duo?.children.length, `duo vide pour ${name}`).toBeGreaterThan(0);
      expect(line?.children.length, `trait vide pour ${name}`).toBeGreaterThan(
        0,
      );
      unmount();
    }
  });

  it("n'utilise QUE currentColor/none — aucune couleur littérale dans le DOM", () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<SigfaIcon name={name} />);
      const nodes = container.querySelectorAll("svg, svg *");
      for (const node of nodes) {
        for (const attr of ["fill", "stroke"]) {
          const value = node.getAttribute(attr);
          if (value != null) {
            expect(
              ["currentColor", "none"],
              `${name}: ${node.tagName} a ${attr}="${value}"`,
            ).toContain(value);
          }
        }
      }
      unmount();
    }
  });

  it("aucune couleur en dur dans les sources du set (fill/stroke littéraux)", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const sources = fs
      .readdirSync(dir)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      const literals = text.match(
        /(?:fill|stroke)\s*[=:]\s*["'](?!currentColor|none)[^"']+["']/g,
      );
      expect(literals, `${file}: ${String(literals)}`).toBeNull();
      expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});

describe("ICONS-002: complément micro / chevron / telephone", () => {
  it.each(["micro", "chevron", "telephone"] as const)(
    "%s est rendue par le set duotone avec composant dédié",
    (name) => {
      const pascal = `Icon${name.charAt(0).toUpperCase()}${name.slice(1)}`;
      const Component = Icons[pascal as keyof typeof Icons];
      expect(Component, `composant manquant: ${pascal}`).toBeTypeOf("function");
      const { container } = render(<SigfaIcon name={name} />);
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("data-icon")).toBe(name);
      expect(svg?.querySelector('[data-layer="duo"]')).not.toBeNull();
      expect(svg?.querySelector('[data-layer="line"]')).not.toBeNull();
    },
  );

  it("chevron pointe à droite — la rotation reste au consommateur (style)", () => {
    const { container } = render(
      <SigfaIcon name="chevron" style={{ transform: "rotate(90deg)" }} />,
    );
    const svg = container.querySelector("svg");
    // Une seule icône directionnelle : le consommateur tourne via transform.
    expect(svg?.style.transform).toBe("rotate(90deg)");
  });
});

describe("ICONS-001: accessibilité", () => {
  it("est aria-hidden par défaut (le texte apparié porte le sens)", () => {
    const { container } = render(<SigfaIcon name="ticket" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("focusable")).toBe("false");
    expect(svg?.hasAttribute("role")).toBe(false);
  });

  it("avec title: role img + <title>, plus d'aria-hidden", () => {
    const { container } = render(
      <SigfaIcon name="imprimer" title="Imprimer le ticket" />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.hasAttribute("aria-hidden")).toBe(false);
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.querySelector("title")?.textContent).toBe(
      "Imprimer le ticket",
    );
  });
});

describe("ICONS-001: tailles", () => {
  it.each([
    ["sm", 16],
    ["md", 24],
    ["lg", 32],
    ["xl", 48],
  ] as const)("alias %s → %ipx", (alias, px) => {
    const { container } = render(<SigfaIcon name="guichet" size={alias} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe(String(px));
    expect(svg?.getAttribute("height")).toBe(String(px));
  });

  it("taille md par défaut, nombre libre accepté", () => {
    const { container } = render(<SigfaIcon name="guichet" />);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("24");
    const { container: custom } = render(
      <SigfaIcon name="guichet" size={40} />,
    );
    expect(custom.querySelector("svg")?.getAttribute("width")).toBe("40");
  });

  it("propage className et props SVG (composition)", () => {
    render(
      <SigfaIcon
        name="alerte"
        className="kpi-icon"
        data-testid="alert-icon"
      />,
    );
    expect(screen.getByTestId("alert-icon")).toHaveClass("kpi-icon");
  });
});
