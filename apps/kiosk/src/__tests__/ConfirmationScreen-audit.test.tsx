/**
 * AUDIT-BORNE 2026-07-14 — Tests TDD (phase rouge) pour l'écran Confirmation.
 *
 * F2 (P1) : tout le contenu décisionnel tient au-dessus du pli à 1920×1080 ET
 *           1024×768 — zéro scroll (main 100dvh + overflow hidden, pavé en
 *           rangées minmax(72px, 1fr), actions dans la colonne décision).
 * F3 (P1) : bouton Retour commun (IconRetour + texte, cible ≥ 72 px) vers
 *           l'étape précédente (router.back()).
 * F13 (P2, partiel) : bascule « Texte plus grand » honnête — état visuel non
 *           ambigu (aria-pressed + fond --gold + badge « Activé »), le texte
 *           grandit RÉELLEMENT, timeout d'inactivité doublé (30 s → 60 s).
 * F15 (P2) : la VALEUR du SMS expliquée AVANT le clavier + consentement
 *           visible dès le départ (désactivé tant que le numéro est vide).
 * F17 (P3) : le champ téléphone hérite la police du kiosque (fin du
 *           monospace navigateur).
 * F23 (P3) : touche « * » morte retirée du clavier (11 touches, « 0 » élargi).
 * Piste A : l'erreur téléphone utilise --danger-inv (≥ 7:1 sur --night),
 *           plus jamais --danger (3.40:1).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";

const mockPush = vi.fn();
const mockBack = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useParams: () => ({ locale: "fr" }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useInactivityTimeout", () => ({
  useInactivityTimeout: vi.fn(),
}));

// PAS de mock de useAccessibilityMode : la bascule réelle (sessionStorage) est
// le comportement sous test (état visible + persistance).

import { ConfirmationScreen } from "@/components/ConfirmationScreen";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";

const frMessages = {
  confirmation004: {
    title: "Votre numéro de téléphone (facultatif)",
    smsValue: "Recevez votre position par SMS — suivez la file sans rester debout",
    phonePrefix: "+225",
    phonePlaceholder: "07 __ __ __ __ __",
    smsConsent: "J'accepte de recevoir mon ticket par SMS (optionnel)",
    ctaButton: "PRENDRE MON TICKET",
    skipButton: "Passer (sans numéro de téléphone)",
    errorPhone: "Il manque votre numéro — ou touchez Passer",
    loadingMessage: "Émission de votre ticket...",
    offlineBanner: "Mode hors connexion — ticket local généré",
    managerReminder: "Vous verrez : {name}",
    backButton: "Retour",
    largerTextButton: "Texte plus grand",
    largerTextOn: "Activé",
  },
  degraded007: {
    systemError:
      "Un problème est survenu. Adressez-vous à l'accueil, on s'occupe de vous.",
  },
};

const enMessages = {
  confirmation004: {
    ...frMessages.confirmation004,
    title: "Your phone number (optional)",
    smsValue: "Get your queue position by SMS — follow the line without standing in it",
    backButton: "Back",
    largerTextButton: "Larger text",
    largerTextOn: "On",
  },
  degraded007: {
    systemError:
      "Something went wrong. Please see reception, we will take care of you.",
  },
};

function renderScreen(locale = "fr", messages: typeof frMessages = frMessages) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
    </NextIntlClientProvider>
  );
}

function pressKey(container: HTMLElement, label: string) {
  const keys = container.querySelectorAll("[data-testid='keypad-key']");
  const key = Array.from(keys).find((k) => k.textContent === label);
  expect(key, `touche ${label}`).toBeDefined();
  fireEvent.click(key!);
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

// ─── F3 — Bouton Retour ───────────────────────────────────────────────────────

describe("AUDIT-F3: ConfirmationScreen — bouton Retour (le client n'est plus piégé)", () => {
  it("AUDIT-F3: bouton Retour rendu — icône IconRetour APPARIÉE au texte, cible ≥ 72 px", () => {
    renderScreen();
    const backBtn = screen.getByTestId("confirmation-back-btn");
    expect(backBtn).toBeInTheDocument();
    expect(backBtn.textContent).toContain("Retour");
    // Icône + texte appariés (règle DS §8) : un SVG dans le bouton.
    expect(backBtn.querySelector("svg")).not.toBeNull();
    // Cible tactile ≥ 72 px.
    expect((backBtn as HTMLElement).style.minWidth).toBe("72px");
    expect((backBtn as HTMLElement).style.minHeight).toBe("72px");
  });

  it("AUDIT-F3: toucher Retour → router.back() (retour à l'étape précédente)", () => {
    renderScreen();
    fireEvent.click(screen.getByTestId("confirmation-back-btn"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("AUDIT-F3: libellé EN « Back » (FR/EN)", () => {
    renderScreen("en", enMessages);
    expect(screen.getByTestId("confirmation-back-btn").textContent).toContain(
      "Back"
    );
  });
});

// ─── F2 — Tout au-dessus du pli, zéro scroll ─────────────────────────────────

describe("AUDIT-F2: ConfirmationScreen — contenu décisionnel au-dessus du pli (zéro scroll)", () => {
  it("AUDIT-F2: main verrouillé à la hauteur d'écran — height 100dvh + overflow hidden (une borne ne scrolle pas)", () => {
    renderScreen();
    const main = screen.getByRole("main");
    expect(main.style.height).toBe("100dvh");
    expect(main.style.overflow).toBe("hidden");
  });

  it("AUDIT-F2: pavé numérique en rangées bornées minmax(72px, 1fr) — compressible sans jamais passer sous 72 px", () => {
    const { container } = renderScreen();
    const keypad = container.querySelector(
      "[data-testid='keypad']"
    ) as HTMLElement;
    expect(keypad).toBeInTheDocument();
    expect(keypad.style.gridTemplateRows).toBe("repeat(4, minmax(72px, 1fr))");
    // Le pavé ne force plus la hauteur du flux (fin du débordement F2).
    expect(keypad.style.minHeight).toBe("0px");
  });

  it("AUDIT-F2: le choix principal (PRENDRE MON TICKET + Passer) vit dans la zone d'actions de la colonne décision", () => {
    const { container } = renderScreen();
    const actions = container.querySelector(
      "[data-testid='decision-actions']"
    ) as HTMLElement;
    expect(actions).toBeInTheDocument();
    expect(
      actions.querySelector("[data-testid='cta-btn']")
    ).toBeInTheDocument();
    expect(
      actions.querySelector("[data-testid='skip-btn']")
    ).toBeInTheDocument();
    // Le chemin MAJORITAIRE (sans téléphone) garde une cible ≥ 72 px.
    const skip = actions.querySelector(
      "[data-testid='skip-btn']"
    ) as HTMLElement;
    expect(skip.style.minHeight).toBe("72px");
  });
});

// ─── F13 (partiel) — bascule « Texte plus grand » honnête ────────────────────

describe("AUDIT-F13: ConfirmationScreen — bascule « Texte plus grand » à état visible", () => {
  it("AUDIT-F13: libellé honnête « Texte plus grand » + icône appariée, état repos non pressé", () => {
    renderScreen();
    const toggle = screen.getByTestId("accessibility-toggle");
    expect(toggle.textContent).toContain("Texte plus grand");
    expect(toggle.querySelector("svg")).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByTestId("accessibility-toggle-state")
    ).not.toBeInTheDocument();
    // Cible ≥ 72 px.
    expect((toggle as HTMLElement).style.minHeight).toBe("72px");
  });

  it("AUDIT-F13: activation → état visuel NON ambigu (aria-pressed, fond --gold contrasté, badge « Activé ») + persistance session", () => {
    renderScreen();
    const toggle = screen.getByTestId("accessibility-toggle");
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect((toggle as HTMLElement).style.backgroundColor).toBe("var(--gold)");
    const badge = screen.getByTestId("accessibility-toggle-state");
    expect(badge.textContent).toBe("Activé");
    // Persistance (même comportement que les autres écrans).
    expect(sessionStorage.getItem("kiosk_accessibility_mode")).toBe("true");

    // Désactivation → retour à l'état repos, sans ambiguïté.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByTestId("accessibility-toggle-state")
    ).not.toBeInTheDocument();
  });

  it("AUDIT-F13: le texte grandit RÉELLEMENT (libellé honnête) — saisie téléphone 24 px → 30 px", () => {
    const { container } = renderScreen();
    const phoneInput = container.querySelector(
      "[data-testid='phone-input']"
    ) as HTMLElement;
    expect(phoneInput.style.fontSize).toBe("24px");

    fireEvent.click(screen.getByTestId("accessibility-toggle"));
    expect(phoneInput.style.fontSize).toBe("30px");
  });

  it("AUDIT-F13: timeout d'inactivité doublé en mode accessibilité — 30 s → 60 s", () => {
    sessionStorage.setItem("kiosk_accessibility_mode", "true");
    renderScreen();
    const calls = vi.mocked(useInactivityTimeout).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][1]).toBe(60000);
  });

  it("AUDIT-F13: timeout nominal 30 s hors mode accessibilité", () => {
    renderScreen();
    const calls = vi.mocked(useInactivityTimeout).mock.calls;
    expect(calls[calls.length - 1][1]).toBe(30000);
  });

  it("AUDIT-F13: libellés EN « Larger text » / « On » (FR/EN)", () => {
    renderScreen("en", enMessages);
    const toggle = screen.getByTestId("accessibility-toggle");
    expect(toggle.textContent).toContain("Larger text");
    fireEvent.click(toggle);
    expect(screen.getByTestId("accessibility-toggle-state").textContent).toBe(
      "On"
    );
  });
});

// ─── F15 — La VALEUR du SMS expliquée AVANT le clavier ──────────────────────

describe("AUDIT-F15: ConfirmationScreen — le pourquoi du SMS avant le clavier", () => {
  it("AUDIT-F15: sous-titre de valeur permanent (« Recevez votre position par SMS… ») rendu dès l'arrivée, texte ≥ 24 px, ≥ 7:1", () => {
    renderScreen();
    const value = screen.getByTestId("sms-value");
    expect(value.textContent).toBe(
      "Recevez votre position par SMS — suivez la file sans rester debout"
    );
    // Texte porteur de sens : plancher 24 px (CLAUDE.md §8).
    expect((value as HTMLElement).style.fontSize).toBe("24px");
    // Contraste ≥ 7:1 sur --night : encre inverse, jamais un token « soft ».
    expect((value as HTMLElement).style.color).toBe("var(--ink-inverse)");
  });

  it("AUDIT-F15: consentement SMS visible DÈS LE DÉPART — case désactivée tant que le numéro est vide", () => {
    const { container } = renderScreen();
    const consent = container.querySelector(
      "[data-testid='sms-consent']"
    ) as HTMLElement;
    expect(consent).toBeInTheDocument();
    const checkbox = consent.querySelector(
      "input[type='checkbox']"
    ) as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);

    // Un chiffre saisi → la case devient activable.
    pressKey(container, "0");
    expect(checkbox.disabled).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  it("AUDIT-F15: sous-titre de valeur EN (FR/EN)", () => {
    renderScreen("en", enMessages);
    expect(screen.getByTestId("sms-value").textContent).toBe(
      "Get your queue position by SMS — follow the line without standing in it"
    );
  });
});

// ─── F17 — Le champ hérite la police du kiosque ──────────────────────────────

describe("AUDIT-F17: ConfirmationScreen — fin du monospace navigateur", () => {
  it("AUDIT-F17: input téléphone en font-family inherit (police kiosque, pas monospace)", () => {
    const { container } = renderScreen();
    const phoneInput = container.querySelector(
      "[data-testid='phone-input']"
    ) as HTMLElement;
    expect(phoneInput.style.fontFamily).toBe("inherit");
  });
});

// ─── F23 — Touche « * » morte retirée ────────────────────────────────────────

describe("AUDIT-F23: ConfirmationScreen — clavier sans touche morte", () => {
  it("AUDIT-F23: la touche « * » n'existe plus — 11 touches (0-9 + effacement)", () => {
    const { container } = renderScreen();
    const keys = Array.from(
      container.querySelectorAll("[data-testid='keypad-key']")
    );
    expect(keys.length).toBe(11);
    expect(keys.find((k) => k.textContent === "*")).toBeUndefined();
    // Toutes les touches restantes servent : 0-9 + ⌫.
    const labels = keys.map((k) => k.textContent);
    for (const d of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫"]) {
      expect(labels).toContain(d);
    }
  });

  it("AUDIT-F23: « 0 » élargi sur 2 colonnes (grille 3×4 sans trou)", () => {
    const { container } = renderScreen();
    const zero = Array.from(
      container.querySelectorAll("[data-testid='keypad-key']")
    ).find((k) => k.textContent === "0") as HTMLElement;
    expect(zero.style.gridColumn).toBe("span 2");
  });

  it("AUDIT-F23: le clavier reste fonctionnel — 10 chiffres saisis, ⌫ efface", () => {
    const { container } = renderScreen();
    const phoneInput = container.querySelector(
      "[data-testid='phone-input']"
    ) as HTMLInputElement;
    for (const d of ["0", "7", "0", "7"]) pressKey(container, d);
    expect(phoneInput.value).toBe("0707");
    pressKey(container, "⌫");
    expect(phoneInput.value).toBe("070");
  });
});

// ─── Piste A — erreur téléphone lisible sur nuit ─────────────────────────────

describe("AUDIT-PISTE-A: ConfirmationScreen — erreur téléphone en --danger-inv", () => {
  it("AUDIT-PISTE-A: l'erreur téléphone est rendue en --danger-inv (≥ 7:1 sur --night), plus jamais --danger (3.40:1)", async () => {
    const { container } = renderScreen();
    // Saisie invalide (1 chiffre) puis CTA → erreur inline.
    pressKey(container, "1");
    fireEvent.click(container.querySelector("[data-testid='cta-btn']")!);

    await waitFor(() => {
      expect(
        container.querySelector("[data-testid='phone-error']")
      ).toBeInTheDocument();
    });
    const error = container.querySelector(
      "[data-testid='phone-error']"
    ) as HTMLElement;
    expect(error.style.color).toBe("var(--danger-inv)");
    // Texte porteur de sens ≥ 24 px (audit F12, plancher borne).
    expect(error.style.fontSize).toBe("24px");
  });
});
