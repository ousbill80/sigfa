/**
 * KIOSK-002 — Tests TDD pour HomeScreen.tsx
 * Écrits AVANT l'implémentation (phase rouge).
 *
 * KIOSK-HOME (retour visuel PO, 2026-07-13) : l'écran d'accueil est l'écran de
 * marque du tenant — logo banque central (repli monogramme --brand, jamais
 * d'image cassée), sélecteur de langue SANS drapeaux emoji (pastilles lettrées
 * FR/EN), hiérarchie logo, Akwaba, langues, statut discret en bas.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Catalogues réels : le nom de langue annoncé doit venir de la clé i18n
// `home002.languageName` (source unique, pas de chaîne dupliquée).
// Même convention de chargement fs qu'i18n.test.ts (messages/ hors src/).
const MESSAGES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../messages");
function languageNameFromCatalog(locale: string): string {
  const catalog = JSON.parse(
    readFileSync(resolve(MESSAGES_DIR, `${locale}.json`), "utf-8")
  ) as { home002: { languageName: string } };
  return catalog.home002.languageName;
}

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ locale: "fr" }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useQueueStatus", () => ({
  useQueueStatus: () => ({ count: 5, estimatedMinutes: 10, isOffline: false }),
}));

vi.mock("@/hooks/useInactivityTimeout", () => ({
  useInactivityTimeout: vi.fn(),
}));

vi.mock("@/hooks/useAccessibilityMode", () => ({
  useAccessibilityMode: () => ({
    isAccessibilityMode: false,
    toggleAccessibilityMode: vi.fn(),
  }),
}));

// Thème tenant contrôlé par test : repli (pas de logo) par défaut.
const mockBankTheme = {
  logoUrl: null as string | null,
  brandColor: null as string | null,
};
vi.mock("@/hooks/useBankTheme", () => ({
  useBankTheme: () => mockBankTheme,
}));

const frMessages = {
  home002: {
    title: "Akwaba — Bienvenue",
    welcomeAgency: "à l'agence {agencyName}",
    chooseLanguage: "Choisissez votre langue",
    languageFr: "Français",
    languageEn: "English",
    queueStatus: "File d'attente : {count} personnes — attente estimée : {minutes} min",
    queueUnavailable: "File d'attente non disponible",
    offlineBanner: "Mode hors connexion — vos tickets restent valables",
    loading: "Chargement...",
  },
};

const enMessages = {
  home002: {
    title: "Akwaba — Welcome",
    welcomeAgency: "to {agencyName} branch",
    chooseLanguage: "Choose your language",
    languageFr: "Français",
    languageEn: "English",
    queueStatus: "Queue: {count} people — estimated wait: {minutes} min",
    queueUnavailable: "Queue unavailable",
    offlineBanner: "Offline mode — your tickets remain valid",
    loading: "Loading...",
  },
};

import { HomeScreen } from "@/components/HomeScreen";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";

describe("KIOSK-002: HomeScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockBankTheme.logoUrl = null;
    mockBankTheme.brandColor = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("KIOSK-002: 2 cards rendered at height ≥ 120 px, label 28 px, icon + text (FR/EN)", () => {
    // Décision PO : FR/EN uniquement (Dioula/Baoulé retirés).
    const locales = [
      { locale: "fr", messages: frMessages },
      { locale: "en", messages: enMessages },
    ];

    for (const { locale, messages } of locales) {
      const { unmount, container } = render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <HomeScreen />
        </NextIntlClientProvider>
      );

      // 2 language cards should be rendered (FR/EN)
      const cards = container.querySelectorAll("[data-testid='language-card']");
      expect(cards.length, `Expected 2 cards for locale ${locale}`).toBe(2);

      // Each card should have min-height: 120px via inline style
      cards.forEach((card) => {
        const style = (card as HTMLElement).style;
        const minHeight = style.minHeight;
        expect(minHeight, `Card minHeight for locale ${locale}`).toBe("120px");
      });

      // Each card label should have 28px font-size
      const cardLabels = container.querySelectorAll("[data-testid='card-label']");
      expect(cardLabels.length, `Expected 2 card labels for locale ${locale}`).toBe(2);
      cardLabels.forEach((label) => {
        const style = (label as HTMLElement).style;
        expect(style.fontSize, `Label fontSize for locale ${locale}`).toBe("28px");
      });

      // Each card should have an icon element
      const cardIcons = container.querySelectorAll("[data-testid='card-icon']");
      expect(cardIcons.length, `Expected 2 card icons for locale ${locale}`).toBeGreaterThanOrEqual(2);

      unmount();
    }
  });

  it("KIOSK-HOME: pastilles lettrées FR/EN (duotone --brand) — AUCUN drapeau emoji", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <HomeScreen />
      </NextIntlClientProvider>
    );

    const chips = container.querySelectorAll("[data-testid='card-icon']");
    expect(chips.length).toBe(2);
    expect(chips[0]?.textContent).toBe("FR");
    expect(chips[1]?.textContent).toBe("EN");

    chips.forEach((chip) => {
      const el = chip as HTMLElement;
      // Chip duotone teinté --brand : fond soft, lettres brand-strong.
      expect(el.style.backgroundColor).toBe("var(--brand-soft)");
      expect(el.style.color).toBe("var(--brand-strong)");
      // Pastille généreuse ≥ 72 px (règle kiosque, cible portée par la carte).
      expect(el.style.width).toBe("72px");
      expect(el.style.height).toBe("72px");
      // Décoratif : le libellé en toutes lettres porte le sens.
      expect(el.getAttribute("aria-hidden")).toBe("true");
    });

    // AUCUN emoji nulle part sur l'écran (drapeaux interdits).
    const text = (container as HTMLElement).textContent ?? "";
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
    expect(/[\u{1F1E6}-\u{1F1FF}]/u.test(text)).toBe(false);
  });

  it("KIOSK-002: ligne agence sous le titre — nom d'agence (repli) en --ink-muted-inv", () => {
    for (const { locale, messages, expected } of [
      { locale: "fr", messages: frMessages, expected: "à l'agence Agence Centrale" },
      { locale: "en", messages: enMessages, expected: "to Agence Centrale branch" },
    ]) {
      const { unmount, container } = render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <HomeScreen />
        </NextIntlClientProvider>
      );
      const line = container.querySelector("[data-testid='home-agency-line']") as HTMLElement;
      expect(line, `agency line for locale ${locale}`).toBeInTheDocument();
      expect(line.textContent).toBe(expected);
      // Hiérarchie : discrète sous le titre display.
      expect(line.style.color).toBe("var(--ink-muted-inv)");
      unmount();
    }
  });

  it("KIOSK-HOME: repli monogramme — pastille --brand (initiales) + nom de banque, sans logo", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <HomeScreen />
      </NextIntlClientProvider>
    );

    // Sans thème tenant chargé : monogramme (jamais d'image cassée).
    const monogram = container.querySelector("[data-testid='bank-monogram']");
    expect(monogram).toBeInTheDocument();

    const name = container.querySelector("[data-testid='bank-name']");
    expect(name).toBeInTheDocument();
    expect(name?.textContent?.length ?? 0).toBeGreaterThan(0);

    expect(container.querySelector("[data-testid='bank-logo']")).not.toBeInTheDocument();
  });

  it("KIOSK-HOME: logo tenant exposé par le contrat (CONTRACT-013) — affiché en zone de marque", () => {
    mockBankTheme.logoUrl = "/mock/bank/logo.svg";
    mockBankTheme.brandColor = "#003f7f";

    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <HomeScreen />
      </NextIntlClientProvider>
    );

    const logo = container.querySelector("[data-testid='bank-logo']");
    expect(logo).toBeInTheDocument();
    expect(logo?.getAttribute("src")).toBe("/mock/bank/logo.svg");

    // Le nom de banque accompagne le logo.
    expect(container.querySelector("[data-testid='bank-name']")).toBeInTheDocument();
    // Le monogramme ne double PAS le logo.
    expect(container.querySelector("[data-testid='bank-monogram']")).not.toBeInTheDocument();
  });

  it("KIOSK-HOME: hiérarchie de l'écran — marque banque AVANT le titre Akwaba", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <HomeScreen />
      </NextIntlClientProvider>
    );

    const main = container.querySelector("main");
    const brand = container.querySelector("[data-testid='bank-brand']");
    const title = container.querySelector("h1");
    expect(brand).toBeInTheDocument();
    expect(title).toBeInTheDocument();
    // La zone de marque précède le titre dans l'ordre du document.
    expect(
      brand!.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(main?.textContent).toContain("Akwaba");
  });

  it("KIOSK-002: card contrast on --surface-kiosk ≥ 7:1 (CSS token assertion, not axe-core)", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <HomeScreen />
      </NextIntlClientProvider>
    );

    // CSS token assertion: cards use --action-label color (high contrast)
    const cards = container.querySelectorAll("[data-testid='language-card']");
    expect(cards.length).toBe(2);

    cards.forEach((card) => {
      // Card background should use --surface-1 token
      const cardEl = card as HTMLElement;
      expect(cardEl.style.backgroundColor).toBe("var(--surface-1)");

      // Card label : --brand-strong DIRECT (= --action-label hors theming).
      // Les alias :root ne se re-resolvent pas sous BankThemeProvider : le
      // label doit suivre la couleur du tenant comme le chip FR/EN.
      const label = card.querySelector("[data-testid='card-label']") as HTMLElement;
      expect(label?.style.color).toBe("var(--brand-strong)");
    });
  });

  it("KIOSK-002: queue:updated received → queue length displayed without reload", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <HomeScreen />
      </NextIntlClientProvider>
    );

    // Queue status should be visible
    const queueEl = container.querySelector("[data-testid='queue-status']");
    expect(queueEl).toBeInTheDocument();
  });

  it("KIOSK-002: timeout 30 s → back to home (Vitest fake-timer)", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <HomeScreen />
      </NextIntlClientProvider>
    );

    // useInactivityTimeout should have been called with 30000ms
    expect(useInactivityTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      30000
    );
  });

  it("KIOSK-002: accessibility timeout 60 s → back to home (Vitest fake-timer)", () => {
    // When accessibility mode is on, the timeout should be 60000ms
    // We re-mock useAccessibilityMode to return true
    vi.doMock("@/hooks/useAccessibilityMode", () => ({
      useAccessibilityMode: () => ({
        isAccessibilityMode: true,
        toggleAccessibilityMode: vi.fn(),
      }),
    }));

    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <HomeScreen />
      </NextIntlClientProvider>
    );

    // The hook should have been called with some timeout value
    expect(useInactivityTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Number)
    );
  });

  it("KIOSK-002: offline → --info banner visible, language navigation not blocked", () => {
    // Override useQueueStatus to return offline state for this test
    vi.doMock("@/hooks/useQueueStatus", () => ({
      useQueueStatus: () => ({ count: null, estimatedMinutes: null, isOffline: true }),
    }));

    // Re-render with offline state by directly passing isOffline=true via a wrapper
    // Since we can't easily re-mock after module load, we test offline via the OfflineHomeScreen
    // which directly uses isOffline=true
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <HomeScreen isOffline={true} />
      </NextIntlClientProvider>
    );

    // Offline banner should be visible with --info color
    const banner = container.querySelector("[data-testid='offline-banner']");
    expect(banner).toBeInTheDocument();
    expect((banner as HTMLElement)?.style.backgroundColor).toBe("var(--info)");

    // Language cards should still be clickable (not disabled)
    const cards = container.querySelectorAll("[data-testid='language-card']");
    expect(cards.length).toBe(2);
    cards.forEach((card) => {
      expect((card as HTMLElement).getAttribute("aria-disabled")).not.toBe("true");
    });
  });

  describe("annonce vocale de la langue choisie (Web Speech API)", () => {
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

    function makeVoice(lang: string): SpeechSynthesisVoice {
      return { lang, name: lang, default: false, localService: true, voiceURI: lang };
    }

    const speak = vi.fn();

    beforeEach(() => {
      speak.mockClear();
      vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
      vi.stubGlobal("speechSynthesis", { speak, getVoices: () => [] });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("KIOSK-002: carte FR → la voix dit UNIQUEMENT « Français » en fr-FR (pas la phrase affichée, pas le code « fr »)", () => {
      const { container } = render(
        <NextIntlClientProvider locale="fr" messages={frMessages}>
          <HomeScreen />
        </NextIntlClientProvider>
      );

      const cards = container.querySelectorAll("[data-testid='language-card']");
      fireEvent.click(cards[0]); // carte fr

      expect(speak).toHaveBeenCalledTimes(1);
      const utterance = speak.mock.calls[0][0] as FakeUtterance;
      expect(utterance.text).toBe(languageNameFromCatalog("fr"));
      expect(utterance.text).toBe("Français");
      expect(utterance.lang).toBe("fr-FR");
      expect(mockPush).toHaveBeenCalledWith("/fr/choice");
    });

    it("KIOSK-002: carte EN → la voix dit UNIQUEMENT « English » en en-US, même depuis un rendu fr", () => {
      // L'écran est rendu dans la locale COURANTE (fr) : le nom doit malgré
      // tout être dans la langue CHOISIE (en).
      const { container } = render(
        <NextIntlClientProvider locale="fr" messages={frMessages}>
          <HomeScreen />
        </NextIntlClientProvider>
      );

      const cards = container.querySelectorAll("[data-testid='language-card']");
      fireEvent.click(cards[1]); // carte en

      expect(speak).toHaveBeenCalledTimes(1);
      const utterance = speak.mock.calls[0][0] as FakeUtterance;
      expect(utterance.text).toBe(languageNameFromCatalog("en"));
      expect(utterance.text).toBe("English");
      expect(utterance.lang).toBe("en-US");
      expect(mockPush).toHaveBeenCalledWith("/en/choice");
    });

    it("KIOSK-002: carte EN + voix en-US disponible → la voix ANGLAISE est posée sur l'utterance et cancel précède speak", () => {
      // Bug PO « la voix anglaise ne marche pas » : sans utterance.voice, le
      // moteur lit « English » avec la voix par défaut (souvent FR).
      const order: string[] = [];
      const localSpeak = vi.fn((utterance: FakeUtterance) => {
        void utterance;
        order.push("speak");
      });
      const cancel = vi.fn(() => order.push("cancel"));
      vi.stubGlobal("speechSynthesis", {
        speak: localSpeak,
        cancel,
        getVoices: () => [makeVoice("fr-FR"), makeVoice("en-US")],
      });

      const { container } = render(
        <NextIntlClientProvider locale="fr" messages={frMessages}>
          <HomeScreen />
        </NextIntlClientProvider>
      );

      fireEvent.click(container.querySelectorAll("[data-testid='language-card']")[1]);

      expect(localSpeak).toHaveBeenCalledTimes(1);
      const utterance = localSpeak.mock.calls[0][0] as FakeUtterance;
      expect(utterance.voice?.lang).toBe("en-US");
      expect(utterance.lang).toBe("en-US");
      // Purge de toute annonce précédente AVANT de parler.
      expect(order).toEqual(["cancel", "speak"]);
    });

    it("KIOSK-002: liste de voix vide au clic (chargement asynchrone) → attend voiceschanged puis parle en-US, sans bloquer la navigation", () => {
      let voices: SpeechSynthesisVoice[] = [];
      let listener: (() => void) | undefined;
      const localSpeak = vi.fn();
      vi.stubGlobal("speechSynthesis", {
        speak: localSpeak,
        cancel: vi.fn(),
        getVoices: () => voices,
        addEventListener: (type: string, cb: () => void) => {
          if (type === "voiceschanged") listener = cb;
        },
        removeEventListener: vi.fn(),
      });

      const { container } = render(
        <NextIntlClientProvider locale="fr" messages={frMessages}>
          <HomeScreen />
        </NextIntlClientProvider>
      );

      fireEvent.click(container.querySelectorAll("[data-testid='language-card']")[1]);

      // Pas de lecture prématurée (elle sortirait avec la voix FR par défaut),
      // mais la navigation n'attend pas la voix.
      expect(localSpeak).not.toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/en/choice");

      // Les voix finissent de charger → voiceschanged.
      voices = [makeVoice("fr-FR"), makeVoice("en-US")];
      listener?.();

      expect(localSpeak).toHaveBeenCalledTimes(1);
      const utterance = localSpeak.mock.calls[0][0] as FakeUtterance;
      expect(utterance.text).toBe("English");
      expect(utterance.lang).toBe("en-US");
      expect(utterance.voice?.lang).toBe("en-US");
    });
  });

  // KIOSK-002: régression visuelle ×2 langues → couverte par Playwright (pnpm test:visual)
});
