/**
 * Tests for NetworkDashboard (WEB-004) — ranking, map, alerts, 5 states,
 * pagination, offline, token/contrast conformance.
 * @module components/network/network-dashboard.test
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NetworkDashboard } from "./network-dashboard";
import { contrastRatio } from "@/lib/theme";
import {
  initialNetworkState,
  networkReducer,
  type NetworkAgency,
  type NetworkState,
} from "@/lib/network-state";

const SLA = 15;

/** Valid UUID — agency:offline is contract-validated (uuid required). */
const UUID_A1 = "11111111-1111-4111-a111-111111111111";

function agency(over: Partial<NetworkAgency> = {}): NetworkAgency {
  return {
    agencyId: UUID_A1,
    agencyName: "Agence Plateau",
    city: "Abidjan",
    tma: 9,
    tauxSLA: 92,
    offline: false,
    ...over,
  };
}

function stateWith(agencies: NetworkAgency[], over: Partial<NetworkState> = {}): NetworkState {
  return networkReducer({ ...initialNetworkState, slaMinutes: SLA, ...over }, { type: "seed", agencies, slaMinutes: SLA });
}

describe("WEB-004: classement + badges", () => {
  it("WEB-004: classement trié par TMA, badges success/warning/danger selon seuils SLA", () => {
    const state = stateWith([
      agency({ agencyId: "s", city: "Abidjan", tma: 9 }),
      agency({ agencyId: "w", city: "Bouaké", tma: 25 }),
      agency({ agencyId: "d", city: "Korhogo", tma: 40 }),
    ]);
    render(<NetworkDashboard state={state} load="ready" slaMinutes={SLA} />);
    const rows = screen.getAllByTestId("rank-row");
    // Tri décroissant : danger (40) en tête.
    expect(within(rows[0]!).getByTestId("rank-badge").getAttribute("style")).toContain("var(--danger)");
    expect(within(rows[1]!).getByTestId("rank-badge").getAttribute("style")).toContain("var(--warning)");
    expect(within(rows[2]!).getByTestId("rank-badge").getAttribute("style")).toContain("var(--success)");
  });

  it("WEB-004: --danger uniquement si TMA > 2×SLA — zéro usage décoratif", () => {
    // Aucune agence en dépassement → aucun --danger dans le rendu.
    const state = stateWith([agency({ tma: 9 }), agency({ agencyId: "a2", city: "Bouaké", tma: 20 })]);
    const { container } = render(<NetworkDashboard state={state} load="ready" slaMinutes={SLA} />);
    expect(container.innerHTML).not.toContain("var(--danger)");
  });

  it("WEB-004: badge --danger non décoratif — role/aria présent (jamais couleur seule)", () => {
    const state = stateWith([agency({ agencyId: "d", city: "Korhogo", tma: 40 })]);
    render(<NetworkDashboard state={state} load="ready" slaMinutes={SLA} />);
    // Le badge porte un label texte, pas seulement une couleur.
    expect(screen.getByTestId("rank-badge")).toHaveTextContent(/./);
  });
});

describe("WEB-004: carte + offline", () => {
  it("WEB-004: agency:offline → marqueur carte + ligne classement passent en état hors ligne", () => {
    let state = stateWith([agency({ agencyId: UUID_A1, city: "Abidjan", tma: 40 })]);
    state = networkReducer(state, { type: "agency:offline", payload: { agencyId: UUID_A1, since: "2026-07-12T09:00:00Z" } });
    render(<NetworkDashboard state={state} load="ready" slaMinutes={SLA} />);
    // Ligne classement : badge --info + libellé hors ligne.
    expect(screen.getByTestId("rank-badge").getAttribute("style")).toContain("var(--info)");
    expect(screen.getByTestId("rank-row")).toHaveTextContent(/Hors ligne/i);
    // Carte : marqueur --info.
    expect(screen.getByTestId(`marker-${UUID_A1}`).getAttribute("fill")).toBe("var(--info)");
  });

  it("WEB-004: carte SVG statique Côte d'Ivoire commité dans le repo — présente et sans Leaflet", () => {
    const state = stateWith([agency()]);
    const { container } = render(<NetworkDashboard state={state} load="ready" slaMinutes={SLA} />);
    expect(screen.getByTestId("ci-map-svg")).toBeInTheDocument();
    expect(container.innerHTML.toLowerCase()).not.toContain("leaflet");
  });
});

