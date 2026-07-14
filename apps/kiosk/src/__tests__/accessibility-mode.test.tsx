/**
 * KIOSK-008 — Tests TDD mode accessibilité (textes ≥ 34 px, contraste ≥ 7:1,
 * transition instantanée en prefers-reduced-motion, timeout doublé).
 * Écrits AVANT l'implémentation (phase rouge).
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Mock Web Speech API ────────────────────────────────────────────────────
beforeAll(() => {
  window.speechSynthesis = {
    speak: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: () => [
      { lang: "fr-FR", name: "fr-FR", default: false, localService: true, voiceURI: "fr-FR" },
    ] as SpeechSynthesisVoice[],
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
    .mockImplementation((text: string) => ({
      text,
      lang: "",
      rate: 1,
      voice: null,
    })) as unknown as typeof SpeechSynthesisUtterance;
});

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
  useParams: () => ({ locale: "fr" }),
  useSearchParams: () => new URLSearchParams(),
}));

import { TicketScreen } from "@/components/TicketScreen";
import {
  accessibilityFontSizePx,
  parseHexToRgb,
  contrastRatio,
} from "@/lib/kiosk-voice";

const frMessages = {
  ticket005: {
    eyebrow: "Votre ticket",
    position: "Position dans la file : {position}e",
    waitEstimate: "Attente estimée : {minutes} minutes",
    printing: "Votre ticket s'imprime...",
    smsSent: "SMS envoyé au {maskedPhone}",
    returning: "Retour automatique dans {seconds} s",
    finishButton: "Terminer",
    voiceAnnounce:
      "Ticket {displayNumber}. Vous êtes {position}e dans la file. Environ {minutes} minutes.",
    voiceAnnounceOffline:
      "Votre numéro est {displayNumber}. Position et attente estimées dès la reconnexion.",
    offlineBanner: "Mode hors connexion — ticket temporaire",
    offlineInfo: "Ticket local — synchronisation dès reconnexion",
    offlineEstimate: "Position et attente : estimation à la reconnexion",
    printerError: "Imprimante indisponible — un agent vous remettra votre ticket",
  },
  degraded007: {
    photographNumber: "Photographiez votre numéro ou recevez-le par SMS",
  },
  voice008: { playLabel: "Écouter" },
};

const defaultProps = { displayNumber: "A007", position: 4, estimatedWaitMinutes: 12 };

/** Lit les tokens hex depuis design-tokens.css (source de vérité). */
function readToken(name: string): string {
  const css = readFileSync(
    resolve(__dirname, "../lib/design-tokens.css"),
    "utf-8"
  );
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Token ${name} introuvable`);
  return match[1];
}

describe("KIOSK-008: mode accessibilité — textes ≥ 34 px", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("KIOSK-008: mode accessibilité → textes ≥ 34 px (snapshot CSS computed + Testing Library)", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} isAccessibilityMode={true} />
      </NextIntlClientProvider>
    );

    // Le texte de base (position/attente) est porté par le facteur d'accessibilité.
    const a11yTexts = container.querySelectorAll("[data-a11y-text='true']");
    expect(a11yTexts.length).toBeGreaterThan(0);
    a11yTexts.forEach((el) => {
      const px = parseFloat((el as HTMLElement).style.fontSize);
      expect(px).toBeGreaterThanOrEqual(34);
    });

    // Cohérence avec le helper (28 × 1.2 ≥ 34).
    expect(accessibilityFontSizePx()).toBeGreaterThanOrEqual(34);
  });

  it("KIOSK-008: mode nominal → base 28 px (non agrandi)", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} isAccessibilityMode={false} />
      </NextIntlClientProvider>
    );
    const a11yTexts = container.querySelectorAll("[data-a11y-text='true']");
    a11yTexts.forEach((el) => {
      const px = parseFloat((el as HTMLElement).style.fontSize);
      expect(px).toBe(28);
    });
  });
});

describe("KIOSK-008: contraste ≥ 7:1 en mode accessibilité", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("KIOSK-008: contraste ≥ 7:1 maintenu en mode accessibilité (axe-core)", () => {
    // WCAG contrast computé depuis les tokens réels (source design-tokens.css).
    // --ink-inverse sur --surface-kiosk = paire texte/fond en mode accessibilité.
    const ink = readToken("--ink-inverse");
    const surface = readToken("--surface-kiosk");

    const ratio = contrastRatio(parseHexToRgb(ink), parseHexToRgb(surface));
    expect(ratio).toBeGreaterThanOrEqual(7);

    // Le rendu accessibilité utilise strictement ces tokens haut-contraste.
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} isAccessibilityMode={true} />
      </NextIntlClientProvider>
    );
    const main = container.querySelector("main") as HTMLElement;
    expect(main.style.backgroundColor).toBe("var(--surface-kiosk)");
    const pos = screen.getByTestId("ticket-position");
    expect(pos.style.color).toBe("var(--ink-inverse)");
  });

  it("KIOSK-008: fonction contrastRatio conforme WCAG (blanc/noir = 21:1)", () => {
    const white = parseHexToRgb("#ffffff");
    const black = parseHexToRgb("#000000");
    expect(Math.round(contrastRatio(white, black))).toBe(21);
    // Symétrique.
    expect(contrastRatio(black, white)).toBeCloseTo(contrastRatio(white, black), 5);
  });
});

describe("KIOSK-008: prefers-reduced-motion → transition instantanée", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("KIOSK-008: prefers-reduced-motion actif → activation accessibilité instantanée (aucune transition)", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });

    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} isAccessibilityMode={true} />
      </NextIntlClientProvider>
    );

    const main = container.querySelector("main") as HTMLElement;
    // Aucune transition CSS inline sur le conteneur (transition instantanée).
    const t = main.style.transition;
    expect(t === "" || t === "none").toBe(true);
    // Et aucun élément avec transition résiduelle.
    expect(container.querySelectorAll("[style*='transition']").length).toBe(0);
  });
});

describe("KIOSK-008: retour accueil à 20 s au Moment Ticket (accessibilité — audit F9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("KIOSK-008: mode accessibilité → retour accueil à 20 s au Moment Ticket (Vitest fake-timer)", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} isAccessibilityMode={true} />
      </NextIntlClientProvider>
    );
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(mockPush).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(mockPush).toHaveBeenCalledWith("/fr");
  });

  it("KIOSK-008: mode accessibilité → SpeechSynthesisUtterance.rate = 0.8 au Moment Ticket (Vitest spy)", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...defaultProps} isAccessibilityMode={true} />
      </NextIntlClientProvider>
    );
    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1);
    const utt = (window.speechSynthesis.speak as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as SpeechSynthesisUtterance;
    expect(utt.rate).toBe(0.8);
  });
});
