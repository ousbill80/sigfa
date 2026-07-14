/**
 * Tests for useTvCallOverlay — file d'overlays takeover + annonce vocale.
 *
 * La détection d'appel live est PINNÉE contre le reducer RÉEL ({@link tvReducer})
 * pour que tout changement de signature du reducer casse ici (couplage assumé,
 * documenté dans le module).
 * @module components/tv/use-tv-call-overlay.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useTvCallOverlay,
  liveCallsInTransition,
  isLiveCallTransition,
  parseTvMuted,
  TV_OVERLAY_MS,
  TV_OVERLAY_EXIT_MS,
  TV_OVERLAY_GAP_MS,
} from "./use-tv-call-overlay";
import { tvReducer, initialTvState, type TvState } from "@/lib/tv-state";
import { TV_SEED_STATE, simulatedTicketCalled } from "@/lib/tv-fixtures";
import { tvAnnouncementText, type TvSpeechSynthesisLike } from "./tv-voice";

/** Utterance de test (le module vérifie sa présence globale avant de parler). */
class FakeUtterance {
  text: string;
  lang = "";
  voice: unknown = null;
  constructor(text: string) {
    this.text = text;
  }
}

/** Synthèse espionnée : parle immédiatement (voix déjà chargées). */
function spySpeech(): TvSpeechSynthesisLike & { speak: ReturnType<typeof vi.fn> } {
  return { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] };
}

/** Payload sync:state minimal valide (reconstruit tout — jamais d'overlay). */
function syncPayload(): unknown {
  return {
    agencyId: "cccccccc-cccc-4ccc-accc-cccccccccccc",
    queues: [],
    counters: [],
    recentCalls: [
      {
        ticketNumber: "A050",
        displayNumber: "OC-050",
        counterLabel: "Guichet 2",
        calledAt: "2026-07-14T09:31:00.000Z",
      },
      {
        ticketNumber: "A049",
        displayNumber: "OC-049",
        counterLabel: "Guichet 1",
        calledAt: "2026-07-14T09:30:00.000Z",
      },
    ],
    timestamp: "2026-07-14T09:31:00.000Z",
  };
}

