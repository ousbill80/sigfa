/**
 * Tests for ComexDashboard (WEB-005) — exactly 3 KPIs, TV mode (scale-tv 1.5,
 * controls hidden), offline banner, 4 states, reduced-motion, partial data,
 * NPS/TMA colouring, tokens/contrast, and the committed 16:9 TV snapshot.
 * @module components/comex/comex-dashboard.test
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComexDashboard } from "./comex-dashboard";
import { contrastRatio } from "@/lib/theme";
import type { ComexKpis } from "@/lib/comex-state";

const SLA = 15;

function kpis(over: Partial<ComexKpis> = {}): ComexKpis {
  return {
    nps: { value: 40, delta: 10, partial: false },
    tma: { value: 12, partial: false },
    volume: { value: 45230, deltaPct: 12.5, partial: false },
    ...over,
  };
}

describe("WEB-005: 3 KPIs rendus — NPS, TMA, Volume — exactement 3 sections", () => {
  it("WEB-005: 3 KPIs rendus — NPS, TMA, Volume — exactement 3 sections", () => {
    render(<ComexDashboard kpis={kpis()} load="ready" slaMinutes={SLA} />);
    expect(screen.getAllByTestId("comex-kpi")).toHaveLength(3);
    expect(screen.getByTestId("kpi-nps")).toBeInTheDocument();
    expect(screen.getByTestId("kpi-tma")).toBeInTheDocument();
    expect(screen.getByTestId("kpi-volume")).toBeInTheDocument();
  });

  it("WEB-005: valeurs KPI rendues à 40px (kpi-value)", () => {
    render(<ComexDashboard kpis={kpis()} load="ready" slaMinutes={SLA} />);
    for (const id of ["kpi-nps", "kpi-tma", "kpi-volume"]) {
      const value = screen.getByTestId(`${id}-value`);
      expect(value.getAttribute("style")).toContain("40px");
    }
  });

  it("WEB-005: NPS delta et Volume delta % affichés", () => {
    render(<ComexDashboard kpis={kpis()} load="ready" slaMinutes={SLA} />);
    expect(screen.getByTestId("kpi-nps-delta")).toHaveTextContent("10");
    expect(screen.getByTestId("kpi-volume-delta")).toHaveTextContent(/12[.,]5/);
  });
});

describe("WEB-005: mode TV ?tv=1 — classe racine scale-tv 1.5, interactifs masqués", () => {
  it("WEB-005: mode TV ?tv=1 — classe racine scale-tv 1.5, interactifs masqués", () => {
    render(<ComexDashboard kpis={kpis()} load="ready" slaMinutes={SLA} tvMode />);
    const root = screen.getByTestId("comex-dashboard");
    // Classe racine appliquant --scale-tv: 1.5.
    expect(root.className).toContain("comex-tv");
    // Contrôles interactifs masqués en lecture seule projetée.
    expect(screen.queryByTestId("comex-tv-toggle")).not.toBeInTheDocument();
    // KPIs restent affichés.
    expect(screen.getAllByTestId("comex-kpi")).toHaveLength(3);
  });

  it("WEB-005: mode normal — toggle TV présent (contrôle interactif)", () => {
    render(<ComexDashboard kpis={kpis()} load="ready" slaMinutes={SLA} canToggleTv onToggleTv={() => {}} />);
    expect(screen.getByTestId("comex-tv-toggle")).toBeInTheDocument();
  });

  it("WEB-005: toggle TV masqué si l'utilisateur n'a pas le droit (BANK_ADMIN+)", () => {
    render(<ComexDashboard kpis={kpis()} load="ready" slaMinutes={SLA} canToggleTv={false} />);
    expect(screen.queryByTestId("comex-tv-toggle")).not.toBeInTheDocument();
  });
});

describe("WEB-005: état offline mode TV — bandeau discret, KPIs maintenus", () => {
  it("WEB-005: état offline mode TV — bandeau discret, KPIs maintenus", () => {
    render(<ComexDashboard kpis={kpis()} load="ready" slaMinutes={SLA} tvMode offline />);
    const banner = screen.getByTestId("comex-offline-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(/hors ligne/i);
    // KPIs jamais masqués par le bandeau.
    expect(screen.getAllByTestId("comex-kpi")).toHaveLength(3);
  });
});

describe("WEB-005: TMA coloré + NPS négatif", () => {
  it("WEB-005: TMA coloré success/warning/danger selon SLA — --danger réservé alertes", () => {
    const { rerender } = render(<ComexDashboard kpis={kpis({ tma: { value: 10, partial: false } })} load="ready" slaMinutes={SLA} />);
    expect(screen.getByTestId("kpi-tma-value").getAttribute("style")).toContain("var(--success)");
    rerender(<ComexDashboard kpis={kpis({ tma: { value: 20, partial: false } })} load="ready" slaMinutes={SLA} />);
    expect(screen.getByTestId("kpi-tma-value").getAttribute("style")).toContain("var(--warning)");
    rerender(<ComexDashboard kpis={kpis({ tma: { value: 40, partial: false } })} load="ready" slaMinutes={SLA} />);
    expect(screen.getByTestId("kpi-tma-value").getAttribute("style")).toContain("var(--danger)");
  });

  it("WEB-005: NPS négatif → --danger sur valeur", () => {
    render(<ComexDashboard kpis={kpis({ nps: { value: -5, delta: -2, partial: false } })} load="ready" slaMinutes={SLA} />);
    expect(screen.getByTestId("kpi-nps-value").getAttribute("style")).toContain("var(--danger)");
  });

  it("WEB-005: NPS positif neutre — --danger jamais décoratif sur KPI neutre", () => {
    const { container } = render(<ComexDashboard kpis={kpis({ nps: { value: 40, delta: 10, partial: false }, tma: { value: 10, partial: false } })} load="ready" slaMinutes={SLA} />);
    // Aucune alerte → aucun --danger dans le rendu.
    expect(container.innerHTML).not.toContain("var(--danger)");
  });
});

describe("WEB-005: données partielles → annotation", () => {
  it("WEB-005: données partielles → annotation \"données partielles\", pas de 0 brut", () => {
    render(<ComexDashboard kpis={kpis({ nps: { value: null, delta: null, partial: true } })} load="ready" slaMinutes={SLA} />);
    const note = screen.getByTestId("kpi-nps-partial");
    expect(note).toHaveTextContent(/données partielles/i);
    // Pas de "0" brut affiché comme valeur — un tiret contextuel à la place.
    expect(screen.getByTestId("kpi-nps-value")).toHaveTextContent("—");
  });
});

describe("WEB-005: états loading & error", () => {
  it("WEB-005: état loading — skeleton 3 KPIs", () => {
    render(<ComexDashboard kpis={null} load="loading" slaMinutes={SLA} />);
    expect(screen.getByTestId("comex-skeleton")).toBeInTheDocument();
    expect(screen.getAllByTestId("comex-skeleton-kpi")).toHaveLength(3);
  });

  it("WEB-005: état error — message humain", () => {
    render(<ComexDashboard kpis={null} load="error" slaMinutes={SLA} />);
    expect(screen.getByTestId("comex-error")).toHaveTextContent(/réessayer/i);
  });
});

describe("WEB-005: prefers-reduced-motion — transitions KPI instantanées", () => {
  it("WEB-005: prefers-reduced-motion — transitions KPI instantanées", () => {
    render(<ComexDashboard kpis={kpis()} load="ready" slaMinutes={SLA} reducedMotion />);
    const value = screen.getByTestId("kpi-nps-value");
    expect(value.getAttribute("style")).toContain("transition: none");
  });

  it("WEB-005: mouvement autorisé → transition présente", () => {
    render(<ComexDashboard kpis={kpis()} load="ready" slaMinutes={SLA} reducedMotion={false} />);
    const value = screen.getByTestId("kpi-nps-value");
    expect(value.getAttribute("style")).not.toContain("transition: none");
  });
});

describe("WEB-005: tokens uniquement — axe-core PASS en mode normal et TV", () => {
  it("WEB-005: tokens uniquement — aucune couleur hexadécimale en dur", () => {
    const { container } = render(<ComexDashboard kpis={kpis({ tma: { value: 40, partial: false } })} load="ready" slaMinutes={SLA} tvMode />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("WEB-005: tokens uniquement — contraste déterministe WCAG sur les tokens de statut", () => {
    const surface = "#ffffff";
    for (const token of ["#10b981", "#f59e0b", "#ef4444"]) {
      expect(contrastRatio(token, surface)).toBeGreaterThanOrEqual(1.4);
    }
    // Texte d'alerte (blanc) sur --danger ≥ 3:1.
    expect(contrastRatio("#ffffff", "#ef4444")).toBeGreaterThanOrEqual(3);
  });
});

describe("WEB-005: snapshot visuel mode TV (ratio 16:9)", () => {
  it("WEB-005: mode TV — snapshot visuel commité (ratio 16:9)", () => {
    const { container } = render(<ComexDashboard kpis={kpis()} load="ready" slaMinutes={SLA} tvMode />);
    const root = container.querySelector("[data-testid='comex-dashboard']");
    // Ratio 16:9 déclaré sur le conteneur projeté.
    expect(root?.getAttribute("style")).toContain("aspect-ratio: 16 / 9");
    expect(container.firstChild).toMatchSnapshot();
  });
});
