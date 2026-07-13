/**
 * KIOSK-BORNE — Tests du bandeau d'en-tête persistant (banque + agence +
 * date/heure vivante). Tokens uniquement, pastille brand texte (jamais d'image).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "fr" }),
}));

import {
  KioskHeaderBanner,
  formatBannerDate,
  formatBannerTime,
} from "@/components/KioskHeaderBanner";

describe("KIOSK-BORNE: KioskHeaderBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T10:30:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("KIOSK-BORNE: banque + agence + pastille brand (initiale texte, tokens uniquement)", () => {
    render(<KioskHeaderBanner agencyName="Cocody Angré" bankName="Banque Ivoire" />);

    expect(screen.getByTestId("kiosk-header-banner")).toBeInTheDocument();
    expect(screen.getByTestId("kiosk-header-bank").textContent).toBe("Banque Ivoire");
    expect(screen.getByTestId("kiosk-header-agency").textContent).toBe("Cocody Angré");

    const badge = screen.getByTestId("kiosk-header-bank-badge");
    expect(badge.textContent).toBe("B");
    expect((badge as HTMLElement).style.backgroundColor).toBe("var(--brand)");
    expect((badge as HTMLElement).style.color).toBe("var(--brand-contrast)");
    // Aucune image (le logo est typographique — theming banque sans asset).
    expect(badge.querySelector("img")).toBeNull();
  });

  it("KIOSK-BORNE: date longue + heure affichées, localisées FR", () => {
    render(<KioskHeaderBanner agencyName="Cocody Angré" bankName="Banque Ivoire" />);

    expect(screen.getByTestId("kiosk-header-time").textContent).toBe(
      formatBannerTime(new Date("2026-07-13T10:30:00"), "fr")
    );
    const dateText = screen.getByTestId("kiosk-header-date").textContent ?? "";
    expect(dateText).toContain("2026");
    expect(dateText.toLowerCase()).toContain("juillet");
  });

  it("KIOSK-BORNE: heure VIVANTE — le bandeau se met à jour après une minute", () => {
    render(<KioskHeaderBanner agencyName="Cocody Angré" bankName="Banque Ivoire" />);

    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByTestId("kiosk-header-time").textContent).toBe(
      formatBannerTime(new Date("2026-07-13T10:31:01"), "fr")
    );
  });

  it("KIOSK-BORNE: formats purs — accents parfaits, jamais de mojibake", () => {
    const date = new Date("2026-07-13T13:57:00");
    expect(formatBannerDate(date, "fr")).toBe("lundi 13 juillet 2026");
    expect(formatBannerTime(date, "fr")).toMatch(/13[:h]57/);
    expect(formatBannerDate(date, "en")).toBe("Monday, July 13, 2026");
    // Aucun caractère de substitution (le bug « esp¿ces » du modèle).
    expect(formatBannerDate(date, "fr")).not.toContain("¿");
    expect(formatBannerDate(date, "fr")).not.toContain("�");
  });
});
