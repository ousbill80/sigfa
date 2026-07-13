/**
 * KIOSK-008 — Tests TDD pour VoiceButton (bouton audio permanent).
 * Écrits AVANT l'implémentation (phase rouge).
 *
 * Critères couverts :
 *   - bouton audio ≥ 72×72 px présent (FR/EN), icône SIGFA « audio »,
 *   - clic → SpeechSynthesisUtterance déclenché dans la langue de session,
 *   - mode accessibilité → rate = 0.8 (Vitest spy),
 *   - locale sans voix native → fallback voix FR, zéro erreur visible/log.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";

interface FakeUtterance {
  text: string;
  lang: string;
  rate: number;
  voice: SpeechSynthesisVoice | null;
}

let lastUtterance: FakeUtterance | null = null;
const speakSpy = vi.fn();
let availableVoices: SpeechSynthesisVoice[] = [];

function makeVoice(lang: string): SpeechSynthesisVoice {
  return {
    lang,
    name: lang,
    default: false,
    localService: true,
    voiceURI: lang,
  };
}

beforeAll(() => {
  window.speechSynthesis = {
    speak: speakSpy,
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: () => availableVoices,
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as SpeechSynthesis;

  global.SpeechSynthesisUtterance = vi
    .fn()
    .mockImplementation((text: string) => {
      const u: FakeUtterance = { text, lang: "", rate: 1, voice: null };
      lastUtterance = u;
      return u;
    }) as unknown as typeof SpeechSynthesisUtterance;
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: mockLocale }),
}));

let mockLocale = "fr";

import { VoiceButton } from "@/components/VoiceButton";

const messagesByLocale: Record<string, Record<string, Record<string, string>>> = {
  fr: {
    ticket005: {
      voiceAnnounce:
        "Ticket {displayNumber}. Vous êtes {position}e dans la file. Environ {minutes} minutes.",
    },
    voice008: { playLabel: "Écouter" },
  },
  en: {
    ticket005: {
      voiceAnnounce:
        "Ticket {displayNumber}. You are {position} in the queue. About {minutes} minutes.",
    },
    voice008: { playLabel: "Listen" },
  },
  // Locale synthétique SANS voix TTS native (es) — sert à prouver le repli FR.
  es: {
    ticket005: {
      voiceAnnounce:
        "Ticket {displayNumber}. Position {position}. {minutes} minutes.",
    },
    voice008: { playLabel: "Écouter" },
  },
};

const defaultAnnouncement = {
  displayNumber: "A007",
  position: 4,
  estimatedWaitMinutes: 12,
};

beforeEach(() => {
  vi.clearAllMocks();
  lastUtterance = null;
  mockLocale = "fr";
  availableVoices = [makeVoice("fr-FR"), makeVoice("en-US")];
});

function renderButton(
  locale: string,
  props: Partial<React.ComponentProps<typeof VoiceButton>> = {}
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messagesByLocale[locale]}>
      <VoiceButton announcement={defaultAnnouncement} {...props} />
    </NextIntlClientProvider>
  );
}

describe("KIOSK-008: bouton audio permanent", () => {
  it("KIOSK-008: bouton audio ≥ 72 px présent sur tous les écrans (FR/EN)", () => {
    for (const locale of ["fr", "en"]) {
      mockLocale = locale;
      const { unmount } = renderButton(locale);
      const btn = screen.getByTestId("voice-button");
      expect(btn, `voice button for ${locale}`).toBeInTheDocument();
      expect(btn.style.minWidth, `minWidth for ${locale}`).toBe("72px");
      expect(btn.style.minHeight, `minHeight for ${locale}`).toBe("72px");
      // Icône SIGFA « audio » appariée à un label texte (règle icône+texte).
      expect(
        btn.querySelector("svg[data-icon='audio']"),
        `icône audio for ${locale}`,
      ).toBeInTheDocument();
      expect(btn.textContent, `label for ${locale}`).not.toBe("");
      unmount();
    }
  });

  it("KIOSK-008: SpeechSynthesisUtterance déclenché au clic avec texte correct (mock Web Speech API)", async () => {
    const user = userEvent.setup();
    renderButton("fr");
    await user.click(screen.getByTestId("voice-button"));

    expect(speakSpy).toHaveBeenCalledTimes(1);
    expect(lastUtterance?.text).toContain("A007");
    expect(lastUtterance?.text).toContain("4");
    expect(lastUtterance?.text).toContain("12");
    // Langue de session appliquée.
    expect(lastUtterance?.lang).toBe("fr-FR");
  });

  it("KIOSK-008: mode accessibilité → SpeechSynthesisUtterance.rate = 0.8 (Vitest spy)", async () => {
    const user = userEvent.setup();
    renderButton("fr", { isAccessibilityMode: true });
    await user.click(screen.getByTestId("voice-button"));

    expect(speakSpy).toHaveBeenCalledTimes(1);
    expect(lastUtterance?.rate).toBe(0.8);
  });

  it("KIOSK-008: mode nominal → rate = 1", async () => {
    const user = userEvent.setup();
    renderButton("fr");
    await user.click(screen.getByTestId("voice-button"));
    expect(lastUtterance?.rate).toBe(1);
  });

  it("KIOSK-008: locale sans voix native → fallback voix FR, zéro erreur visible", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    mockLocale = "es";
    renderButton("es");
    await user.click(screen.getByTestId("voice-button"));

    expect(speakSpy).toHaveBeenCalledTimes(1);
    // Utterance émise avec langue FR de repli (aucune voix native disponible).
    expect(lastUtterance?.lang).toBe("fr-FR");
    expect(lastUtterance?.voice?.lang).toBe("fr-FR");
    // Aucun log d'erreur côté client.
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("KIOSK-008: Web Speech API absente → clic sans erreur (dégradation silencieuse)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = window.speechSynthesis;
    // @ts-expect-error suppression volontaire pour simuler l'absence d'API
    delete window.speechSynthesis;

    const user = userEvent.setup();
    renderButton("fr");
    await user.click(screen.getByTestId("voice-button"));

    expect(errorSpy).not.toHaveBeenCalled();
    window.speechSynthesis = original;
    errorSpy.mockRestore();
  });
});
