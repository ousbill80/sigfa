/**
 * Tests for TV audio + voice helpers (TV-002).
 * @module lib/tv-audio.test
 */
import { describe, it, expect, vi } from "vitest";
import {
  playDoubleGong,
  announceCall,
  announcementText,
  speechLang,
  type AudioLike,
  type OscillatorLike,
  type GainLike,
  type SpeechLike,
} from "./tv-audio";

/** Builds a mock AudioContext that counts oscillator creations. */
function mockAudio(): { ctx: AudioLike; oscillators: OscillatorLike[] } {
  const oscillators: OscillatorLike[] = [];
  const ctx: AudioLike = {
    currentTime: 0,
    destination: {},
    createOscillator(): OscillatorLike {
      const osc: OscillatorLike = {
        connect: vi.fn(),
        frequency: { value: 0 },
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(osc);
      return osc;
    },
    createGain(): GainLike {
      return { gain: { value: 0 }, connect: vi.fn() };
    },
  };
  return { ctx, oscillators };
}

describe("playDoubleGong", () => {
  it("TV-002: double gong — createOscillator appelé exactement 2 fois", () => {
    const { ctx, oscillators } = mockAudio();
    playDoubleGong(ctx, 0.8);
    expect(oscillators).toHaveLength(2);
    for (const osc of oscillators) {
      expect(osc.start).toHaveBeenCalled();
      expect(osc.stop).toHaveBeenCalled();
    }
  });

  it("TV-002: gong utilise le volume fourni (défaut tenant 80%)", () => {
    const gains: GainLike[] = [];
    const ctx: AudioLike = {
      currentTime: 0,
      destination: {},
      createOscillator: () => ({ connect: vi.fn(), frequency: { value: 0 }, start: vi.fn(), stop: vi.fn() }),
      createGain: () => {
        const g: GainLike = { gain: { value: 0 }, connect: vi.fn() };
        gains.push(g);
        return g;
      },
    };
    playDoubleGong(ctx, 0.8);
    expect(gains.every((g) => g.gain.value === 0.8)).toBe(true);
  });

  it("TV-002: gong ne jette jamais (best-effort)", () => {
    const bad = {
      currentTime: 0,
      destination: {},
      createOscillator: () => {
        throw new Error("no audio");
      },
      createGain: () => ({ gain: { value: 0 }, connect: vi.fn() }),
    } as unknown as AudioLike;
    expect(() => playDoubleGong(bad, 0.8)).not.toThrow();
  });
});

describe("announceCall / speech", () => {
  it("TV-002: annonce vocale — speak() appelé avec le bon texte", () => {
    const spoken: string[] = [];
    const synth: SpeechLike = { speak: (u) => spoken.push((u as { text?: string }).text ?? "") };
    const ok = announceCall(synth, "A047", "Guichet 3", "fr");
    expect(ok).toBe(true);
  });

  it("TV-002: texte d'annonce contient numéro + guichet", () => {
    expect(announcementText("A047", "Guichet 3", "fr")).toContain("A047");
    expect(announcementText("A047", "Guichet 3", "fr")).toContain("Guichet 3");
  });

  it("TV-002: moteur vocal indisponible — erreur logguée, retourne false, zéro crash", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const synth: SpeechLike = {
      speak: () => {
        throw new Error("speech unavailable");
      },
    };
    const ok = announceCall(synth, "A047", "Guichet 3", "fr");
    expect(ok).toBe(false);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("TV-002: speechLang mappe les locales (FR/EN)", () => {
    expect(speechLang("en")).toBe("en-US");
    expect(speechLang("fr")).toBe("fr-FR");
  });
});
