/**
 * Tests for TvCallOverlay — takeover « numéro appelé plein centre » : voile
 * plein écran token nuit, numéro géant UNE ligne (taille adaptative bornée par
 * tokens), guichet lisible dessous, entrée/sortie fluides, reduced-motion.
 * @module components/tv/tv-call-overlay.test
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TvCallOverlay, overlayNumberFontSize } from "./tv-call-overlay";
import type { TvCall } from "@/lib/tv-state";

const CALL: TvCall = {
  ticketNumber: "A053",
  displayNumber: "OC-053",
  counterLabel: "Guichet 5",
  calledAt: "2026-07-14T09:31:00Z",
};

describe("TvCallOverlay — takeover plein centre", () => {
  it("TV-PUB: numéro géant centré + « Guichet N » lisible dessous", () => {
    render(<TvCallOverlay call={CALL} locale="fr" />);
    expect(screen.getByTestId("tv-overlay-number")).toHaveTextContent("OC-053");
    expect(screen.getByTestId("tv-overlay-counter")).toHaveTextContent("Guichet 5");
    // Libellé « MAINTENANT SERVI » (registre TV existant, FR).
    expect(screen.getByTestId("tv-overlay-label")).toHaveTextContent("MAINTENANT SERVI");
  });

  it("TV-PUB: voile plein écran PAR-DESSUS TOUT — fixe, token nuit assombri", () => {
    render(<TvCallOverlay call={CALL} locale="fr" />);
    const overlay = screen.getByTestId("tv-call-overlay");
    const style = overlay.getAttribute("style") ?? "";
    expect(style).toContain("position: fixed");
    expect(style).toContain("inset: 0");
    // Assombrissement dérivé du token nuit (aucun hex/rgba en dur).
    expect(style).toContain("--night-2");
    expect(style).toContain("color-mix");
  });

  it("TV-PUB: numéro sur UNE ligne — nowrap + taille adaptative bornée par tokens", () => {
    render(<TvCallOverlay call={CALL} locale="fr" />);
    const number = screen.getByTestId("tv-overlay-number");
    const style = number.getAttribute("style") ?? "";
    expect(style).toContain("white-space: nowrap");
    expect(style).toContain("clamp(var(--display-tv-counter)");
    // Halo or digne (token Moment Ticket).
    expect(style).toContain("--shadow-gold");
  });

  it("TV-PUB: annonce visuelle accessible (role status, aria-live assertive)", () => {
    render(<TvCallOverlay call={CALL} locale="fr" />);
    const overlay = screen.getByTestId("tv-call-overlay");
    expect(overlay).toHaveAttribute("role", "status");
    expect(overlay).toHaveAttribute("aria-live", "assertive");
  });

  it("TV-PUB: sortie fluide — closing → fondu (opacité 0), data-closing", () => {
    render(<TvCallOverlay call={CALL} locale="fr" closing />);
    const overlay = screen.getByTestId("tv-call-overlay");
    expect(overlay).toHaveAttribute("data-closing", "on");
    expect((overlay.getAttribute("style") ?? "")).toContain("opacity: 0");
  });

  it("TV-PUB: prefers-reduced-motion → AUCUNE transition, visible immédiatement", () => {
    render(<TvCallOverlay call={CALL} locale="fr" reducedMotion />);
    const overlay = screen.getByTestId("tv-call-overlay");
    const style = overlay.getAttribute("style") ?? "";
    expect(style).toContain("transition: none");
    expect(style).toContain("opacity: 1");
  });

  it("TV-PUB: locale EN — libellé traduit", () => {
    render(<TvCallOverlay call={CALL} locale="en" />);
    expect(screen.getByTestId("tv-overlay-label")).toHaveTextContent("NOW SERVING");
  });
});

describe("overlayNumberFontSize — même règle nowrap/adaptative que la carte", () => {
  it("TV-PUB: budget ~80cqw réparti PAR CARACTÈRE, bornes en tokens", () => {
    // 6 caractères → 13cqw par caractère.
    expect(overlayNumberFontSize("OC-053")).toBe(
      "clamp(var(--display-tv-counter), 13cqw, calc(var(--display-tv-hero) * 2))"
    );
  });

  it("TV-PUB: numéro plus long → taille par caractère plus petite (une ligne garantie)", () => {
    const short = overlayNumberFontSize("A1");
    const long = overlayNumberFontSize("OC-123456789");
    expect(short).toContain("40cqw");
    expect(long).toContain("6cqw");
  });

  it("TV-PUB: chaîne vide → pas de division par zéro", () => {
    expect(overlayNumberFontSize("")).toContain("80cqw");
  });
});
