/**
 * Tests for NetAdminConsole (NET-001-WEB) — read-only cross-tenant console.
 *
 * Covers: the 5 states, the always-visible guarantee notice, zero-PII render,
 * NO mutation control in the DOM (read-only), per-bank aggregates + synthesis,
 * FR/EN, health badge tones, and zero emoji.
 * @module components/net-admin/net-admin-console.test
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NetAdminConsole } from "./net-admin-console";
import { emptyNetworkView, type NetworkOverviewView } from "@/lib/net-admin-allowlist";

const BANK_A = "11111111-1111-4111-a111-111111111111";
const BANK_B = "22222222-2222-4222-a222-222222222222";

function view(over: Partial<NetworkOverviewView> = {}): NetworkOverviewView {
  return {
    period: "2026-07",
    generatedAt: "2026-07-12T09:00:00Z",
    synthesis: {
      bankCount: 2,
      agencyCount: 40,
      totalTickets: 75330,
      kiosksOnline: 58,
      kiosksOffline: 8,
      mutedRatePercent: 12.1,
      openIncidents: 1,
    },
    banks: [
      { bankId: BANK_A, bankLabel: "Banque A", agencyCount: 24, kiosksOnline: 40, kiosksOffline: 2, totalTickets: 45230, uptimePercent: 99.4, health: "VERT" },
      { bankId: BANK_B, bankLabel: "Banque B", agencyCount: 16, kiosksOnline: 18, kiosksOffline: 6, totalTickets: 30100, uptimePercent: 91.2, health: "ROUGE" },
    ],
    ...over,
  };
}

/** Unicode emoji ranges — the design system bans emoji. */
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

