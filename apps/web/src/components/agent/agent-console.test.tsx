/**
 * Tests for AgentConsole (WEB-002).
 * @module components/agent/agent-console.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentConsole, type AgentConsoleProps } from "./agent-console";
import type { ServingTicket } from "@/lib/use-agent-flow";
import { t } from "@/lib/i18n";

const serving: ServingTicket = { id: "t1", number: "A047", startedAt: Date.now() };

function setup(overrides: Partial<AgentConsoleProps> = {}) {
  const props: AgentConsoleProps = {
    status: "serving",
    ticket: serving,
    transferOpen: false,
    onCallNext: vi.fn(),
    onFinish: vi.fn(),
    onOpenTransfer: vi.fn(),
    onSelectTransfer: vi.fn(),
    ...overrides,
  };
  render(<AgentConsole {...props} />);
  return props;
}

describe("AgentConsole — layout & tokens", () => {
  it("WEB-002: ticket en cours à 96px — token --kpi-value", () => {
    setup();
    const number = screen.getByTestId("agent-ticket-number");
    expect(number).toHaveTextContent("A047");
    expect(number.getAttribute("style")).toContain("var(--kpi-value)");
  });

  it("WEB-002: APPELER pleine largeur, --brand, 88px de hauteur", () => {
    setup();
    const style = screen.getByTestId("agent-call-next").getAttribute("style") ?? "";
    expect(style).toContain("var(--brand)");
    expect(style).toContain("88px");
    expect(style).toContain("width: 100%");
  });

  it("WEB-002: tokens uniquement — aucune couleur hexadécimale en dur", () => {
    setup();
    const console = screen.getByTestId("agent-console");
    expect(console.outerHTML).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe("AgentConsole — 3 boutons ordre fixe", () => {
  it("WEB-002: 3 boutons rendus dans l'ordre APPELER → TERMINER → TRANSFÉRER (SERVING)", () => {
    setup({ status: "serving", ticket: serving });
    const actions = screen.getByTestId("agent-actions");
    const buttons = Array.from(actions.querySelectorAll("button")).map((b) => b.getAttribute("data-testid"));
    expect(buttons).toEqual(["agent-call-next", "agent-finish", "agent-transfer"]);
  });

  it("WEB-002: TERMINER et TRANSFÉRER cachés hors état SERVING", () => {
    setup({ status: "idle", ticket: null });
    expect(screen.getByTestId("agent-call-next")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-finish")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-transfer")).not.toBeInTheDocument();
  });
});

describe("AgentConsole — interactions", () => {
  it("WEB-002: touche Espace déclenche APPELER", () => {
    const props = setup({ status: "idle", ticket: null });
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(props.onCallNext).toHaveBeenCalledTimes(1);
  });

  it("WEB-002: clic APPELER déclenche le handler", () => {
    const props = setup({ status: "idle", ticket: null });
    fireEvent.click(screen.getByTestId("agent-call-next"));
    expect(props.onCallNext).toHaveBeenCalled();
  });

  it("WEB-002: clic TERMINER déclenche onFinish (SERVING)", () => {
    const props = setup();
    fireEvent.click(screen.getByTestId("agent-finish"));
    expect(props.onFinish).toHaveBeenCalled();
  });

  it("WEB-002: TRANSFÉRER → sélecteur inline (zéro modale)", () => {
    setup({ transferOpen: true, transferOptions: [{ id: "c4", label: "Guichet 4" }] });
    const selector = screen.getByTestId("agent-transfer-selector");
    expect(selector).toBeInTheDocument();
    // aucune modale : pas de role dialog
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-transfer-option")).toHaveTextContent("Guichet 4");
  });

  it("WEB-002: choix d'une destination appelle onSelectTransfer", () => {
    const props = setup({ transferOpen: true, transferOptions: [{ id: "c4", label: "Guichet 4" }] });
    fireEvent.click(screen.getByTestId("agent-transfer-option"));
    expect(props.onSelectTransfer).toHaveBeenCalledWith({ id: "c4", label: "Guichet 4" });
  });
});

describe("AgentConsole — 5 états", () => {
  it("WEB-002: état loading → bouton disabled + spinner", () => {
    setup({ status: "loading", ticket: null });
    const btn = screen.getByTestId("agent-call-next");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("agent-spinner")).toBeInTheDocument();
  });

  it("WEB-002: espace n'appelle pas pendant loading", () => {
    const props = setup({ status: "loading", ticket: null });
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(props.onCallNext).not.toHaveBeenCalled();
  });

  it("WEB-002: état empty → 'Aucun client en attente', pas d'alerte (message neutre)", () => {
    setup({ status: "empty", ticket: null, message: "agent.queue_empty" });
    expect(screen.getByTestId("agent-message")).toHaveTextContent(t("agent.queue_empty", "fr"));
    expect(screen.getByTestId("agent-message")).toHaveAttribute("role", "status");
  });

  it("WEB-002: état error → message humain sans code d'erreur", () => {
    setup({ status: "error", ticket: null, message: "agent.error" });
    const msg = screen.getByTestId("agent-message");
    expect(msg).toHaveTextContent(t("agent.error", "fr"));
    expect(msg.textContent).not.toMatch(/\b[45]\d{2}\b/);
  });

  it("WEB-002: état offline → bandeau + chrono continue + actions maintenues", () => {
    setup({ status: "serving", ticket: serving, offline: true });
    expect(screen.getByTestId("agent-offline-banner")).toBeInTheDocument();
    // actions maintenues
    expect(screen.getByTestId("agent-call-next")).not.toBeDisabled();
    expect(screen.getByTestId("agent-chrono")).toBeInTheDocument();
  });
});
