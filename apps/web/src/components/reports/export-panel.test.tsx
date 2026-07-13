/**
 * Tests for ExportPanel (REP-003b) — the 5 export-flow states, download link,
 * expired → restart, offline disabled trigger, FR/EN, tokens only.
 * @module components/reports/export-panel.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExportPanel, type ExportPanelProps } from "./export-panel";
import type { ExportJob } from "@/lib/use-report-export";

function props(over: Partial<ExportPanelProps> = {}): ExportPanelProps {
  return {
    phase: "idle",
    job: null,
    downloadable: false,
    format: "pdf",
    scope: "agency",
    period: "2026-07",
    onFormatChange: vi.fn(),
    onScopeChange: vi.fn(),
    onPeriodChange: vi.fn(),
    onLaunch: vi.fn(),
    ...over,
  };
}

const readyJob: ExportJob = {
  jobId: "job_export_01",
  status: "READY",
  downloadUrl: "https://storage.sigfa.ci/exports/job_export_01.pdf?sig=abc",
  expiresAt: "2999-01-01T00:00:00Z",
};

describe("REP-003b: ExportPanel — formulaire + déclenchement", () => {
  it("REP-003b: nominal (idle) — sélecteurs format/scope/période + bouton lancer", () => {
    render(<ExportPanel {...props()} />);
    expect(screen.getByTestId("export-format")).toBeInTheDocument();
    expect(screen.getByTestId("export-scope")).toBeInTheDocument();
    expect(screen.getByTestId("export-period")).toBeInTheDocument();
    expect(screen.getByTestId("export-launch")).toBeEnabled();
    expect(screen.getByTestId("export-empty")).toBeInTheDocument();
  });

  it("REP-003b: clic lancer → onLaunch appelé", () => {
    const onLaunch = vi.fn();
    render(<ExportPanel {...props({ onLaunch })} />);
    fireEvent.click(screen.getByTestId("export-launch"));
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("REP-003b: changement de format/scope → callbacks", () => {
    const onFormatChange = vi.fn();
    const onScopeChange = vi.fn();
    render(<ExportPanel {...props({ onFormatChange, onScopeChange })} />);
    fireEvent.change(screen.getByTestId("export-format"), { target: { value: "xlsx" } });
    fireEvent.change(screen.getByTestId("export-scope"), { target: { value: "network" } });
    expect(onFormatChange).toHaveBeenCalledWith("xlsx");
    expect(onScopeChange).toHaveBeenCalledWith("network");
  });
});

describe("REP-003b: ExportPanel — 5 états du flux", () => {
  it("REP-003b: loading — polling en cours, bouton désactivé", () => {
    const job: ExportJob = { jobId: "j", status: "PROCESSING", downloadUrl: null, expiresAt: null };
    render(<ExportPanel {...props({ phase: "polling", job })} />);
    expect(screen.getByTestId("export-loading")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("export-launch")).toBeDisabled();
  });

  it("REP-003b: ready — bouton téléchargement pointe l'URL signée", () => {
    render(<ExportPanel {...props({ phase: "ready", job: readyJob, downloadable: true })} />);
    const link = screen.getByTestId("export-download");
    expect(link).toHaveAttribute("href", readyJob.downloadUrl);
  });

  it("REP-003b: ready mais expiré — message humain + relance (pas de lien mort)", () => {
    render(<ExportPanel {...props({ phase: "ready", job: { ...readyJob, expiresAt: "2000-01-01T00:00:00Z" }, downloadable: false })} />);
    expect(screen.getByTestId("export-expired")).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("export-retry")).toBeInTheDocument();
    expect(screen.queryByTestId("export-download")).toBeNull();
  });

  it("REP-003b: failed — message humain + relance", () => {
    render(<ExportPanel {...props({ phase: "failed", job: { jobId: "j", status: "FAILED", downloadUrl: null, expiresAt: null } })} />);
    expect(screen.getByTestId("export-failed")).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("export-retry")).toBeInTheDocument();
  });

  it("REP-003b: error — message humain + relance", () => {
    render(<ExportPanel {...props({ phase: "error" })} />);
    expect(screen.getByTestId("export-error")).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("export-retry")).toBeInTheDocument();
  });

  it("REP-003b: offline — notice + déclencheur désactivé", () => {
    render(<ExportPanel {...props({ offline: true })} />);
    expect(screen.getByTestId("export-offline")).toBeInTheDocument();
    expect(screen.getByTestId("export-launch")).toBeDisabled();
  });
});

describe("REP-003b: ExportPanel — i18n + tokens", () => {
  it("REP-003b: FR par défaut / EN via locale (aucune clé brute)", () => {
    const { rerender } = render(<ExportPanel {...props()} />);
    expect(screen.getByText("EXPORT DE RAPPORT")).toBeInTheDocument();
    rerender(<ExportPanel {...props({ locale: "en" })} />);
    expect(screen.getByText("REPORT EXPORT")).toBeInTheDocument();
    expect(screen.queryByText(/reports\.export\./)).toBeNull();
  });

  it("REP-003b: tokens uniquement — aucune couleur hex en dur dans le rendu", () => {
    const { container } = render(<ExportPanel {...props({ phase: "ready", job: readyJob, downloadable: true })} />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
