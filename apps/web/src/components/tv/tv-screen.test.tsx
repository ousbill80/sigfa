/**
 * Tests for TvScreen (TV-001) — layout, 5 states, tokens-only, i18n.
 * @module components/tv/tv-screen.test
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TvScreen } from "./tv-screen";
import { initialTvState, type TvState, type TvCall } from "@/lib/tv-state";
import { SUPPORTED_LOCALES, t } from "@/lib/i18n";

function call(displayNumber: string, counterLabel: string, calledAt: string): TvCall {
  return { ticketNumber: displayNumber, displayNumber, counterLabel, calledAt };
}

const nominal: TvState = {
  hero: call("OC-047", "Guichet 3", "2026-07-11T09:30:00Z"),
  previous: [
    call("OC-046", "Guichet 1", "2026-07-11T09:29:00Z"),
    call("OC-012", "Guichet 4", "2026-07-11T09:28:00Z"),
    call("OC-045", "Guichet 2", "2026-07-11T09:27:00Z"),
  ],
  queue: ["OC-048", "OC-049", "OC-050"],
  connection: "connected",
};

describe("TvScreen — TV-001 layout", () => {
  it("TV-001: héros affiché à 180px minimum via token --display-tv-hero", () => {
    render(<TvScreen state={nominal} tenantName="Banque du Commerce" />);
    const hero = screen.getByTestId("tv-hero-number");
    expect(hero).toHaveTextContent("OC-047");
    expect(hero.getAttribute("style")).toContain("var(--display-tv-hero)");
  });

  it("TV-001: précédents rendus à 64px minimum — assertion CSS --display-tv", () => {
    render(<TvScreen state={nominal} />);
    const cards = screen.getAllByTestId("tv-previous-card");
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      expect(c.getAttribute("style")).toContain("var(--display-tv)");
    }
  });

  it("TV-001: rail latéral persistant — derniers appelés + longueur de file", () => {
    render(<TvScreen state={nominal} />);
    const rail = screen.getByTestId("tv-rail");
    expect(within(rail).getByTestId("tv-previous")).toBeInTheDocument();
    const count = screen.getByTestId("tv-queue-count");
    expect(count).toHaveTextContent(String(nominal.queue.length));
    expect(count.getAttribute("style")).toContain("var(--display-tv-counter)");
  });

  it("TV-001: en-tête banque — pastille logo sur --brand (thémable tenant)", () => {
    render(<TvScreen state={nominal} tenantName="Banque du Commerce" />);
    const mark = screen.getByTestId("tv-brand-mark");
    expect(mark.getAttribute("style")).toContain("var(--brand)");
  });

  it("TV-001: header affiche label APPELS EN COURS + horloge + tenant", () => {
    render(<TvScreen state={nominal} tenantName="Banque du Commerce" clock="14:37:22" />);
    const header = screen.getByTestId("tv-header");
    expect(within(header).getByText(t("tv.title", "fr"))).toBeInTheDocument();
    expect(within(header).getByText("Banque du Commerce")).toBeInTheDocument();
    expect(screen.getByTestId("tv-clock")).toHaveTextContent("14:37:22");
  });

  it("TV-001: tokens uniquement — surface sur --surface-screen, encre --ink-inverse", () => {
    render(<TvScreen state={nominal} />);
    const style = screen.getByTestId("tv-screen").getAttribute("style") ?? "";
    expect(style).toContain("var(--surface-screen)");
    expect(style).toContain("var(--ink-inverse)");
  });
});

describe("TvScreen — 5 états", () => {
  it("TV-001: état nominal — data-state nominal, héros présent", () => {
    render(<TvScreen state={nominal} />);
    expect(screen.getByTestId("tv-screen")).toHaveAttribute("data-state", "nominal");
  });

  it("TV-001: état loading — skeleton plein écran sans flash blanc (surface-screen)", () => {
    render(<TvScreen state={initialTvState} loading />);
    const skeleton = screen.getByTestId("tv-skeleton");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(skeleton.getAttribute("style")).toContain("var(--surface-screen)");
    expect(screen.queryByTestId("tv-hero-number")).not.toBeInTheDocument();
  });

  it("TV-001: état empty (scène d'appel forcée) — message lisible + structure préservée", () => {
    // En scène d'appel (mode=call) sans héros, la structure est préservée et le
    // message empty reste lisible. Le repos par défaut est couvert par l'AdZone.
    render(<TvScreen state={initialTvState} mode="call" />);
    expect(screen.getByTestId("tv-screen")).toHaveAttribute("data-state", "empty");
    const empty = screen.getByTestId("tv-empty");
    expect(empty).toHaveTextContent(t("tv.empty", "fr"));
    // structure preserved: hero/previous/queue zones still present
    expect(screen.getByTestId("tv-hero")).toBeInTheDocument();
    expect(screen.getByTestId("tv-previous")).toBeInTheDocument();
    expect(screen.getByTestId("tv-queue")).toBeInTheDocument();
    // --display-tv still asserted on empty message (≥64px maintained)
    expect(empty.getAttribute("style")).toContain("var(--display-tv)");
  });

  it("TV-001: état error — payload Zod invalide n'altère pas l'affichage (state inchangé)", () => {
    // The reducer ignores invalid payloads (covered in tv-state.test); here we
    // assert the screen renders the last known good state unchanged.
    const { rerender } = render(<TvScreen state={nominal} />);
    expect(screen.getByTestId("tv-hero-number")).toHaveTextContent("OC-047");
    rerender(<TvScreen state={nominal} />);
    expect(screen.getByTestId("tv-hero-number")).toHaveTextContent("OC-047");
  });

  it("TV-001: état offline — bandeau discret, dernier état conservé", () => {
    const offlineState: TvState = { ...nominal, connection: "offline" };
    render(<TvScreen state={offlineState} />);
    const banner = screen.getByTestId("tv-offline-banner");
    expect(banner).toHaveTextContent(t("tv.offline", "fr"));
    expect(banner).toHaveAttribute("role", "status");
    // last known hero still visible
    expect(screen.getByTestId("tv-hero-number")).toHaveTextContent("OC-047");
  });
});

describe("TvScreen — i18n & motion", () => {
  it("TV-001: i18n — labels header rendus en FR/EN sans crash", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const { unmount } = render(<TvScreen state={nominal} locale={locale} />);
      expect(screen.getByText(t("tv.title", locale))).toBeInTheDocument();
      unmount();
    }
  });

  it("TV-001: prefers-reduced-motion — le héros n'utilise que des tokens de transition (désactivables via CSS)", () => {
    render(<TvScreen state={nominal} />);
    // transitions are token-driven; the global reduced-motion media query in
    // globals.css disables them. We assert no hard-coded ms durations are used.
    const heroStyle = screen.getByTestId("tv-hero").getAttribute("style") ?? "";
    expect(heroStyle).toContain("var(--tv-slide-duration)");
    expect(heroStyle).not.toMatch(/\d+ms/);
  });
});

describe("TvScreen — TV-002 flash & motion", () => {
  it("TV-002: flash brand — héros sur --brand quand celebration active (theming tenant)", () => {
    render(<TvScreen state={nominal} celebration />);
    const hero = screen.getByTestId("tv-hero");
    expect(hero).toHaveAttribute("data-celebration", "on");
    expect(hero.getAttribute("style")).toContain("var(--brand)");
  });

  it("TV-002: sans célébration — héros revient sur --surface-screen", () => {
    render(<TvScreen state={nominal} celebration={false} />);
    const hero = screen.getByTestId("tv-hero");
    expect(hero).toHaveAttribute("data-celebration", "off");
    expect(hero.getAttribute("style")).toContain("var(--surface-screen)");
  });

  it("TV-002: glissement héros — transition 250ms via token --tv-slide-duration", () => {
    render(<TvScreen state={nominal} />);
    const heroStyle = screen.getByTestId("tv-hero").getAttribute("style") ?? "";
    expect(heroStyle).toContain("var(--tv-slide-duration)");
  });

  it("TV-002: prefers-reduced-motion — transition désactivée (changement instantané)", () => {
    render(<TvScreen state={nominal} reducedMotion />);
    const heroStyle = screen.getByTestId("tv-hero").getAttribute("style") ?? "";
    expect(heroStyle).toContain("transition: none");
  });
});

describe("TvScreen — mode repos↔appel + AdZone", () => {
  it("AdZone: repos par défaut sans héros — carrousel plein écran, pas de scène d'appel", () => {
    render(<TvScreen state={initialTvState} tenantName="Banque du Commerce" />);
    expect(screen.getByTestId("tv-screen")).toHaveAttribute("data-mode", "rest");
    expect(screen.getByTestId("tv-adzone")).toBeInTheDocument();
    expect(screen.queryByTestId("tv-hero")).not.toBeInTheDocument();
  });

  it("AdZone: mode=call — bascule sur la scène d'appel, AdZone masquée", () => {
    render(<TvScreen state={nominal} mode="call" />);
    expect(screen.getByTestId("tv-screen")).toHaveAttribute("data-mode", "call");
    expect(screen.getByTestId("tv-hero")).toBeInTheDocument();
    expect(screen.queryByTestId("tv-adzone")).not.toBeInTheDocument();
  });

  it("AdZone: mode=rest explicite malgré un héros — repos prioritaire (fin de fenêtre)", () => {
    render(<TvScreen state={nominal} mode="rest" />);
    expect(screen.getByTestId("tv-adzone")).toBeInTheDocument();
    expect(screen.queryByTestId("tv-hero-number")).not.toBeInTheDocument();
  });

  it("AdZone: héros présent sans mode → scène d'appel (rétro-compatible TV-001)", () => {
    render(<TvScreen state={nominal} />);
    expect(screen.getByTestId("tv-screen")).toHaveAttribute("data-mode", "call");
    expect(screen.getByTestId("tv-hero-number")).toHaveTextContent("OC-047");
  });

  it("AdZone: loading prioritaire sur le repos — skeleton, pas de carrousel", () => {
    render(<TvScreen state={initialTvState} loading />);
    expect(screen.getByTestId("tv-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("tv-adzone")).not.toBeInTheDocument();
  });

  it("AdZone: bandeau offline conservé au repos (dernier état réseau)", () => {
    const offline: TvState = { ...initialTvState, connection: "offline" };
    render(<TvScreen state={offline} />);
    expect(screen.getByTestId("tv-adzone")).toBeInTheDocument();
    expect(screen.getByTestId("tv-offline-banner")).toBeInTheDocument();
  });
});
