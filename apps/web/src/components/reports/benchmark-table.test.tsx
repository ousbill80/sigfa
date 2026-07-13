/**
 * Tests for BenchmarkTable (REP-003b) — server-status pills (zero client
 * re-categorisation), n/a muted & last & never red, sortKpi control, 4 states,
 * offline, FR/EN, tokens only.
 * @module components/reports/benchmark-table.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { BenchmarkTable, type BenchmarkTableProps } from "./benchmark-table";
import type { BenchmarkRow } from "@/lib/reports-state";

const ROWS: BenchmarkRow[] = [
  { rank: 1, agencyId: "a", agencyName: "Agence Plateau", status: "VERT", tauxSLA: 92, tma: 9 },
  { rank: 2, agencyId: "b", agencyName: "Agence Cocody", status: "ORANGE", tauxSLA: 71, tma: 18 },
  { rank: 3, agencyId: "c", agencyName: "Agence Yopougon", status: "ROUGE", tauxSLA: 52, tma: 28 },
  { rank: 99, agencyId: "d", agencyName: "Agence Sans Donnée", status: "n/a", tauxSLA: 0, tma: 0 },
];

function props(over: Partial<BenchmarkTableProps> = {}): BenchmarkTableProps {
  return {
    rows: ROWS,
    load: "ready",
    sortKpi: "tauxSLA",
    onSort: vi.fn(),
    ...over,
  };
}

describe("REP-003b: BenchmarkTable — pastilles = statut serveur", () => {
  it("REP-003b: VERT→success, ORANGE→warning, ROUGE→danger, n/a→info (zéro re-catégorisation)", () => {
    render(<BenchmarkTable {...props()} />);
    const rows = screen.getAllByTestId("benchmark-row");
    expect(within(rows[0]!).getByTestId("benchmark-pill").getAttribute("style")).toContain("var(--success)");
    expect(within(rows[1]!).getByTestId("benchmark-pill").getAttribute("style")).toContain("var(--warning)");
    expect(within(rows[2]!).getByTestId("benchmark-pill").getAttribute("style")).toContain("var(--danger)");
    expect(within(rows[3]!).getByTestId("benchmark-pill").getAttribute("style")).toContain("var(--info)");
  });

  it("REP-003b: n/a relégué en dernier et JAMAIS rouge", () => {
    render(<BenchmarkTable {...props()} />);
    const rows = screen.getAllByTestId("benchmark-row");
    const last = rows.at(-1)!;
    expect(last.getAttribute("data-status")).toBe("n/a");
    expect(within(last).getByTestId("benchmark-pill").getAttribute("style")).not.toContain("var(--danger)");
  });

  it("REP-003b: pastille non décorative — label texte + aria (jamais couleur seule)", () => {
    render(<BenchmarkTable {...props()} />);
    const pill = within(screen.getAllByTestId("benchmark-row")[2]!).getByTestId("benchmark-pill");
    expect(pill).toHaveAttribute("aria-label");
    expect(pill).toHaveTextContent(/./);
  });

  it("REP-003b: n/a affiché avec un tiret de rang (non classé)", () => {
    render(<BenchmarkTable {...props()} />);
    const last = screen.getAllByTestId("benchmark-row").at(-1)!;
    expect(last).toHaveTextContent("—");
  });
});

describe("REP-003b: BenchmarkTable — valeur chiffrée du KPI trié (lignes-cartes)", () => {
  it("REP-003b: affiche la valeur tauxSLA par ligne (font-display tabular-nums, alignée à droite)", () => {
    render(<BenchmarkTable {...props({ sortKpi: "tauxSLA" })} />);
    const rows = screen.getAllByTestId("benchmark-row");
    expect(within(rows[0]!).getByTestId("benchmark-value")).toHaveTextContent("92 %");
    expect(within(rows[1]!).getByTestId("benchmark-value")).toHaveTextContent("71 %");
  });

  it("REP-003b: valeur tma en minutes quand tri=tma", () => {
    render(<BenchmarkTable {...props({ sortKpi: "tma" })} />);
    const rows = screen.getAllByTestId("benchmark-row");
    expect(within(rows[0]!).getByTestId("benchmark-value")).toHaveTextContent("9 min");
  });

  it("REP-003b: KPI sans valeur par ligne → tiret neutre (jamais un chiffre fabriqué)", () => {
    render(<BenchmarkTable {...props({ sortKpi: "nps" })} />);
    const rows = screen.getAllByTestId("benchmark-row");
    expect(within(rows[0]!).getByTestId("benchmark-value")).toHaveTextContent("—");
  });

  it("REP-003b: rendu en lignes-cartes (liste), pas de <table> ligné (anti-pattern DS §5)", () => {
    const { container } = render(<BenchmarkTable {...props()} />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("ul")).not.toBeNull();
  });
});

describe("REP-003b: BenchmarkTable — tri serveur", () => {
  it("REP-003b: changement de sortKpi → onSort (le serveur re-classe)", () => {
    const onSort = vi.fn();
    render(<BenchmarkTable {...props({ onSort })} />);
    fireEvent.change(screen.getByTestId("benchmark-sort"), { target: { value: "nps" } });
    expect(onSort).toHaveBeenCalledWith("nps");
  });
});

describe("REP-003b: BenchmarkTable — 4 états + offline", () => {
  it("REP-003b: loading — Spinner tokenisé (role status, aria-busy)", () => {
    const { container } = render(<BenchmarkTable {...props({ load: "loading" })} />);
    expect(screen.getByTestId("benchmark-loading")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".sig-spinner")).not.toBeNull();
  });

  it("REP-003b: empty — message humain", () => {
    render(<BenchmarkTable {...props({ load: "empty", rows: [] })} />);
    expect(screen.getByTestId("benchmark-empty")).toBeInTheDocument();
  });

  it("REP-003b: error — message humain (role alert)", () => {
    render(<BenchmarkTable {...props({ load: "error" })} />);
    expect(screen.getByTestId("benchmark-error")).toHaveAttribute("role", "alert");
  });

  it("REP-003b: offline — classement figé (aria-disabled ; bannière offline au niveau page, jamais dupliquée ici)", () => {
    render(<BenchmarkTable {...props({ offline: true })} />);
    // Single offline treatment lives at the page level; the table only freezes (aria-disabled).
    expect(screen.queryByTestId("benchmark-offline")).toBeNull();
    expect(screen.getByTestId("benchmark-table")).toHaveAttribute("aria-disabled", "true");
  });
});

describe("REP-003b: BenchmarkTable — i18n + tokens", () => {
  it("REP-003b: FR/EN sans clé brute", () => {
    const { rerender } = render(<BenchmarkTable {...props()} />);
    expect(screen.getByText("BENCHMARKING INTER-AGENCES")).toBeInTheDocument();
    rerender(<BenchmarkTable {...props({ locale: "en" })} />);
    expect(screen.getByText("INTER-AGENCY BENCHMARKING")).toBeInTheDocument();
    expect(screen.queryByText(/reports\.benchmark\./)).toBeNull();
  });

  it("REP-003b: tokens uniquement — aucune couleur hex en dur", () => {
    const { container } = render(<BenchmarkTable {...props()} />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