beforeEach(() => {
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("liveCallsInTransition — pinnée contre le reducer réel", () => {
  it("TV-PUB: ticket:called → un appel live détecté (le nouveau hero)", () => {
    const next = tvReducer(TV_SEED_STATE, {
      type: "ticket:called",
      payload: simulatedTicketCalled("A053", "Guichet 5"),
    });
    const calls = liveCallsInTransition(TV_SEED_STATE, next);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(next.hero);
    expect(isLiveCallTransition(TV_SEED_STATE, next)).toBe(true);
  });

  it("TV-PUB: ticket:called depuis un écran SANS hero → détecté aussi", () => {
    const next = tvReducer(initialTvState, {
      type: "ticket:called",
      payload: simulatedTicketCalled("A001", "Guichet 1"),
    });
    expect(liveCallsInTransition(initialTvState, next)).toHaveLength(1);
  });

  it("TV-PUB: sync:state (resync) → JAMAIS d'appel détecté (pas de flash/annonce)", () => {
    const next = tvReducer(TV_SEED_STATE, { type: "sync:state", payload: syncPayload() });
    expect(next.hero?.displayNumber).toBe("OC-050");
    expect(liveCallsInTransition(TV_SEED_STATE, next)).toHaveLength(0);
  });

  it("TV-PUB: sync:state initial (montage) → aucun appel détecté", () => {
    const next = tvReducer(initialTvState, { type: "sync:state", payload: syncPayload() });
    expect(liveCallsInTransition(initialTvState, next)).toHaveLength(0);
  });

  it("TV-PUB: changement de connexion seul → aucun appel détecté", () => {
    const next = tvReducer(TV_SEED_STATE, { type: "connection", status: "offline" });
    expect(liveCallsInTransition({ ...TV_SEED_STATE }, { ...next })).toHaveLength(0);
  });

  it("TV-PUB: deux ticket:called réduits dans un MÊME rendu (batch) → les deux, en ordre", () => {
    const mid = tvReducer(TV_SEED_STATE, {
      type: "ticket:called",
      payload: simulatedTicketCalled("A053", "Guichet 5"),
    });
    const next = tvReducer(mid, {
      type: "ticket:called",
      payload: simulatedTicketCalled("A054", "Guichet 6"),
    });
    const calls = liveCallsInTransition(TV_SEED_STATE, next);
    expect(calls.map((c) => c.ticketNumber)).toEqual(["A053", "A054"]);
  });
});

describe("useTvCallOverlay — overlay takeover + file + annonce", () => {
  function setup(options: { muted?: boolean } = {}) {
    const speech = spySpeech();
    const rendered = renderHook(
      ({ state }: { state: TvState }) =>
        useTvCallOverlay({
          state,
          locale: "fr",
          muted: options.muted ?? false,
          speech,
        }),
      { initialProps: { state: TV_SEED_STATE } }
    );
    return { ...rendered, speech };
  }

  function called(state: TvState, number: string, counter: string): TvState {
    return tvReducer(state, {
      type: "ticket:called",
      payload: simulatedTicketCalled(number, counter),
    });
  }

  it("TV-PUB: aucun overlay au montage (snapshot initial)", () => {
    const { result } = setup();
    act(() => vi.advanceTimersByTime(TV_OVERLAY_GAP_MS));
    expect(result.current.overlay).toBeNull();
  });

  it("TV-PUB: ticket:called → overlay plein centre, puis disparition après ~7 s", () => {
    const { result, rerender, speech } = setup();
    const next = called(TV_SEED_STATE, "A053", "Guichet 5");

    rerender({ state: next });
    act(() => vi.advanceTimersByTime(0));

    expect(result.current.overlay).toBe(next.hero);
    expect(result.current.closing).toBe(false);
    expect(speech.speak).toHaveBeenCalledTimes(1);

    // Fenêtre pleine visibilité → sortie fluide (closing) → retrait.
    act(() => vi.advanceTimersByTime(TV_OVERLAY_MS));
    expect(result.current.overlay).toBe(next.hero);
    expect(result.current.closing).toBe(true);
    act(() => vi.advanceTimersByTime(TV_OVERLAY_EXIT_MS));
    expect(result.current.overlay).toBeNull();
    expect(result.current.closing).toBe(false);
  });

  it("TV-PUB: la durée totale d'affichage reste dans la fenêtre PO 6-8 s", () => {
    expect(TV_OVERLAY_MS + TV_OVERLAY_EXIT_MS).toBeGreaterThanOrEqual(6000);
    expect(TV_OVERLAY_MS + TV_OVERLAY_EXIT_MS).toBeLessThanOrEqual(8000);
  });

  it("TV-PUB: annonce vocale construite « Ticket {épelé}, {guichet} » en FR", () => {
    const { rerender, speech } = setup();
    const next = called(TV_SEED_STATE, "A053", "Guichet 5");
    rerender({ state: next });
    act(() => vi.advanceTimersByTime(0));

    const utterance = speech.speak.mock.calls[0]?.[0] as FakeUtterance;
    expect(utterance.text).toBe(
      tvAnnouncementText(next.hero!.displayNumber, "Guichet 5", "fr")
    );
    expect(utterance.text).toContain("Ticket");
    expect(utterance.text).toContain("Guichet 5");
  });

  it("TV-PUB: ?muted=1 → overlay affiché mais AUCUNE annonce vocale", () => {
    const { result, rerender, speech } = setup({ muted: true });
    const next = called(TV_SEED_STATE, "A053", "Guichet 5");
    rerender({ state: next });
    act(() => vi.advanceTimersByTime(0));

    expect(result.current.overlay).toBe(next.hero);
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it("TV-PUB: appels enchaînés → FILE d'overlays, jamais de chevauchement", () => {
    const { result, rerender, speech } = setup();
    const first = called(TV_SEED_STATE, "A053", "Guichet 5");
    rerender({ state: first });
    act(() => vi.advanceTimersByTime(0));
    expect(result.current.overlay?.ticketNumber).toBe("A053");

    // Deuxième appel PENDANT l'overlay du premier → mis en file.
    const second = called(first, "A054", "Guichet 6");
    rerender({ state: second });
    act(() => vi.advanceTimersByTime(0));
    expect(result.current.overlay?.ticketNumber).toBe("A053");

    // Fin du premier (visibilité + sortie) → respiration → deuxième overlay.
    act(() => vi.advanceTimersByTime(TV_OVERLAY_MS + TV_OVERLAY_EXIT_MS));
    expect(result.current.overlay).toBeNull();
    act(() => vi.advanceTimersByTime(TV_OVERLAY_GAP_MS));
    expect(result.current.overlay?.ticketNumber).toBe("A054");
    expect(speech.speak).toHaveBeenCalledTimes(2);

    // Puis retrait final.
    act(() => vi.advanceTimersByTime(TV_OVERLAY_MS + TV_OVERLAY_EXIT_MS));
    expect(result.current.overlay).toBeNull();
  });

  it("TV-PUB: resync (sync:state) → aucun overlay ni annonce", () => {
    const { result, rerender, speech } = setup();
    const next = tvReducer(TV_SEED_STATE, { type: "sync:state", payload: syncPayload() });
    rerender({ state: next });
    act(() => vi.advanceTimersByTime(TV_OVERLAY_GAP_MS));

    expect(result.current.overlay).toBeNull();
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it("TV-PUB: démontage pendant un overlay → timers nettoyés (aucune fuite)", () => {
    const { rerender, unmount } = setup();
    rerender({ state: called(TV_SEED_STATE, "A053", "Guichet 5") });
    act(() => vi.advanceTimersByTime(0));
    unmount();
    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
  });
});

describe("parseTvMuted — réglage d'exploitation ?muted=1", () => {
  it("TV-PUB: ?muted=1 et ?muted=true coupent le son", () => {
    expect(parseTvMuted("?muted=1")).toBe(true);
    expect(parseTvMuted("?muted=true")).toBe(true);
  });

  it("TV-PUB: absent, vide ou autre valeur → son actif", () => {
    expect(parseTvMuted("")).toBe(false);
    expect(parseTvMuted("?foo=bar")).toBe(false);
    expect(parseTvMuted("?muted=0")).toBe(false);
  });
});
