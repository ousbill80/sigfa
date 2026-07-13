/**
 * Tests for ReportsDashboard (REP-003b) — RBAC gating (export hidden for
 * AGENT/MANAGER), composition of export panel + benchmark table, FR/EN.
 * @module components/reports/reports-dashboard.test
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { createSigfaClient } from "@sigfa/contracts";
import { ReportsDashboard, type ReportsDashboardProps } from "./reports-dashboard";
import type { Role } from "@/lib/roles";

const BASE = "http://localhost:4010";
const BANK_ID = "bank-ci-001";
const AGENCY_ID = "33333333-3333-4333-a333-333333333333";

const benchBody = {
  period: "2026-07",
  data: [
    { rank: 1, agencyId: "a", agencyName: "Agence Plateau", bankId: BANK_ID, status: "VERT", tauxSLA: 92, tma: 9 },
    { rank: 2, agencyId: "b", agencyName: "Agence Sans Donnée", bankId: BANK_ID, status: "n/a", tauxSLA: 0, tma: 0 },
  ],
  meta: { page: 1, limit: 20, total: 2 },
};

function props(role: Role, over: Partial<ReportsDashboardProps> = {}): ReportsDashboardProps {
  return {
    reporting: createSigfaClient("reporting", BASE),
    bankId: BANK_ID,
    agencyId: AGENCY_ID,
    role,
    period: "2026-07",
    ...over,
  };
}

describe("REP-003b: ReportsDashboard — RBAC", () => {
  beforeEach(() => {
    server.use(http.get(`${BASE}/reports/benchmark`, () => HttpResponse.json(benchBody)));
  });

  it("REP-003b: AGENT → surface interdite, AUCUN déclencheur d'export", () => {
    render(<ReportsDashboard {...props("AGENT")} />);
    expect(screen.getByTestId("reports-forbidden")).toBeInTheDocument();
    expect(screen.queryByTestId("export-panel")).toBeNull();
    expect(screen.queryByTestId("export-launch")).toBeNull();
  });

  it("REP-003b: MANAGER → surface interdite (non AGENCY_DIRECTOR+)", () => {
    render(<ReportsDashboard {...props("MANAGER")} />);
    expect(screen.getByTestId("reports-forbidden")).toBeInTheDocument();
  });

  it("REP-003b: AGENCY_DIRECTOR → surface complète (export + benchmarking)", async () => {
    render(<ReportsDashboard {...props("AGENCY_DIRECTOR")} />);
    expect(screen.getByTestId("reports-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("export-panel")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("benchmark-table")).toBeInTheDocument());
  });

  it("REP-003b: AUDITOR → surface complète", async () => {
    render(<ReportsDashboard {...props("AUDITOR")} />);
    expect(screen.getByTestId("export-panel")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("benchmark-table")).toBeInTheDocument());
  });
});

describe("REP-003b: ReportsDashboard — composition & i18n", () => {
  beforeEach(() => {
    server.use(http.get(`${BASE}/reports/benchmark`, () => HttpResponse.json(benchBody)));
  });

  it("REP-003b: benchmarking chargé au montant, n/a en fin", async () => {
    render(<ReportsDashboard {...props("BANK_ADMIN")} />);
    await waitFor(() => expect(screen.getAllByTestId("benchmark-row").length).toBe(2));
    const rows = screen.getAllByTestId("benchmark-row");
    expect(rows.at(-1)!.getAttribute("data-status")).toBe("n/a");
  });

  it("REP-003b: FR/EN — titre traduit", async () => {
    const { rerender } = render(<ReportsDashboard {...props("BANK_ADMIN")} />);
    expect(screen.getByText("RAPPORTS & BENCHMARKING")).toBeInTheDocument();
    rerender(<ReportsDashboard {...props("BANK_ADMIN", { locale: "en" })} />);
    await waitFor(() => expect(screen.getByText("REPORTS & BENCHMARKING")).toBeInTheDocument());
  });

  it("REP-003b: rangée de KpiTile en tête (nb classées, meilleure/pire, part n/a) + sous-titre période", async () => {
    render(<ReportsDashboard {...props("BANK_ADMIN")} />);
    // Period subtitle is always rendered.
    expect(screen.getByText(/2026-07/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("reports-overview")).toBeInTheDocument());
    const overview = screen.getByTestId("reports-overview");
    // 1 ranked (Plateau) + 1 n/a → 50% n/a share, best = Plateau.
    expect(overview).toHaveTextContent("Agence Plateau");
    expect(overview).toHaveTextContent("50 %");
  });

  it("REP-003b: un SEUL traitement offline — bannière en tête de page", async () => {
    render(<ReportsDashboard {...props("BANK_ADMIN", { offline: true })} />);
    await waitFor(() => expect(screen.getByTestId("benchmark-table")).toBeInTheDocument());
    expect(screen.getByTestId("reports-offline")).toBeInTheDocument();
    // No duplicate offline treatment inside the panels.
    expect(screen.queryByTestId("benchmark-offline")).toBeNull();
    expect(screen.queryByTestId("export-offline")).toBeNull();
  });

  it("REP-003b: forbidden rendu en EmptyState (pas un <p> gris nu)", () => {
    const { container } = render(<ReportsDashboard {...props("AGENT")} />);
    expect(container.querySelector(".sig-empty")).not.toBeNull();
  });
});
