/**
 * KIOSK-008 — Tests TDD pour useVoiceAnnouncement (branches de garde).
 * Couvre la dégradation silencieuse (API absente, aucune voix, locale par défaut).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

let mockParams: Record<string, string> | null = { locale: "fr" };
vi.mock("next/navigation", () => ({
  useParams: () => mockParams,
}));

import { useVoiceAnnouncement } from "@/hooks/useVoiceAnnouncement";

const messages = {
  ticket005: {
    voiceAnnounce:
      "Ticket {displayNumber}. Vous êtes {position}e dans la file. Environ {minutes} minutes.",
  },
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="fr" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

const input = { displayNumber: "A007", position: 4, estimatedWaitMinutes: 12 };

function makeVoice(lang: string): SpeechSynthesisVoice {
  return { lang, name: lang, default: false, localService: true, voiceURI: lang };
}

describe("KIOSK-008: useVoiceAnnouncement branches de garde", () => {
  beforeEach(() => {
    mockParams = { locale: "fr" };
    global.SpeechSynthesisUtterance = vi
      .fn()
      .mockImplementation((text: string) => ({ text, lang: "", rate: 1, voice: null })) as unknown as typeof SpeechSynthesisUtterance;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("KIOSK-008: API speechSynthesis absente → aucune erreur, pas d'appel", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = window.speechSynthesis;
    // @ts-expect-error simulation d'absence d'API
    delete window.speechSynthesis;

    const { result } = renderHook(() => useVoiceAnnouncement(false), { wrapper });
    expect(() => result.current.announce(input)).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();

    window.speechSynthesis = original;
  });

  it("KIOSK-008: SpeechSynthesisUtterance absent → dégradation silencieuse", () => {
    const speak = vi.fn();
    window.speechSynthesis = {
      speak,
      getVoices: () => [],
    } as unknown as SpeechSynthesis;
    const originalUtterance = global.SpeechSynthesisUtterance;
    // @ts-expect-error simulation d'absence du constructeur
    delete global.SpeechSynthesisUtterance;

    const { result } = renderHook(() => useVoiceAnnouncement(false), { wrapper });
    result.current.announce(input);
    expect(speak).not.toHaveBeenCalled();

    global.SpeechSynthesisUtterance = originalUtterance;
  });

  it("KIOSK-008: getVoices absent → aucune voix appliquée, speak quand même", () => {
    const speak = vi.fn();
    window.speechSynthesis = { speak } as unknown as SpeechSynthesis;

    const { result } = renderHook(() => useVoiceAnnouncement(false), { wrapper });
    result.current.announce(input);
    expect(speak).toHaveBeenCalledTimes(1);
    const utt = speak.mock.calls[0][0] as { voice: unknown };
    expect(utt.voice).toBeNull();
  });

  it("KIOSK-008: voix disponible → appliquée à l'utterance", () => {
    const speak = vi.fn();
    window.speechSynthesis = {
      speak,
      getVoices: () => [makeVoice("fr-FR")],
    } as unknown as SpeechSynthesis;

    const { result } = renderHook(() => useVoiceAnnouncement(true), { wrapper });
    result.current.announce(input);
    const utt = speak.mock.calls[0][0] as { voice: SpeechSynthesisVoice; rate: number };
    expect(utt.voice.lang).toBe("fr-FR");
    expect(utt.rate).toBe(0.8);
  });

  it("KIOSK-008: params null → locale par défaut fr", () => {
    mockParams = null;
    const speak = vi.fn();
    window.speechSynthesis = {
      speak,
      getVoices: () => [makeVoice("fr-FR")],
    } as unknown as SpeechSynthesis;

    const { result } = renderHook(() => useVoiceAnnouncement(false), { wrapper });
    result.current.announce(input);
    const utt = speak.mock.calls[0][0] as { lang: string };
    expect(utt.lang).toBe("fr-FR");
  });
});
