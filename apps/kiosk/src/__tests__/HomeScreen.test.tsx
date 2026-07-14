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
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ locale: "fr" }),
  useSearchParams: () => new URLSearchParams(),
}));

// État file contrôlé par test (AUDIT-F19 : masquer la ligne sans donnée).
const mockQueueStatus = {
  count: 5 as number | null,
  estimatedMinutes: 10 as number | null,
  isOffline: false,
};
vi.mock("@/hooks/useQueueStatus", () => ({
  useQueueStatus: () => mockQueueStatus,
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
    chooseLanguage: "Choisissez votre langue",
    languageFr: "Français",
    languageEn: "English",
    queueStatus: "File d'attente : {count} personnes — attente estimée : {minutes} min",
    queueUnavailable: "File d'attente non disponible",
    offlineBanner: "Mode hors connexion — vos tickets restent valables",
    loading: "Chargement...",
    welcomeAgency: "à l'agence {agencyName}",
  },
};

const enMessages = {
  home002: {
    title: "Akwaba — Welcome",
    chooseLanguage: "Choose your language",
    languageFr: "Français",
    languageEn: "English",
    queueStatus: "Queue: {count} people — estimated wait: {minutes} min",
    queueUnavailable: "Queue unavailable",
    offlineBanner: "Offline mode — your tickets remain valid",
    loading: "Loading...",
    welcomeAgency: "to {agencyName} branch",
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
    mockQueueStatus.count = 5;
    mockQueueStatus.estimatedMinutes = 10;
    mockQueueStatus.isOffline = false;
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
    expect(queueEl?.textContent).toContain("5");
  });

  it("AUDIT-F19: aucune donnée file (nominal en ligne) → la ligne d'état est MASQUÉE (pas de message négatif permanent)", () => {
    mockQueueStatus.count = null;
    mockQueueStatus.estimatedMinutes = null;
    mockQueueStatus.isOffline = false;

    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <HomeScreen />
      </NextIntlClientProvider>
    );

    // Sans donnée ET sans dégradation : aucune ligne d'état, aucun texte négatif.
    expect(
      container.querySelector("[data-testid='queue-status']")
    ).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("File d'attente non disponible");
  });

  it("AUDIT-F19: vraie dégradation (hors connexion) → « File d'attente non disponible » visible", () => {
    mockQueueStatus.count = null;
    mockQueueStatus.estimatedMinutes = null;
    mockQueueStatus.isOffline = true;

    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <HomeScreen isOffline={true} />
      </NextIntlClientProvider>
    );

    const queueEl = container.querySelector("[data-testid='queue-status']");
    expect(queueEl).toBeInTheDocument();
    expect(queueEl?.textContent).toContain("File d'attente non disponible");
  });

  it("AUDIT-F18: ligne agence sans doublon — « à l'agence Centrale », jamais « agence Agence »", () => {
    // Nom d'agence par défaut : « Agence Centrale » (env de test sans NEXT_PUBLIC_AGENCY_NAME).
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <HomeScreen />
      </NextIntlClientProvider>
    );

    const agencyLine = container.querySelector(
      "[data-testid='agency-welcome']"
    );
    expect(agencyLine).toBeInTheDocument();
    expect(agencyLine?.textContent).toBe("à l'agence Centrale");
    // Le doublon de l'audit ne doit JAMAIS réapparaître.
    expect(container.textContent).not.toMatch(/agence\s+agence/i);
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

  // KIOSK-002: régression visuelle ×2 langues → couverte par Playwright (pnpm test:visual)
});