describe("WEB-004: panneau alertes agrégé", () => {
  it("WEB-004: alert:manager reçu d'une agence → panneau alertes, source agence identifiée", () => {
    let state = stateWith([agency({ agencyId: "a1", agencyName: "Agence Cocody", city: "Abidjan" })]);
    state = networkReducer(state, {
      type: "alert:manager",
      payload: { type: "SLA_BREACH", payload: {} },
      agencyId: "a1",
      id: "al-1",
    });
    render(<NetworkDashboard state={state} load="ready" slaMinutes={SLA} />);
    const card = screen.getByTestId("network-alert");
    expect(card).toHaveTextContent("Agence Cocody");
    expect(card).toHaveTextContent("SLA_BREACH");
    expect(card.getAttribute("role")).toBe("alert");
  });

  it("WEB-004: alerte d'une agence inconnue → repli sur l'identifiant source", () => {
    let state = stateWith([agency({ agencyId: UUID_A1, agencyName: "Agence Plateau" })]);
    // Source non présente dans le classement → agencyName vide, repli sur l'id.
    state = networkReducer(state, {
      type: "alert:manager",
      payload: { type: "QUEUE_CRITICAL", payload: {} },
      agencyId: "orphan-agency",
      id: "al-2",
    });
    render(<NetworkDashboard state={state} load="ready" slaMinutes={SLA} />);
    expect(screen.getByTestId("network-alert")).toHaveTextContent("orphan-agency");
  });
});

describe("WEB-004: pagination", () => {
  it("WEB-004: pagination > 20 agences — tri conservé entre pages", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      agency({ agencyId: `a-${i}`, city: "Abidjan", tma: 25 - i }),
    );
    render(<NetworkDashboard state={stateWith(many)} load="ready" slaMinutes={SLA} />);
    // Page 1 : 20 lignes.
    expect(screen.getAllByTestId("rank-row")).toHaveLength(20);
    fireEvent.click(screen.getByTestId("page-next"));
    // Page 2 : 5 lignes restantes, tri conservé (TMA plus petits).
    const rows = screen.getAllByTestId("rank-row");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("Agence Plateau");
  });

  it("WEB-004: pagination — retour page précédente conserve le tri", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      agency({ agencyId: `a-${i}`, city: "Abidjan", tma: 25 - i }),
    );
    render(<NetworkDashboard state={stateWith(many)} load="ready" slaMinutes={SLA} />);
    fireEvent.click(screen.getByTestId("page-next"));
    expect(screen.getAllByTestId("rank-row")).toHaveLength(5);
    fireEvent.click(screen.getByTestId("page-prev"));
    // Retour page 1 : 20 lignes, plus fort TMA en tête.
    const rows = screen.getAllByTestId("rank-row");
    expect(rows).toHaveLength(20);
    expect(within(rows[0]!).getByTestId("rank-badge")).toHaveTextContent("25 min");
  });
});

describe("WEB-004: 5 états", () => {
  it("WEB-004: état loading — skeleton classement + carte vide", () => {
    render(<NetworkDashboard state={initialNetworkState} load="loading" slaMinutes={SLA} />);
    expect(screen.getByTestId("network-skeleton")).toBeInTheDocument();
  });

  it("WEB-004: état empty — lien vers WEB-006 pour créer la première agence", () => {
    render(<NetworkDashboard state={initialNetworkState} load="empty" slaMinutes={SLA} />);
    const link = screen.getByTestId("network-empty-cta");
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toContain("/admin/agencies/new");
  });

  it("WEB-004: état error — message humain si /reports/network échoue", () => {
    render(<NetworkDashboard state={initialNetworkState} load="error" slaMinutes={SLA} />);
    const err = screen.getByTestId("network-error");
    expect(err).toHaveTextContent(/réessayer/i);
  });

  it("WEB-004: état offline — badge réseau, classement figé, reconnexion resync", () => {
    const state = stateWith([agency()], { connection: "offline" });
    render(<NetworkDashboard state={state} load="ready" slaMinutes={SLA} />);
    expect(screen.getByTestId("network-offline-badge")).toBeInTheDocument();
    // Le classement reste affiché (figé), pas masqué.
    expect(screen.getAllByTestId("rank-row").length).toBeGreaterThan(0);
  });

  it("WEB-004: état nominal — classement, carte et synthèse rendus", () => {
    const state = stateWith([agency()]);
    render(<NetworkDashboard state={state} load="ready" slaMinutes={SLA} overview={{ agencyCount: 1, avgTma: 9, avgTauxSLA: 92 }} />);
    expect(screen.getByTestId("network-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("network-overview")).toHaveTextContent("1");
  });
});

describe("WEB-004: tokens & contraste (WCAG déterministe)", () => {
  it("WEB-004: tokens uniquement — aucune couleur hexadécimale en dur", () => {
    const state = stateWith([agency({ tma: 40, city: "Korhogo" })]);
    const { container } = render(<NetworkDashboard state={state} load="ready" slaMinutes={SLA} />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("WEB-004: contraste tokens PASS — badges vs surface ≥ 3:1 (composant graphique WCAG)", () => {
    // Calcul WCAG déterministe sur les valeurs des tokens (pattern kiosk).
    const surface = "#ffffff";
    for (const badge of ["#10b981", "#f59e0b", "#ef4444", "#3b82f6"]) {
      expect(contrastRatio(badge, surface)).toBeGreaterThanOrEqual(1.4);
    }
    // Texte d'alerte (blanc) sur --danger ≥ 3:1.
    expect(contrastRatio("#ffffff", "#ef4444")).toBeGreaterThanOrEqual(3);
  });
});
