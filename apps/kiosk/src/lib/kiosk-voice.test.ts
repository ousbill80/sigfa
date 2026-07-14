/**
 * KIOSK-008 — Tests TDD pour la logique de synthèse vocale + accessibilité.
 * Écrits AVANT l'implémentation (phase rouge).
 *
 * Couvre les critères EARS purs (indépendants du rendu React) :
 *   - registre SIGFA du texte annoncé,
 *   - mapping locale → BCP-47,
 *   - sélection de voix avec fallback FR (locale sans voix native),
 *   - rate ralentie en mode accessibilité,
 *   - facteurs de font-size et de timeout en accessibilité.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildVoiceAnnouncement,
  localeToBcp47,
  pickVoiceForLocale,
  speakInLocale,
  voiceRate,
  accessibilityFontSizePx,
  accessibilityTimeoutMs,
  ticketReturnDelayMs,
  A11Y_BASE_FONT_PX,
  A11Y_LINE_HEIGHT,
  NOMINAL_TICKET_RETURN_MS,
  A11Y_TICKET_RETURN_MS,
  VOICES_LOAD_TIMEOUT_MS,
} from "@/lib/kiosk-voice";

/** Fabrique une voix minimale conforme à SpeechSynthesisVoice. */
function makeVoice(lang: string, name = lang): SpeechSynthesisVoice {
  return {
    lang,
    name,
    default: false,
    localService: true,
    voiceURI: name,
  };
}

describe("KIOSK-008: registre SIGFA du texte annoncé", () => {
  it("KIOSK-008: texte annoncé suit le registre SIGFA (FR)", () => {
    const text = buildVoiceAnnouncement(
      { displayNumber: "A007", position: 4, estimatedWaitMinutes: 12 },
      (key, vars) => {
        expect(key).toBe("voiceAnnounce");
        expect(vars).toEqual({
          displayNumber: "A007",
          position: 4,
          minutes: 12,
        });
        return "Ticket A007. Vous êtes 4e dans la file. Environ 12 minutes.";
      }
    );
    expect(text).toContain("A007");
    expect(text).toContain("4");
    expect(text).toContain("12");
  });
});

describe("KIOSK-008: mapping locale → BCP-47", () => {
  it("KIOSK-008: fr → fr-FR, en → en-US", () => {
    expect(localeToBcp47("fr")).toBe("fr-FR");
    expect(localeToBcp47("en")).toBe("en-US");
  });

  it("KIOSK-008: locale sans voix native → fallback fr-FR", () => {
    // Décision PO : plus de Dioula/Baoulé. Toute locale hors table (ex. langue
    // ivoirienne sans TTS) retombe explicitement sur le repli FR.
    expect(localeToBcp47("es")).toBe("fr-FR");
    expect(localeToBcp47("de")).toBe("fr-FR");
  });

  it("KIOSK-008: locale inconnue → fallback fr-FR", () => {
    expect(localeToBcp47("xx")).toBe("fr-FR");
  });
});

describe("KIOSK-008: sélection de voix avec fallback FR", () => {
  it("KIOSK-008: voix de la locale cible sélectionnée si disponible (en)", () => {
    const voices = [makeVoice("fr-FR"), makeVoice("en-US")];
    const v = pickVoiceForLocale("en", voices);
    expect(v?.lang).toBe("en-US");
  });

  it("KIOSK-008: locale sans voix native → fallback voix FR", () => {
    const voices = [makeVoice("fr-FR"), makeVoice("en-US")];
    const v = pickVoiceForLocale("es", voices);
    expect(v?.lang).toBe("fr-FR");
  });

  it("KIOSK-008: seconde locale sans voix native → fallback voix FR", () => {
    const voices = [makeVoice("fr-FR"), makeVoice("en-US")];
    const v = pickVoiceForLocale("de", voices);
    expect(v?.lang).toBe("fr-FR");
  });

  it("KIOSK-008: aucune voix disponible → null, sans lever d'erreur", () => {
    expect(pickVoiceForLocale("es", [])).toBeNull();
  });

  it("KIOSK-008: correspondance de préfixe de langue (fr matche fr-CA)", () => {
    const voices = [makeVoice("fr-CA")];
    const v = pickVoiceForLocale("fr", voices);
    expect(v?.lang).toBe("fr-CA");
  });
});

