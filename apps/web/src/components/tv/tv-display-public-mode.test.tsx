/**
 * Tests for TvDisplay — mode public : takeover « numéro appelé plein centre »
 * piloté par le socket (useSocket mocké au niveau module), annonce vocale
 * (+ `?muted=1`), bouton plein écran dans le bandeau, curseur masqué après
 * inactivité.
 * @module components/tv/tv-display-public-mode.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { TvDisplay, type TvTenant } from "./tv-display";
import { tvReducer, type TvState } from "@/lib/tv-state";
import { TV_SEED_STATE, simulatedTicketCalled } from "@/lib/tv-fixtures";
import {
  TV_OVERLAY_MS,
  TV_OVERLAY_EXIT_MS,
} from "./use-tv-call-overlay";
import { TV_CURSOR_IDLE_MS } from "./tv-fullscreen";
import type { SocketContextValue } from "@/lib/socket-provider";

/* useSocket mocké : contexte piloté par les tests (le reste du module reste réel). */
let mockSocket: SocketContextValue;
vi.mock("@/lib/socket-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/socket-provider")>();
  return { ...actual, useSocket: (): SocketContextValue => mockSocket };
});

const TENANT: TvTenant = { name: "Banque du Commerce", brand: "#c25a16", locale: "fr" };

/** Utterance de test pour la voie vocale par défaut (window.speechSynthesis). */
class FakeUtterance {
  text: string;
  lang = "";
  voice: unknown = null;
  constructor(text: string) {
    this.text = text;
  }
}

function connectedSocket(tv: TvState): SocketContextValue {
  return {
    connected: true,
    status: "connected",
    tv,
    dashboard: { lastQueueUpdate: null, lastCounterStatus: null },
  };
}

function calledState(state: TvState, number: string, counter: string): TvState {
  return tvReducer(state, {
    type: "ticket:called",
    payload: simulatedTicketCalled(number, counter),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  mockSocket = connectedSocket(TV_SEED_STATE);
  window.history.replaceState({}, "", "/tv/agence-demo");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("TvDisplay — takeover sur ticket:called (socket réel mocké)", () => {
  it("TV-PUB: ticket:called → overlay plein centre, carte en célébration, puis retour au split", () => {
    const { rerender } = render(<TvDisplay tenant={TENANT} />);
    expect(screen.getByTestId("tv-root")).toHaveAttribute("data-realtime", "on");
    // Snapshot initial : jamais d'overlay au montage.
    expect(screen.queryByTestId("tv-call-overlay")).toBeNull();

    mockSocket = connectedSocket(calledState(TV_SEED_STATE, "A053", "Guichet 5"));
    rerender(<TvDisplay tenant={TENANT} />);
    act(() => vi.advanceTimersByTime(0));

    const overlay = screen.getByTestId("tv-call-overlay");
    expect(overlay).toBeInTheDocument();
    expect(screen.getByTestId("tv-overlay-number")).toHaveTextContent(
      mockSocket.tv.hero!.displayNumber
    );
    expect(screen.getByTestId("tv-overlay-counter")).toHaveTextContent("Guichet 5");
    // La carte « MAINTENANT SERVI » reste à jour ET flashe pendant le takeover.
    expect(screen.getByTestId("tv-hero")).toHaveAttribute("data-celebration", "on");
    expect(screen.getByTestId("tv-hero-number")).toHaveTextContent(
      mockSocket.tv.hero!.displayNumber
    );

    // ~6-8 s puis retour fluide à la mise en page normale.
    act(() => vi.advanceTimersByTime(TV_OVERLAY_MS + TV_OVERLAY_EXIT_MS));
    expect(screen.queryByTestId("tv-call-overlay")).toBeNull();
    expect(screen.getByTestId("tv-hero")).toHaveAttribute("data-celebration", "off");
  });

  it("TV-PUB: annonce vocale via window.speechSynthesis — coupée par ?muted=1", () => {
    const speech = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] };
    vi.stubGlobal("speechSynthesis", speech);

    // 1. Son actif (défaut) : l'annonce part avec le numéro épelé.
    const first = render(<TvDisplay tenant={TENANT} />);
    mockSocket = connectedSocket(calledState(TV_SEED_STATE, "A053", "Guichet 5"));
    first.rerender(<TvDisplay tenant={TENANT} />);
    act(() => vi.advanceTimersByTime(0));
    expect(speech.speak).toHaveBeenCalledTimes(1);
    const utterance = speech.speak.mock.calls[0]?.[0] as FakeUtterance;
    expect(utterance.text).toContain("Ticket");
    expect(utterance.text).toContain("Guichet 5");
    first.unmount();

    // 2. ?muted=1 : overlay affiché, AUCUNE annonce.
    speech.speak.mockClear();
    window.history.replaceState({}, "", "/tv/agence-demo?muted=1");
    mockSocket = connectedSocket(TV_SEED_STATE);
    const second = render(<TvDisplay tenant={TENANT} />);
    mockSocket = connectedSocket(calledState(TV_SEED_STATE, "A054", "Guichet 6"));
    second.rerender(<TvDisplay tenant={TENANT} />);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByTestId("tv-call-overlay")).toBeInTheDocument();
    expect(speech.speak).not.toHaveBeenCalled();
  });
});

describe("TvDisplay — plein écran + curseur (écran public)", () => {
  it("TV-PUB: bouton plein écran discret dans le bandeau — le clic appelle l'API", () => {
    const request = vi.fn(() => Promise.resolve());
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: request,
    });

    render(<TvDisplay tenant={TENANT} />);
    const header = screen.getByTestId("tv-header");
    const button = screen.getByTestId("tv-fullscreen-button");
    expect(header.contains(button)).toBe(true);

    act(() => {
      button.click();
    });
    expect(request).toHaveBeenCalledTimes(1);

    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
  });

  it("TV-PUB: curseur masqué après inactivité, réveil au mouvement", () => {
    render(<TvDisplay tenant={TENANT} />);
    const root = screen.getByTestId("tv-root");
    expect(root).toHaveAttribute("data-idle", "off");

    act(() => vi.advanceTimersByTime(TV_CURSOR_IDLE_MS));
    expect(root).toHaveAttribute("data-idle", "on");
    expect((root.getAttribute("style") ?? "")).toContain("cursor: none");
    // Le bouton plein écran disparaît aussi (écran 100 % public).
    const buttonStyle =
      screen.getByTestId("tv-fullscreen-button").getAttribute("style") ?? "";
    expect(buttonStyle).toContain("opacity: 0");

    act(() => {
      window.dispatchEvent(new Event("pointermove"));
    });
    expect(root).toHaveAttribute("data-idle", "off");
  });
});
