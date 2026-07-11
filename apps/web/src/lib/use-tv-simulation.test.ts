/**
 * Tests for useTvSimulation (TV-002 effects + resync + burst).
 * @module lib/use-tv-simulation.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTvSimulation, TV_FLASH_MS } from "./use-tv-simulation";
import type { AudioLike, OscillatorLike, GainLike, SpeechLike } from "./tv-audio";
import { initialTvState } from "./tv-state";
import { simulatedTicketCalled } from "./tv-fixtures";

function makeAudio(): { factory: () => AudioLike; oscCount: () => number } {
  let count = 0;
  const factory = (): AudioLike => ({
    currentTime: 0,
    destination: {},
    createOscillator: (): OscillatorLike => {
      count++;
      return { connect: vi.fn(), frequency: { value: 0 }, start: vi.fn(), stop: vi.fn() };
    },
    createGain: (): GainLike => ({ gain: { value: 0 }, connect: vi.fn() }),
  });
  return { factory, oscCount: () => count };
}

function makeSpeech(): { speech: SpeechLike; spoken: string[] } {
  const spoken: string[] = [];
  return { speech: { speak: (u) => spoken.push((u as { text?: string }).text ?? "") }, spoken };
}

describe("useTvSimulation — TV-002 effects", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("TV-002: flash brand 2s déclenché à chaque ticket:called", () => {
    const { factory } = makeAudio();
    const { result } = renderHook(() =>
      useTvSimulation({ seed: initialTvState, audioFactory: factory, speech: null }),
    );
    expect(result.current.celebration).toBe(false);
    act(() => {
      result.current.callTicket(simulatedTicketCalled("A053", "Guichet 5"));
    });
    expect(result.current.celebration).toBe(true);
    act(() => {
      vi.advanceTimersByTime(TV_FLASH_MS);
    });
    expect(result.current.celebration).toBe(false);
  });

  it("TV-002: double gong joué — createOscillator × 2", () => {
    const { factory, oscCount } = makeAudio();
    const { result } = renderHook(() =>
      useTvSimulation({ seed: initialTvState, audioFactory: factory, speech: null }),
    );
    act(() => {
      result.current.callTicket(simulatedTicketCalled("A053", "Guichet 5"));
    });
    expect(oscCount()).toBe(2);
  });

  it("TV-002: annonce vocale déclenchée avec le bon texte", () => {
    const { factory } = makeAudio();
    const { speech, spoken } = makeSpeech();
    const { result } = renderHook(() =>
      useTvSimulation({ seed: initialTvState, audioFactory: factory, speech }),
    );
    act(() => {
      result.current.callTicket(simulatedTicketCalled("A053", "Guichet 5"));
    });
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toContain("A053");
    expect(spoken[0]).toContain("Guichet 5");
  });

  it("TV-002: burst 2 événements <500ms — file locale, 2 annonces séquentielles, zéro superposition", () => {
    const { factory } = makeAudio();
    const { speech, spoken } = makeSpeech();
    const { result } = renderHook(() =>
      useTvSimulation({ seed: initialTvState, audioFactory: factory, speech }),
    );
    act(() => {
      result.current.callTicket(simulatedTicketCalled("A053", "Guichet 5"));
      result.current.callTicket(simulatedTicketCalled("A054", "Guichet 6"));
    });
    // Only the first plays immediately (no overlap).
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toContain("A053");
    // Second plays after the flash window elapses.
    act(() => {
      vi.advanceTimersByTime(TV_FLASH_MS);
    });
    expect(spoken).toHaveLength(2);
    expect(spoken[1]).toContain("A054");
  });

  it("TV-002: moteur vocal indisponible — flash+gong maintenus, zéro crash", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { factory, oscCount } = makeAudio();
    const failingSpeech: SpeechLike = {
      speak: () => {
        throw new Error("no speech");
      },
    };
    const { result } = renderHook(() =>
      useTvSimulation({ seed: initialTvState, audioFactory: factory, speech: failingSpeech }),
    );
    act(() => {
      result.current.callTicket(simulatedTicketCalled("A053", "Guichet 5"));
    });
    expect(result.current.celebration).toBe(true);
    expect(oscCount()).toBe(2);
    errSpy.mockRestore();
  });

  it("TV-002: prefers-reduced-motion — flash désactivé, gong+voix maintenus", () => {
    const { factory, oscCount } = makeAudio();
    const { speech, spoken } = makeSpeech();
    const { result } = renderHook(() =>
      useTvSimulation({ seed: initialTvState, audioFactory: factory, speech, reducedMotion: true }),
    );
    act(() => {
      result.current.callTicket(simulatedTicketCalled("A053", "Guichet 5"));
    });
    expect(result.current.celebration).toBe(false);
    expect(oscCount()).toBe(2);
    expect(spoken).toHaveLength(1);
  });
});

describe("useTvSimulation — resync & connection", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("TV-002: offline → reconnexion → sync:state.recentCalls reconstruit sans flash ni gong", () => {
    const { factory, oscCount } = makeAudio();
    const { result } = renderHook(() =>
      useTvSimulation({ seed: initialTvState, audioFactory: factory, speech: null }),
    );
    act(() => result.current.setConnection("offline"));
    expect(result.current.state.connection).toBe("offline");

    const syncPayload: unknown = {
      agencyId: "cccccccc-cccc-4ccc-accc-cccccccccccc",
      queues: [],
      counters: [],
      recentCalls: [
        { ticketNumber: "A047", displayNumber: "OC-047", counterLabel: "Guichet 3", calledAt: "2026-07-11T09:30:00Z" },
        { ticketNumber: "A046", displayNumber: "OC-046", counterLabel: "Guichet 1", calledAt: "2026-07-11T09:29:00Z" },
        { ticketNumber: "B012", displayNumber: "OC-012", counterLabel: "Guichet 4", calledAt: "2026-07-11T09:28:00Z" },
        { ticketNumber: "A045", displayNumber: "OC-045", counterLabel: "Guichet 2", calledAt: "2026-07-11T09:27:00Z" },
      ],
      timestamp: "2026-07-11T09:30:05Z",
    };
    act(() => {
      result.current.resync(syncPayload);
      result.current.setConnection("connected");
    });
    // 4 derniers appels reconstruits (hero + 3 previous)
    expect(result.current.state.hero?.displayNumber).toBe("OC-047");
    expect(result.current.state.previous).toHaveLength(3);
    // Aucun flash, aucun gong sur resync
    expect(result.current.celebration).toBe(false);
    expect(oscCount()).toBe(0);
  });
});