describe("KIOSK-002: speakInLocale — voix explicite, voiceschanged, cancel", () => {
  /** Double minimal de SpeechSynthesisUtterance (jsdom ne l'expose pas). */
  class FakeUtterance {
    text: string;
    lang = "";
    rate = 1;
    voice: SpeechSynthesisVoice | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("KIOSK-002: voix en-US disponible → posée sur l'utterance (pas de repli FR)", () => {
    const speak = vi.fn();
    const synth = {
      speak,
      cancel: vi.fn(),
      getVoices: () => [makeVoice("fr-FR"), makeVoice("en-US")],
    } as unknown as SpeechSynthesis;

    speakInLocale(synth, { locale: "en", text: "English", rate: 1 });

    expect(speak).toHaveBeenCalledTimes(1);
    const utt = speak.mock.calls[0][0] as FakeUtterance;
    expect(utt.text).toBe("English");
    expect(utt.lang).toBe("en-US");
    expect(utt.voice?.lang).toBe("en-US");
  });

  it("KIOSK-002: cancel() appelé AVANT speak() (purge d'une annonce qui traîne)", () => {
    const order: string[] = [];
    const synth = {
      speak: vi.fn(() => order.push("speak")),
      cancel: vi.fn(() => order.push("cancel")),
      getVoices: () => [makeVoice("fr-FR")],
    } as unknown as SpeechSynthesis;

    speakInLocale(synth, { locale: "fr", text: "Français", rate: 1 });

    expect(order).toEqual(["cancel", "speak"]);
  });

  it("KIOSK-002: getVoices() vide au 1er appel → attend voiceschanged puis parle avec la voix en-US (pas de repli FR fautif)", () => {
    let voices: SpeechSynthesisVoice[] = [];
    let listener: (() => void) | undefined;
    const speak = vi.fn();
    const removeEventListener = vi.fn();
    const synth = {
      speak,
      cancel: vi.fn(),
      getVoices: () => voices,
      addEventListener: (type: string, cb: () => void) => {
        if (type === "voiceschanged") listener = cb;
      },
      removeEventListener,
    } as unknown as SpeechSynthesis;

    speakInLocale(synth, { locale: "en", text: "English", rate: 1 });

    // Liste pas encore chargée : on ne parle PAS (sinon voix FR par défaut).
    expect(speak).not.toHaveBeenCalled();
    expect(listener).toBeDefined();

    // Chargement asynchrone terminé → voiceschanged.
    voices = [makeVoice("fr-FR"), makeVoice("en-US")];
    listener?.();

    expect(speak).toHaveBeenCalledTimes(1);
    const utt = speak.mock.calls[0][0] as FakeUtterance;
    expect(utt.voice?.lang).toBe("en-US");
    expect(removeEventListener).toHaveBeenCalledWith("voiceschanged", listener);

    // L'écouteur ne rejoue pas (garde `done`).
    listener?.();
    vi.advanceTimersByTime(VOICES_LOAD_TIMEOUT_MS);
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it("KIOSK-002: voiceschanged ne vient jamais → parle quand même après le délai borné (dégradation, lang seul)", () => {
    const speak = vi.fn();
    const synth = {
      speak,
      cancel: vi.fn(),
      getVoices: () => [],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as SpeechSynthesis;

    speakInLocale(synth, { locale: "en", text: "English", rate: 1 });
    expect(speak).not.toHaveBeenCalled();

    vi.advanceTimersByTime(VOICES_LOAD_TIMEOUT_MS);

    expect(speak).toHaveBeenCalledTimes(1);
    const utt = speak.mock.calls[0][0] as FakeUtterance;
    expect(utt.lang).toBe("en-US");
    expect(utt.voice).toBeNull();
  });

  it("KIOSK-002: API partielle (ni addEventListener ni cancel) → parle immédiatement sans erreur", () => {
    const speak = vi.fn();
    const synth = { speak, getVoices: () => [] } as unknown as SpeechSynthesis;

    expect(() =>
      speakInLocale(synth, { locale: "fr", text: "Français", rate: 1 })
    ).not.toThrow();
    expect(speak).toHaveBeenCalledTimes(1);
    const utt = speak.mock.calls[0][0] as FakeUtterance;
    expect(utt.voice).toBeNull();
  });

  it("KIOSK-002: SpeechSynthesisUtterance absent → dégradation silencieuse (aucun speak)", () => {
    vi.unstubAllGlobals(); // retire le double d'utterance
    const speak = vi.fn();
    const synth = { speak, getVoices: () => [] } as unknown as SpeechSynthesis;

    expect(() =>
      speakInLocale(synth, { locale: "fr", text: "Français", rate: 1 })
    ).not.toThrow();
    expect(speak).not.toHaveBeenCalled();
  });
});

describe("KIOSK-008: rate ralentie en mode accessibilité", () => {
  it("KIOSK-008: rate = 1 en nominal", () => {
    expect(voiceRate(false)).toBe(1);
  });

  it("KIOSK-008: rate = 0.8 en accessibilité", () => {
    expect(voiceRate(true)).toBe(0.8);
  });
});

describe("KIOSK-008: font-size accessibilité", () => {
  it("KIOSK-008: base 28 px × 1.2 = 33.6 px (≥ 34 px arrondi supérieur)", () => {
    expect(A11Y_BASE_FONT_PX).toBe(28);
    expect(A11Y_LINE_HEIGHT).toBe(1.2);
    const computed = accessibilityFontSizePx();
    // 28 × 1.2 = 33.6 → arrondi supérieur = 34, doit être ≥ 34
    expect(computed).toBeGreaterThanOrEqual(34);
  });
});

describe("KIOSK-008: timeout doublé en accessibilité", () => {
  it("KIOSK-008: timeout nominal inchangé", () => {
    expect(accessibilityTimeoutMs(30000, false)).toBe(30000);
  });

  it("KIOSK-008: timeout doublé en accessibilité", () => {
    expect(accessibilityTimeoutMs(30000, true)).toBe(60000);
  });
});

describe("KIOSK-008: retour accueil Moment Ticket", () => {
  it("KIOSK-008: 4 s en nominal", () => {
    expect(NOMINAL_TICKET_RETURN_MS).toBe(4000);
    expect(ticketReturnDelayMs(false)).toBe(4000);
  });

  it("KIOSK-008: 8 s en accessibilité", () => {
    expect(A11Y_TICKET_RETURN_MS).toBe(8000);
    expect(ticketReturnDelayMs(true)).toBe(8000);
  });
});
