/**
 * Tests for TvDisplay — TV v3 : split permanent piloté par la logique temps
 * réel INCHANGÉE (simulation F4 sans provider socket), date complète FR/EN.
 * @module components/tv/tv-display.test
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TvDisplay, formatTvDate, type TvTenant } from "./tv-display";
import { TV_SEED_STATE } from "@/lib/tv-fixtures";

const TENANT: TvTenant = {
  name: "Banque du Commerce",
  brand: "#c25a16",
  locale: "fr",
};

describe("TvDisplay — TV-V3 split permanent", () => {
  it("TV-V3: rend pub ET appel courant simultanément (aucun mode exclusif)", () => {
    render(<TvDisplay tenant={TENANT} />);
    expect(screen.getByTestId("tv-adzone")).toBeInTheDocument();
    expect(screen.getByTestId("tv-hero-number")).toHaveTextContent(
      TV_SEED_STATE.hero!.displayNumber,
    );
    // Le carrousel tourne en permanence, même avec un appel actif.
    expect(screen.getByTestId("tv-adzone")).toHaveAttribute("data-active", "on");
  });

  it("TV-V3: date complète affichée dans le bandeau (horloge côté client)", () => {
    render(<TvDisplay tenant={TENANT} />);
    const date = screen.getByTestId("tv-date");
    expect(date.textContent).not.toBe("");
    // Année courante présente = date complète, pas une simple étiquette.
    expect(date.textContent).toContain(String(new Date().getFullYear()));
  });

  it("TV-V3: simulation sans provider — data-realtime off, écran stable", () => {
    render(<TvDisplay tenant={TENANT} />);
    expect(screen.getByTestId("tv-root")).toHaveAttribute("data-realtime", "off");
    expect(screen.getByTestId("tv-screen")).toHaveAttribute("data-state", "nominal");
  });
});

describe("formatTvDate — date complète FR/EN", () => {
  const date = new Date("2026-07-13T14:10:00");

  it("TV-V3: FR — jour de semaine + jour + mois + année, capitalisé", () => {
    const label = formatTvDate(date, "fr");
    expect(label).toBe("Lundi 13 juillet 2026");
  });

  it("TV-V3: EN — full weekday + day + month + year", () => {
    const label = formatTvDate(date, "en");
    expect(label).toContain("Monday");
    expect(label).toContain("July");
    expect(label).toContain("2026");
  });
});
