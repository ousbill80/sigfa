/**
 * Tests for tv-voice — annonce vocale de l'écran TV public : forme épelée du
 * numéro, texte d'annonce FR/EN, sélection de voix de QUALITÉ (pattern kiosque
 * reporté localement), speak best-effort (voiceschanged borné, cancel avant
 * speak, silence gracieux sans moteur).
 * @module components/tv/tv-voice.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  spellTicketNumber,
  tvAnnouncementText,
  pickTvVoice,
  speakTvAnnouncement,
  TV_VOICES_LOAD_TIMEOUT_MS,
  type TvSpeechSynthesisLike,
} from "./tv-voice";

/** Fabrique une voix de test (surface minimale castée). */
function voice(
  name: string,
  lang: string,
  extra: { localService?: boolean; default?: boolean } = {}
): SpeechSynthesisVoice {
  return {
    name,
    lang,
    localService: extra.localService ?? false,
    default: extra.default ?? false,
    voiceURI: name,
  } as SpeechSynthesisVoice;
}

/** Utterance de test capturant text/lang/voice. */
class FakeUtterance {
  text: string;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

beforeEach(() => {
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("spellTicketNumber — numéro épelé (forme la plus intelligible)", () => {
  it("TV-PUB: « OC-001 » est épelé « O C 0 0 1 » (tiret retiré)", () => {
    expect(spellTicketNumber("OC-001")).toBe("O C 0 0 1");
  });

  it("TV-PUB: numéro sans séparateur épelé caractère par caractère", () => {
    expect(spellTicketNumber("A47")).toBe("A 4 7");
  });

  it("TV-PUB: tous les séparateurs non alphanumériques sont retirés", () => {
    expect(spellTicketNumber("P 0/1.0")).toBe("P 0 1 0");
  });
});

describe("tvAnnouncementText — « Ticket {numéro épelé}, {guichet} »", () => {
  it("TV-PUB: FR — ticket + numéro épelé + libellé guichet du contrat", () => {
    expect(tvAnnouncementText("OC-001", "Guichet 3", "fr")).toBe(
      "Ticket O C 0 0 1, Guichet 3"
    );
  });

  it("TV-PUB: EN — même structure, libellé guichet inchangé", () => {
    expect(tvAnnouncementText("OC-047", "Guichet 1", "en")).toBe(
      "Ticket O C 0 4 7, Guichet 1"
    );
  });
});

describe("pickTvVoice — sélection de voix de qualité (pattern kiosque)", () => {
  it("TV-PUB: aucune voix disponible → null (dégradation silencieuse)", () => {
    expect(pickTvVoice("fr", [])).toBeNull();
  });

  it("TV-PUB: voix réputée (Thomas) préférée à une voix novelty (Fred)", () => {
    const fred = voice("Fred", "fr-FR");
    const thomas = voice("Thomas", "fr-FR");
    expect(pickTvVoice("fr", [fred, thomas])).toBe(thomas);
  });

  it("TV-PUB: correspondance exacte fr-FR préférée au simple préfixe fr-CA", () => {
    const ca = voice("Chantal", "fr-CA");
    const fr = voice("Ordinaire", "fr-FR");
    expect(pickTvVoice("fr", [ca, fr])).toBe(fr);
  });

  it("TV-PUB: novelty exacte perd contre une ordinaire en simple préfixe", () => {
    const noveltyExact = voice("Albert", "fr-FR");
    const ordinaryPrefix = voice("Chantal", "fr-CA");
    expect(pickTvVoice("fr", [noveltyExact, ordinaryPrefix])).toBe(ordinaryPrefix);
  });

  it("TV-PUB: indice premium (enhanced) départage deux voix exactes", () => {
    const plain = voice("Ordinaire", "fr-FR");
    const enhanced = voice("Ordinaire Enhanced", "fr-FR");
    expect(pickTvVoice("fr", [plain, enhanced])).toBe(enhanced);
  });

  it("TV-PUB: locale EN sans voix anglaise → repli FR documenté", () => {
    const amelie = voice("Amélie", "fr-FR");
    expect(pickTvVoice("en", [amelie])).toBe(amelie);
  });

  it("TV-PUB: aucune voix de la langue ni du repli FR → null", () => {
    const german = voice("Anna", "de-DE");
    expect(pickTvVoice("en", [german])).toBeNull();
  });

  it("TV-PUB: à score égal, localService puis default départagent", () => {
    const remote = voice("A", "fr-FR");
    const local = voice("B", "fr-FR", { localService: true });
    expect(pickTvVoice("fr", [remote, local])).toBe(local);
    const plain = voice("C", "fr-FR");
    const def = voice("D", "fr-FR", { default: true });
    expect(pickTvVoice("fr", [plain, def])).toBe(def);
  });
});

describe("speakTvAnnouncement — best-effort, jamais d'erreur", () => {
  function synthWith(voices: SpeechSynthesisVoice[]): TvSpeechSynthesisLike & {
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  } {
    return {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: () => voices,
    };
  }

  it("TV-PUB: parle avec la voix de qualité, lang fr-FR, cancel AVANT speak", () => {
    const thomas = voice("Thomas", "fr-FR");
    const synth = synthWith([voice("Fred", "fr-FR"), thomas]);
    const order: string[] = [];
    synth.cancel.mockImplementation(() => order.push("cancel"));
    synth.speak.mockImplementation(() => order.push("speak"));

    speakTvAnnouncement(synth, { locale: "fr", text: "Ticket O C 0 0 1, Guichet 3" });

    expect(order).toEqual(["cancel", "speak"]);
    const utterance = synth.speak.mock.calls[0]?.[0] as FakeUtterance;
    expect(utterance.text).toBe("Ticket O C 0 0 1, Guichet 3");
    expect(utterance.lang).toBe("fr-FR");
    expect(utterance.voice).toBe(thomas);
  });

  it("TV-PUB: synthèse absente (null) → silence gracieux, aucune erreur", () => {
    expect(() => speakTvAnnouncement(null, { locale: "fr", text: "x" })).not.toThrow();
    expect(() => speakTvAnnouncement(undefined, { locale: "fr", text: "x" })).not.toThrow();
  });

  it("TV-PUB: SpeechSynthesisUtterance indisponible → no-op silencieux", () => {
    vi.unstubAllGlobals();
    const synth = synthWith([]);
    expect(() => speakTvAnnouncement(synth, { locale: "fr", text: "x" })).not.toThrow();
    expect(synth.speak).not.toHaveBeenCalled();
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  });

  it("TV-PUB: speak() qui jette (autoplay bloqué avant interaction) → avalé + log", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const synth = synthWith([voice("Thomas", "fr-FR")]);
    synth.speak.mockImplementation(() => {
      throw new Error("not-allowed");
    });
    expect(() => speakTvAnnouncement(synth, { locale: "fr", text: "x" })).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("TV-PUB: voix en chargement asynchrone → attend voiceschanged puis parle", () => {
    const thomas = voice("Thomas", "fr-FR");
    let loaded: SpeechSynthesisVoice[] = [];
    const listeners: Array<() => void> = [];
    const synth: TvSpeechSynthesisLike & { speak: ReturnType<typeof vi.fn> } = {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: () => loaded,
      addEventListener: (_type, listener) => listeners.push(listener),
      removeEventListener: vi.fn(),
    };

    speakTvAnnouncement(synth, { locale: "fr", text: "Ticket A 1, Guichet 2" });
    expect(synth.speak).not.toHaveBeenCalled();

    loaded = [thomas];
    listeners.forEach((fire) => fire());

    expect(synth.speak).toHaveBeenCalledTimes(1);
    const utterance = synth.speak.mock.calls[0]?.[0] as FakeUtterance;
    expect(utterance.voice).toBe(thomas);
    // Un second voiceschanged tardif ne reparle pas (once).
    listeners.forEach((fire) => fire());
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it("TV-PUB: voiceschanged muet → parle quand même après le délai borné", () => {
    vi.useFakeTimers();
    const synth: TvSpeechSynthesisLike & { speak: ReturnType<typeof vi.fn> } = {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: () => [],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    speakTvAnnouncement(synth, { locale: "fr", text: "Ticket A 1, Guichet 2" });
    expect(synth.speak).not.toHaveBeenCalled();

    vi.advanceTimersByTime(TV_VOICES_LOAD_TIMEOUT_MS);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    const utterance = synth.speak.mock.calls[0]?.[0] as FakeUtterance;
    // Dégradé : pas de voix explicite, la lang cible reste posée.
    expect(utterance.voice).toBeNull();
    expect(utterance.lang).toBe("fr-FR");
  });
});
