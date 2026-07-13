/**
 * Tests for ManagerDashboard (WEB-003).
 * @module components/manager/manager-dashboard.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ManagerDashboard, type ManagerDashboardProps } from "./manager-dashboard";
import { initialManagerState, type ManagerState, type DashboardKpis, type AgentRow } from "@/lib/manager-state";

const kpis: DashboardKpis = {
  tma: { value: 12, unit: "minutes" },
  tauxAbandon: { value: 4, unit: "percent" },
  tauxSLA: { value: 87, unit: "percent" },
  nps: 42,
};

const agents: AgentRow[] = [
  { counterId: "c1", label: "Guichet 1", agentName: "Koné A.", status: "OPEN", ticketNumber: "A047", alerted: false },
  { counterId: "c2", label: "Guichet 2", agentName: "Traoré K.", status: "PAUSED", ticketNumber: null, alerted: false },
];

function baseState(over: Partial<ManagerState> = {}): ManagerState {
  return { ...initialManagerState, kpis, slaMinutes: 15, agents, ...over };
}

function setup(over: Partial<ManagerDashboardProps> = {}) {
  const props: ManagerDashboardProps = {
    state: baseState(),
    load: "ready",
    tmaSeries: Array.from({ length: 24 }, (_, i) => i),
    tmaDeltaJ7: -2,
    onToggleCounter: vi.fn(),
    onAcknowledge: vi.fn(),
    ...over,
  };
  render(<ManagerDashboard {...props} />);
  return props;
}

describe("ManagerDashboard — TMA coloré vs SLA", () => {
  it("WEB-003: TMA à 40px (token kpi-value)", () => {
    setup();
    expect(screen.getByTestId("kpi-tma-value").getAttribute("style")).toContain("40px");
  });

  it("WEB-003: TMA sous le SLA (12/15 = 0.8) → --warning", () => {
    setup({ state: baseState({ kpis: { ...kpis, tma: { value: 12, unit: "minutes" } }, slaMinutes: 15 }) });
    expect(screen.getByTestId("kpi-tma-value").getAttribute("style")).toContain("var(--warning)");
  });

  it("WEB-003: TMA bien en deçà du SLA → --success", () => {
    setup({ state: baseState({ kpis: { ...kpis, tma: { value: 5, unit: "minutes" } }, slaMinutes: 15 }) });
    expect(screen.getByTestId("kpi-tma-value").getAttribute("style")).toContain("var(--success)");
  });

  it("WEB-003: TMA au-delà du SLA (18/15) → --danger (dépassement uniquement)", () => {
    setup({ state: baseState({ kpis: { ...kpis, tma: { value: 18, unit: "minutes" } }, slaMinutes: 15 }) });
    expect(screen.getByTestId("kpi-tma-value").getAttribute("style")).toContain("var(--danger)");
  });

  it("WEB-003: comparatif J-7 — delta affiché sous le TMA (amélioration ▼)", () => {
    setup({ tmaDeltaJ7: -2 });
    expect(screen.getByTestId("kpi-tma-delta")).toHaveTextContent("2");
    expect(screen.getByTestId("kpi-tma-delta")).toHaveTextContent("▼");
  });

  it("WEB-003: comparatif J-7 — dégradation affiche ▲", () => {
    setup({ tmaDeltaJ7: 3 });
    expect(screen.getByTestId("kpi-tma-delta")).toHaveTextContent("▲");
  });

  it("WEB-003: TMA non calculable (null) → tiret, pas de 0 trompeur", () => {
    setup({ state: baseState({ kpis: { ...kpis, tma: { value: null, unit: "minutes" } } }), tmaDeltaJ7: null });
    expect(screen.getByTestId("kpi-tma-value")).toHaveTextContent("—");
    expect(screen.queryByTestId("kpi-tma-delta")).not.toBeInTheDocument();
  });

  it("WEB-003: sparkline 24 points rendue sous le KPI", () => {
    setup();
    expect(screen.getByTestId("sparkline")).toHaveAttribute("data-points", "24");
  });
});

describe("ManagerDashboard — --danger réservé aux alertes", () => {
  it("WEB-003: sans dépassement ni alerte — aucun --danger décoratif", () => {
    setup({ state: baseState({ kpis: { ...kpis, tma: { value: 5, unit: "minutes" } }, slaMinutes: 15, alerts: [] }) });
    expect(screen.getByTestId("manager-dashboard").outerHTML).not.toContain("var(--danger)");
  });

  it("WEB-003: alert:manager SLA_BREACH → card --danger persistante", () => {
    setup({ state: baseState({ alerts: [{ id: "a1", type: "SLA_BREACH" }] }) });
    const card = screen.getByTestId("alert-card");
    expect(card).toHaveAttribute("role", "alert");
    expect(card.getAttribute("style")).toContain("var(--danger)");
  });

  it("WEB-003: acquittement — clic Acquitter appelle onAcknowledge", () => {
    const props = setup({ state: baseState({ alerts: [{ id: "a1", type: "SLA_BREACH" }] }) });
    fireEvent.click(screen.getByTestId("alert-ack"));
    expect(props.onAcknowledge).toHaveBeenCalledWith("a1");
  });

  it("WEB-003: AGENT_INACTIVE — ligne grille rouge + icône alerte", () => {
    const alertedAgents: AgentRow[] = [{ ...agents[0]!, alerted: true }];
    setup({ state: baseState({ agents: alertedAgents }) });
    const row = screen.getByTestId("agent-row");
    expect(row).toHaveAttribute("data-alerted", "on");
    expect(row.getAttribute("style")).toContain("var(--danger)");
    const alertIcon = screen.getByTestId("agent-alert-icon");
    expect(alertIcon).toBeInTheDocument();
    // ICONS-001 : icône alerte du set SIGFA, plus de glyphe unicode.
    expect(
      alertIcon.querySelector('svg[data-icon="alerte"]'),
    ).toBeInTheDocument();
    expect(alertIcon.textContent).not.toContain("⚠");
  });
});

describe("ManagerDashboard — grille & files", () => {
  it("WEB-003: queue:updated — file par service affichée", () => {
    setup({ state: baseState({ queues: [{ queueId: "13131313-1313-4131-a131-131313131313", length: 9, estimate: 900 }] }) });
    expect(screen.getByTestId("queue-row")).toHaveTextContent("9");
  });

  it("WEB-003: MANAGER — action inline OPEN/PAUSED → onToggleCounter", () => {
    const props = setup();
    const toggles = screen.getAllByTestId("agent-toggle");
    fireEvent.click(toggles[0]!);
    expect(props.onToggleCounter).toHaveBeenCalledWith("c1", "PAUSED");
  });
});

describe("ManagerDashboard — RBAC & 5 états", () => {
  it("WEB-003: RBAC AUDITOR — lecture seule, zéro bouton d'action dans le DOM", () => {
    setup({ readOnly: true, state: baseState({ alerts: [{ id: "a1", type: "SLA_BREACH" }] }) });
    expect(screen.queryByTestId("agent-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("alert-ack")).not.toBeInTheDocument();
  });

  it("WEB-003: état loading — skeleton sans flash blanc (surface tokenisée)", () => {
    setup({ load: "loading" });
    const sk = screen.getByTestId("manager-skeleton");
    expect(sk).toHaveAttribute("aria-busy", "true");
    expect(sk.getAttribute("style")).toContain("var(--surface-0)");
  });

  it("WEB-003: état empty — message contextuel, pas de 0 trompeur", () => {
    setup({ load: "empty", state: baseState({ kpis: null }) });
    expect(screen.getByTestId("manager-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("kpi-tma-value")).not.toBeInTheDocument();
  });

  it("ICONS-001: état empty — icône statistiques du set SIGFA, zéro emoji", () => {
    setup({ load: "empty", state: baseState({ kpis: null }) });
    const empty = screen.getByTestId("manager-empty");
    expect(
      empty.querySelector('svg[data-icon="statistiques"]'),
    ).toBeInTheDocument();
    expect(empty.textContent).not.toMatch(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
    );
  });

  it("WEB-003: état offline — badge Hors ligne + dernière sync", () => {
    setup({ offline: true, state: baseState({ lastSync: "14:37" }) });
    const badge = screen.getByTestId("manager-offline-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("14:37");
  });

  it("WEB-003: tokens uniquement — aucune couleur hexadécimale en dur", () => {
    setup();
    expect(screen.getByTestId("manager-dashboard").outerHTML).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