describe("NET-001: NetAdminConsole — 5 états", () => {
  it("NET-001: état nominal (ready) — synthèse + vue par banque", () => {
    render(<NetAdminConsole view={view()} load="ready" />);
    expect(screen.getByTestId("net-admin-console")).toBeInTheDocument();
    expect(screen.getByTestId("net-admin-synthesis")).toBeInTheDocument();
    expect(screen.getByTestId("net-admin-banks")).toBeInTheDocument();
    expect(screen.getByTestId(`net-bank-row-${BANK_A}`)).toBeInTheDocument();
    expect(screen.getByTestId(`net-bank-row-${BANK_B}`)).toBeInTheDocument();
    // 6 tuiles de synthèse.
    expect(screen.getByTestId("net-synth-banks")).toHaveTextContent("2");
    expect(screen.getByTestId("net-synth-incidents")).toHaveTextContent("1");
  });

  it("NET-001: les grands chiffres de synthèse utilisent la primitive KpiTile", () => {
    render(<NetAdminConsole view={view()} load="ready" />);
    const banks = screen.getByTestId("net-synth-banks");
    // KpiTile = classe .sig-kpi (jamais une div stylée maison).
    expect(banks.className).toContain("sig-kpi");
    expect(banks.querySelector(".sig-kpi__value")).not.toBeNull();
    expect(banks.querySelector(".sig-kpi__value")).toHaveTextContent("2");
  });

  it("NET-001: état loading — skeleton", () => {
    render(<NetAdminConsole view={null} load="loading" />);
    expect(screen.getByTestId("net-admin-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("net-admin-skeleton")).toHaveAttribute("aria-busy", "true");
  });

  it("NET-001: état empty — aucune banque", () => {
    render(<NetAdminConsole view={emptyNetworkView("2026-07", "z")} load="empty" />);
    expect(screen.getByTestId("net-admin-empty")).toBeInTheDocument();
  });

  it("NET-001: état error — message humain", () => {
    render(<NetAdminConsole view={null} load="error" />);
    const err = screen.getByTestId("net-admin-error");
    expect(err).toHaveAttribute("role", "alert");
  });

  it("NET-001: état offline — bandeau + données figées visibles", () => {
    render(<NetAdminConsole view={view()} load="offline" />);
    expect(screen.getByTestId("net-admin-console")).toHaveAttribute("data-state", "offline");
    expect(screen.getByTestId("net-admin-offline-banner")).toBeInTheDocument();
    // Les agrégats restent visibles pendant l'offline.
    expect(screen.getByTestId("net-admin-banks")).toBeInTheDocument();
  });
});

describe("NET-001: garantie + lecture seule + zéro PII", () => {
  it("NET-001: mention de garantie « agrégat réseau — aucune donnée client » visible", () => {
    render(<NetAdminConsole view={view()} load="ready" />);
    const notices = screen.getAllByTestId("net-admin-guarantee");
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices[0]).toHaveTextContent(/aucune donnée client/i);
  });

  it("NET-001: garantie visible aussi en loading/empty/error/offline", () => {
    for (const load of ["loading", "empty", "error", "offline"] as const) {
      const v = load === "error" ? null : emptyNetworkView("2026-07", "z");
      const { unmount } = render(<NetAdminConsole view={load === "offline" ? view() : v} load={load} />);
      expect(screen.getAllByTestId("net-admin-guarantee").length).toBeGreaterThanOrEqual(1);
      unmount();
    }
  });

  it("NET-001: aucun élément de mutation dans le DOM (lecture seule)", () => {
    const { container } = render(<NetAdminConsole view={view()} load="ready" />);
    // Aucun contrôle d'écriture : ni bouton, ni champ, ni formulaire, ni select.
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("NET-001: aucune donnée client rendue (pas de téléphone/tracking/nom)", () => {
    const { container } = render(<NetAdminConsole view={view()} load="ready" />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\+225/);
    expect(text).not.toMatch(/trk_/i);
    expect(text).not.toMatch(/tracking/i);
  });
});

describe("NET-001: i18n FR/EN + santé + zéro emoji", () => {
  it("NET-001: rendu FR par défaut", () => {
    render(<NetAdminConsole view={view()} load="ready" />);
    expect(screen.getByText(/SUPERVISION RÉSEAU/)).toBeInTheDocument();
  });

  it("NET-001: rendu EN complet (locale en)", () => {
    render(<NetAdminConsole view={view()} load="ready" locale="en" />);
    expect(screen.getByText(/NETWORK SUPERVISION/)).toBeInTheDocument();
    expect(screen.getAllByTestId("net-admin-guarantee")[0]).toHaveTextContent(/no customer data/i);
  });

  it("NET-001: santé rendue en badge (VERT→success, ROUGE→danger, texte apparié)", () => {
    render(<NetAdminConsole view={view()} load="ready" />);
    const vert = screen.getByTestId(`net-bank-health-${BANK_A}`);
    const rouge = screen.getByTestId(`net-bank-health-${BANK_B}`);
    expect(vert.className).toContain("sig-badge--success");
    expect(rouge.className).toContain("sig-badge--danger");
    // danger = pastille + texte, jamais un fond plein (dot rendu).
    expect(rouge.querySelector(".sig-badge__dot")).not.toBeNull();
  });

  it("NET-001: zéro emoji dans le rendu", () => {
    const { container } = render(<NetAdminConsole view={view()} load="ready" locale="en" />);
    expect(EMOJI_RE.test(container.textContent ?? "")).toBe(false);
  });

  it("NET-001: uptime null → « — » et santé null → badge info N/A", () => {
    const v = view({
      banks: [
        { bankId: BANK_A, bankLabel: "Banque A", agencyCount: 5, kiosksOnline: 3, kiosksOffline: 1, totalTickets: 10, uptimePercent: null, health: null },
      ],
    });
    render(<NetAdminConsole view={v} load="ready" />);
    expect(screen.getByTestId(`net-bank-row-${BANK_A}`)).toHaveTextContent("—");
    const badge = screen.getByTestId(`net-bank-health-${BANK_A}`);
    expect(badge.className).toContain("sig-badge--info");
    expect(badge).toHaveTextContent(/N\/A/);
  });

  it("NET-001: santé ORANGE → badge warning", () => {
    const v = view({
      banks: [
        { bankId: BANK_A, bankLabel: "Banque A", agencyCount: 5, kiosksOnline: 3, kiosksOffline: 1, totalTickets: 10, uptimePercent: 88, health: "ORANGE" },
      ],
    });
    render(<NetAdminConsole view={v} load="ready" />);
    expect(screen.getByTestId(`net-bank-health-${BANK_A}`).className).toContain("sig-badge--warning");
  });

  it("NET-001: load=ready mais view sans banque → bascule sur l'état empty", () => {
    render(<NetAdminConsole view={emptyNetworkView("2026-07", "z")} load="ready" />);
    expect(screen.getByTestId("net-admin-empty")).toBeInTheDocument();
  });
});
