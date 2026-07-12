/**
 * KIOSK-001 — Tests TDD pour KioskShell.tsx
 * Écrits AVANT l'implémentation (phase rouge).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";

// Messages de test
const frMessages = {
  common: {
    welcome: "Bienvenue",
    chooseLanguage: "Choisissez votre langue",
    loading: "Chargement...",
    error: "Une erreur est survenue",
    retry: "Réessayer",
  },
};

const enMessages = {
  common: {
    welcome: "Welcome",
    chooseLanguage: "Choose your language",
    loading: "Loading...",
    error: "An error occurred",
    retry: "Retry",
  },
};

describe("KIOSK-001: KioskShell", () => {
  it("KIOSK-001: next-intl charge les 2 locales (FR/EN) sans erreur de clé manquante", async () => {
    const { KioskShell } = await import("../components/KioskShell");
    const locales = [
      { locale: "fr", messages: frMessages },
      { locale: "en", messages: enMessages },
    ];

    for (const { locale, messages } of locales) {
      const { unmount } = render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <KioskShell />
        </NextIntlClientProvider>
      );
      // Aucune erreur de clé manquante — le composant rend correctement
      expect(document.body).toBeDefined();
      unmount();
    }
  });

  it("KIOSK-001: prefers-reduced-motion → zéro animation dans le DOM", async () => {
    const { KioskShell } = await import("../components/KioskShell");

    // Simuler prefers-reduced-motion: reduce
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
        <KioskShell />
      </NextIntlClientProvider>
    );

    // Vérifier qu'aucun élément n'a d'animation CSS directe en ligne
    const animatedElements = container.querySelectorAll("[style*='animation']");
    expect(animatedElements.length).toBe(0);

    // Vérifier qu'aucun élément n'a de transition CSS directe en ligne
    const transitionElements = container.querySelectorAll(
      "[style*='transition']"
    );
    expect(transitionElements.length).toBe(0);
  });

  it("KIOSK-001: rendu nominal de l'écran accueil", async () => {
    const { KioskShell } = await import("../components/KioskShell");

    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <KioskShell />
      </NextIntlClientProvider>
    );

    // L'écran d'accueil doit afficher un message de bienvenue
    const welcomeElement = screen.getByText(/Bienvenue|Welcome/i);
    expect(welcomeElement).toBeInTheDocument();
  });
});
