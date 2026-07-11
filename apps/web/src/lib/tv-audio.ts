/**
 * TV audio + voice helpers (TV-002).
 * Double gong via Web Audio API and spoken announcement via Web Speech API.
 * Both are best-effort: failures are logged and swallowed so the visual flash
 * is never blocked (EARS: moteur vocal indisponible → log + continue).
 * @module lib/tv-audio
 */
import type { Locale } from "./i18n";

/** Delay between the two gong tones (ms). */
export const GONG_GAP_MS = 350 as const;

/** Minimal oscillator surface used by {@link playDoubleGong}. */
export interface OscillatorLike {
  /** Connects the oscillator to a destination node. */
  connect: (destination: unknown) => void;
  /** Sets the tone frequency. */
  frequency: { value: number };
  /** Starts the oscillator at the given time. */
  start: (when?: number) => void;
  /** Stops the oscillator at the given time. */
  stop: (when?: number) => void;
}

/** Minimal gain node surface. */
export interface GainLike {
  /** Gain value (volume). */
  gain: { value: number };
  /** Connects the gain node to a destination. */
  connect: (destination: unknown) => void;
}

/** Minimal AudioContext surface used for testability. */
export interface AudioLike {
  /** Current audio clock time. */
  currentTime: number;
  /** Output node. */
  destination: unknown;
  /** Creates an oscillator node. */
  createOscillator: () => OscillatorLike;
  /** Creates a gain node. */
  createGain: () => GainLike;
}

/** Minimal SpeechSynthesis surface used for testability. */
export interface SpeechLike {
  /** Speaks the given utterance. */
  speak: (utterance: unknown) => void;
}

/**
 * Plays two distinct gong tones spaced by {@link GONG_GAP_MS} at the given volume.
 * @param ctx - Audio context (Web Audio or a test double).
 * @param volume - Volume 0–1 (tenant default 0.8).
 */
export function playDoubleGong(ctx: AudioLike, volume = 0.8): void {
  try {
    const now = ctx.currentTime;
    const tones = [660, 440];
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = volume;
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = now + (i * GONG_GAP_MS) / 1000;
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch (err) {
    // Best-effort : l'audio ne doit jamais bloquer le flash.
    console.error("[tv-audio] gong failed", err);
  }
}

/** Maps a SIGFA locale to a BCP-47 speech language tag. */
export function speechLang(locale: Locale): string {
  switch (locale) {
    case "en":
      return "en-US";
    // Dioula/Baoulé n'ont pas de voix de synthèse standard → repli FR.
    case "dioula":
    case "baoule":
    case "fr":
    default:
      return "fr-FR";
  }
}

/**
 * Builds the spoken announcement text for a call.
 * @param ticketNumber - Ticket number (ex. "A047").
 * @param counterLabel - Counter label (ex. "Guichet 3").
 * @param locale - Active locale.
 * @returns The announcement text.
 */
export function announcementText(ticketNumber: string, counterLabel: string, locale: Locale): string {
  if (locale === "en") return `Ticket ${ticketNumber}, ${counterLabel}`;
  return `Ticket ${ticketNumber}, ${counterLabel}`;
}

/**
 * Announces a call via the Web Speech API. Never throws: on failure the error
 * is logged and the caller continues (flash + gong maintained).
 * @param synth - Speech synthesis (Web Speech or a test double).
 * @param ticketNumber - Ticket number.
 * @param counterLabel - Counter label.
 * @param locale - Active locale.
 * @returns true if the announcement was dispatched, false otherwise.
 */
export function announceCall(
  synth: SpeechLike,
  ticketNumber: string,
  counterLabel: string,
  locale: Locale,
): boolean {
  try {
    const text = announcementText(ticketNumber, counterLabel, locale);
    const Ctor = (globalThis as { SpeechSynthesisUtterance?: new (t: string) => object })
      .SpeechSynthesisUtterance;
    const utterance = Ctor ? new Ctor(text) : { text, lang: speechLang(locale) };
    (utterance as { lang?: string }).lang = speechLang(locale);
    synth.speak(utterance);
    return true;
  } catch (err) {
    console.error("[tv-audio] speech failed", err);
    return false;
  }
}
