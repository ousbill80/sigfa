/**
 * MODEL-KIOSK-B — Tests TDD pour ChoiceScreen.tsx
 * Point d'entrée « Que souhaitez-vous ? » à 2 grandes cartes :
 *   - « Une opération »        → /{locale}/services  (parcours Phase A, existant)
 *   - « Voir mon conseiller »  → /{locale}/managers  (nouveau parcours conseiller)
 *
 * Écrits AVANT l'implémentation (phase rouge). Une décision par écran, cibles
 * ≥ 72 px, icônes SVG (zéro emoji), tokens uniquement, FR/EN, « ← Retour ».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";

const mockPush = vi.fn();
const mockBack = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useParams: () => ({ locale: "fr" }),
}));

vi.mock("@/hooks/useInactivityTimeout", () => ({
  useInactivityTimeout: vi.fn(),
}));

const frMessages = {
  choiceModelB: {
    title: "Que souhaitez-vous ?",
    backButton: "Retour",
    languageChosen: "Vous avez choisi Français",
    operationCard: "Une opération",
    operationHint: "Dépôt, retrait, virement…",
    managerCard: "Voir mon conseiller",
    managerHint: "Rencontrer un chargé de clientèle",
  },
};

const enMessages = {
  choiceModelB: {
    title: "What would you like to do?",
    backButton: "Back",
    languageChosen: "You have chosen English",
    operationCard: "An operation",
    operationHint: "Deposit, withdrawal, transfer…",
    managerCard: "See my advisor",
    managerHint: "Meet a relationship manager",
  },
};

import { ChoiceScreen } from "@/components/ChoiceScreen";

function renderScreen(locale = "fr", messages = frMessages) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ChoiceScreen />
    </NextIntlClientProvider>
  );
}

describe("MODEL-KIOSK-B: ChoiceScreen (point d'entrée 2 chemins)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("MODEL-KIOSK-B: affiche 2 cartes (opération + conseiller) FR/EN", () => {
    for (const { locale, messages } of [
      { locale: "fr", messages: frMessages },
      { locale: "en", messages: enMessages },
    ]) {
      const { unmount, container } = renderScreen(locale, messages);
      const cards = container.querySelectorAll("[data-choice-card]");
      expect(cards.length, `2 cartes ${locale}`).toBe(2);
      expect(screen.getByTestId("choice-operation")).toBeInTheDocument();
      expect(screen.getByTestId("choice-manager")).toBeInTheDocument();
      unmount();
    }
  });

  it("MODEL-KIOSK-B: cartes ≥ 72 px, icône SVG (zéro emoji)", () => {
    const { container } = renderScreen();
    const cards = container.querySelectorAll("[data-choice-card]");
    cards.forEach((card) => {
      const minH = parseInt((card as HTMLElement).style.minHeight, 10);
      expect(minH).toBeGreaterThanOrEqual(72);
    });
    const icons = container.querySelectorAll("[data-testid='choice-icon']");
    expect(icons.length).toBe(2);
    icons.forEach((icon) => {
      expect((icon as HTMLElement).querySelector("svg")).toBeInTheDocument();
      // Aucun emoji : le conteneur d'icône ne porte pas de texte.
      expect((icon as HTMLElement).textContent).toBe("");
    });
  });

  it("MODEL-KIOSK-B: « Une opération » → /{locale}/services", () => {
    renderScreen();
    fireEvent.click(screen.getByTestId("choice-operation"));
    expect(mockPush).toHaveBeenCalledWith("/fr/services");
  });

  it("MODEL-KIOSK-B: « Voir mon conseiller » → /{locale}/managers", () => {
    renderScreen();
    fireEvent.click(screen.getByTestId("choice-manager"));
    expect(mockPush).toHaveBeenCalledWith("/fr/managers");
  });

  it("MODEL-KIOSK-B: bouton retour ≥ 72 px → router.back()", () => {
    const { container } = renderScreen();
    const back = container.querySelector("[data-testid='choice-back-btn']") as HTMLElement;
    expect(back).toBeInTheDocument();
    expect(back.style.minHeight).toBe("72px");
    // ICONS-001 : icône SIGFA « retour » appariée au texte (plus de flèche glyphe).
    expect(back.querySelector("svg[data-icon='retour']")).toBeInTheDocument();
    fireEvent.click(back);
    expect(mockBack).toHaveBeenCalled();
  });

  it("MODEL-KIOSK-B: indique la langue choisie en phrase claire (FR/EN)", () => {
    for (const { locale, messages, expected } of [
      { locale: "fr", messages: frMessages, expected: "Vous avez choisi Français" },
      { locale: "en", messages: enMessages, expected: "You have chosen English" },
    ]) {
      const { unmount } = renderScreen(locale, messages);
      const note = screen.getByTestId("choice-language-note");
      expect(note, `phrase langue ${locale}`).toHaveTextContent(expected);
      expect(note.style.color).toBe("var(--ink-muted-inv)");
      unmount();
    }
  });

  it("MODEL-KIOSK-B: aucun emoji dans le rendu global", () => {
    const { container } = renderScreen();
    // Plage emoji la plus courante — aucun caractère ne doit apparaître.
    const emojiRegex = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(emojiRegex.test(container.textContent ?? "")).toBe(false);
  });

  // AUDIT-F23 : /choice était le SEUL écran sans identité banque — la marque
  // (BankBrandMark, repli monogramme sans logo provisionné) l'habille désormais.
  it("AUDIT-F23: la marque banque (BankBrandMark) est rendue sur l'écran de choix", () => {
    renderScreen();
    expect(screen.getByTestId("bank-brand")).toBeInTheDocument();
    // Le nom du tenant accompagne toujours la marque (repli démo : SIGFA).
    expect(screen.getByTestId("bank-name").textContent).toBe("SIGFA");
    // Sans logo provisionné → repli monogramme --brand (jamais d'image cassée).
    expect(screen.getByTestId("bank-monogram")).toBeInTheDocument();
  });
});
