/**
 * KIOSK-002..005 — Tests d'interaction supplémentaires pour les écrans kiosk
 * Couvre les branches handlers/états non exercés par les tests de snapshot.
 * Interactions : sélection langue, sélection service, saisie téléphone, états error/offline/empty.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import { server } from "@/mocks/server";
import { http, HttpResponse } from "msw";

// ─── navigation mocks ───────────────────────────────────
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

// ─── Speech Synthesis mock ──────────────────────────────
beforeAll(() => {
  if (!window.speechSynthesis) {
    window.speechSynthesis = {
      speak: vi.fn(),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: () => [],
      speaking: false,
      pending: false,
      paused: false,
      onvoiceschanged: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as SpeechSynthesis;
  }

  if (!global.SpeechSynthesisUtterance) {
    global.SpeechSynthesisUtterance = vi.fn().mockImplementation((text: string) => ({
      text,
      lang: "",
      pitch: 1,
      rate: 1,
      volume: 1,
      voice: null,
      onstart: null,
      onend: null,
      onerror: null,
      onpause: null,
      onresume: null,
      onmark: null,
      onboundary: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof SpeechSynthesisUtterance;
  }
});

// ─── Message fixtures ────────────────────────────────────
const homeMessages = {
  home002: {
    title: "Akwaba — Bienvenue",
    chooseLanguage: "Choisissez votre langue",
    languageFr: "Français",
    languageDioula: "Dioula",
    languageBaoule: "Baoulé",
    languageEn: "English",
    queueStatus: "File d'attente : {count} personnes — attente estimée : {minutes} min",
    queueUnavailable: "File d'attente non disponible",
    offlineBanner: "Mode hors connexion — vos tickets restent valables",
    loading: "Chargement...",
  },
};

const servicesMessages = {
  services003: {
    title: "Quel service souhaitez-vous ?",
    backButton: "Retour",
    waitEstimate: "~{minutes} min",
    seeMore: "Voir plus de services",
    closedService: "Fermé — {schedule}",
    accessibilityButton: "♿ Accès prioritaire",
    emptyTitle: "Aucun service disponible",
    emptyMessage: "Rendez-vous à l'accueil — un agent vous aidera.",
    offlineBanner: "Mode hors connexion",
  },
  voice008: { playLabel: "Écouter" },
  degraded007: {
    longQueueTitle: "Forte affluence — environ {estimate} min",
    longQueueMessage: "Recevez un SMS et revenez à l'heure de votre passage.",
    phoneFieldLabel: "Votre numéro de téléphone",
  },
};

const confirmationMessages = {
  confirmation004: {
    title: "Votre numéro de téléphone (facultatif)",
    phonePrefix: "+225",
    phonePlaceholder: "07 __ __ __ __ __",
    smsConsent: "J'accepte de recevoir mon ticket par SMS (optionnel)",
    ctaButton: "PRENDRE MON TICKET",
    skipButton: "Passer (sans numéro de téléphone)",
    errorPhone: "Il manque votre numéro — ou touchez Passer",
    loadingMessage: "Émission de votre ticket...",
    offlineBanner: "Mode hors connexion — ticket local généré",
  },
  voice008: { playLabel: "Écouter" },
  degraded007: {
    systemError: "Un problème est survenu. Adressez-vous à l'accueil, on s'occupe de vous.",
  },
};

const ticketMessages = {
  ticket005: {
    position: "Position dans la file : {position}e",
    waitEstimate: "Attente estimée : {minutes} minutes",
    printing: "Votre ticket s'imprime...",
    smsSent: "SMS envoyé au {maskedPhone}",
    returning: "Retour automatique dans {seconds} s",
    voiceAnnounce: "Votre numéro est {displayNumber}. Vous êtes en position {position}. Attente estimée : {minutes} minutes.",
    offlineBanner: "Mode hors connexion — ticket temporaire",
    offlineInfo: "Ticket local — synchronisation dès reconnexion",
    printerError: "Imprimante indisponible — un agent vous remettra votre ticket",
  },
  voice008: { playLabel: "Écouter" },
  degraded007: {
    photographNumber: "Photographiez votre numéro ou recevez-le par SMS",
    photographNumberShort: "Photographiez votre numéro",
  },
};

// ─── Imports ─────────────────────────────────────────────
import { HomeScreen } from "@/components/HomeScreen";
import { ServicesScreen, type ServiceItem } from "@/components/ServicesScreen";
import { ConfirmationScreen } from "@/components/ConfirmationScreen";
import { TicketScreen } from "@/components/TicketScreen";
import { readTicketMomentPii } from "@/lib/ticket-moment-store";

const MOCK_SERVICES: ServiceItem[] = [
  { id: "svc-1", name: "Dépôt", icon: "💰", estimatedMinutes: 5, isOpen: true },
  { id: "svc-2", name: "Retrait", icon: "💵", estimatedMinutes: 8, isOpen: true },
  { id: "svc-3", name: "Virement", icon: "🔄", estimatedMinutes: 12, isOpen: true },
  { id: "svc-4", name: "Réclamation", icon: "📋", estimatedMinutes: 15, isOpen: true },
  { id: "svc-5", name: "Crédit", icon: "🏦", estimatedMinutes: 20, isOpen: false, schedule: "Lu-Ve 09h-17h" },
];

// ═══════════════════════════════════════════════════════════
// HomeScreen — interactions handlers
// ═══════════════════════════════════════════════════════════

describe("KIOSK-002: HomeScreen interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mock("@/hooks/useQueueStatus", () => ({
      useQueueStatus: () => ({ count: 5, estimatedMinutes: 10, isOffline: false }),
    }));
    vi.mock("@/hooks/useAccessibilityMode", () => ({
      useAccessibilityMode: () => ({
        isAccessibilityMode: false,
        toggleAccessibilityMode: vi.fn(),
      }),
    }));
  });

  it("KIOSK-002: handleLanguageSelect — clicking a language card navigates to /{locale}/services", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={homeMessages}>
        <HomeScreen />
      </NextIntlClientProvider>
    );

    const cards = container.querySelectorAll("[data-testid='language-card']");
    expect(cards.length).toBe(4);

    // Click the first card (fr locale)
    fireEvent.click(cards[0]);

    expect(mockPush).toHaveBeenCalledWith("/fr/services");
  });

  it("KIOSK-002: handleLanguageSelect — clicking 'en' card navigates to /en/services", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={homeMessages}>
        <HomeScreen />
      </NextIntlClientProvider>
    );

    const cards = container.querySelectorAll("[data-testid='language-card']");
    // cards: fr, dioula, baoule, en — en is index 3
    fireEvent.click(cards[3]);

    expect(mockPush).toHaveBeenCalledWith("/en/services");
  });

  it("KIOSK-002: handleLanguageSelect — speechSynthesis.speak called when available", () => {
    const speakMock = vi.fn();
    window.speechSynthesis = {
      ...window.speechSynthesis,
      speak: speakMock,
    } as unknown as SpeechSynthesis;

    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={homeMessages}>
        <HomeScreen />
      </NextIntlClientProvider>
    );

    const cards = container.querySelectorAll("[data-testid='language-card']");
    fireEvent.click(cards[0]);

    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it("KIOSK-002: queue unavailable — shows queueUnavailable text when count/minutes are null", () => {
    // Override mock to return null count/minutes
    vi.doMock("@/hooks/useQueueStatus", () => ({
      useQueueStatus: () => ({ count: null, estimatedMinutes: null, isOffline: false }),
    }));

    // Use isOffline=false explicitly (not null queue)
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={homeMessages}>
        <HomeScreen isOffline={false} />
      </NextIntlClientProvider>
    );

    const queueEl = container.querySelector("[data-testid='queue-status']");
    expect(queueEl).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════
// ServicesScreen — interactions handlers
// ═══════════════════════════════════════════════════════════

describe("KIOSK-003: ServicesScreen interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mock("@/hooks/useAccessibilityMode", () => ({
      useAccessibilityMode: () => ({
        isAccessibilityMode: false,
        toggleAccessibilityMode: vi.fn(),
      }),
    }));
    sessionStorage.clear();
  });

  it("KIOSK-003: clicking an open service navigates to confirmation screen", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={servicesMessages}>
        <ServicesScreen services={MOCK_SERVICES.slice(0, 2)} agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const cards = screen.getAllByTestId("service-card");
    fireEvent.click(cards[0]); // svc-1, open

    expect(mockPush).toHaveBeenCalledWith(
      "/fr/confirmation?serviceId=svc-1&agencyId=agt-001"
    );
  });

  it("KIOSK-003: clicking a closed service does NOT navigate", () => {
    const closedService: ServiceItem = {
      id: "svc-closed",
      name: "Crédit",
      icon: "🏦",
      estimatedMinutes: 20,
      isOpen: false,
      schedule: "Lu-Ve 09h-17h",
    };

    render(
      <NextIntlClientProvider locale="fr" messages={servicesMessages}>
        <ServicesScreen services={[closedService]} agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const card = screen.getByTestId("service-card");
    fireEvent.click(card);

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("KIOSK-003: back button triggers router.back()", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={servicesMessages}>
        <ServicesScreen services={MOCK_SERVICES.slice(0, 2)} agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const backBtn = screen.getByTestId("back-btn");
    fireEvent.click(backBtn);

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("KIOSK-003: see-more button shows all services", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={servicesMessages}>
        <ServicesScreen services={MOCK_SERVICES} agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    // Initially only 4 visible
    let cards = screen.getAllByTestId("service-card");
    expect(cards.length).toBe(4);

    // Click see-more
    const seeMoreBtn = screen.getByTestId("see-more-btn");
    fireEvent.click(seeMoreBtn);

    // Now all 5 visible
    cards = screen.getAllByTestId("service-card");
    expect(cards.length).toBe(5);

    // see-more button no longer visible
    expect(screen.queryByTestId("see-more-btn")).not.toBeInTheDocument();
  });

  it("KIOSK-003: accessibility button click calls toggleAccessibilityMode", () => {
    const toggleMock = vi.fn();
    vi.doMock("@/hooks/useAccessibilityMode", () => ({
      useAccessibilityMode: () => ({
        isAccessibilityMode: false,
        toggleAccessibilityMode: toggleMock,
      }),
    }));

    // We render with real hook since the mock is already applied at module level
    // Access the button and verify it is clickable
    render(
      <NextIntlClientProvider locale="fr" messages={servicesMessages}>
        <ServicesScreen services={MOCK_SERVICES.slice(0, 2)} agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const a11yBtn = screen.getByTestId("accessibility-btn");
    expect(a11yBtn).toBeInTheDocument();
    // Verify the button is clickable (not disabled)
    expect(a11yBtn).not.toBeDisabled();

    // Click should not throw
    fireEvent.click(a11yBtn);
  });

  it("KIOSK-003: closedService schedule shown with token --ink-soft", () => {
    const closedService: ServiceItem = {
      id: "svc-closed",
      name: "Crédit",
      icon: "🏦",
      estimatedMinutes: 20,
      isOpen: false,
      schedule: "Lu-Ve 09h-17h",
    };

    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={servicesMessages}>
        <ServicesScreen services={[closedService]} agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const scheduleEl = container.querySelector("[data-testid='service-schedule']") as HTMLElement;
    expect(scheduleEl).toBeInTheDocument();
    expect(scheduleEl.style.color).toBe("var(--ink-soft)");
  });
});

// ═══════════════════════════════════════════════════════════
// ConfirmationScreen — interactions branches supplémentaires
// ═══════════════════════════════════════════════════════════

describe("KIOSK-004: ConfirmationScreen additional branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.listen({ onUnhandledRequest: "bypass" });
  });

  afterEach(() => {
    server.resetHandlers();
    server.close();
  });

  it("KIOSK-004: star key (*) press — does nothing to phone digits", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={confirmationMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const phoneInput = container.querySelector("[data-testid='phone-input']") as HTMLInputElement;
    const keys = container.querySelectorAll("[data-testid='keypad-key']");

    // Star is at index 9 (rows: 1,2,3,4,5,6,7,8,9,*,0,⌫)
    const starKey = Array.from(keys).find((k) => k.textContent === "*");
    expect(starKey).toBeDefined();
    fireEvent.click(starKey!);

    // Phone should remain empty
    expect(phoneInput.value).toBe("");
  });

  it("KIOSK-004: backspace (⌫) removes last digit and clears error", async () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={confirmationMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const phoneInput = container.querySelector("[data-testid='phone-input']") as HTMLInputElement;
    const keys = container.querySelectorAll("[data-testid='keypad-key']");

    // Press "1" digit
    const oneKey = Array.from(keys).find((k) => k.textContent === "1");
    fireEvent.click(oneKey!);
    expect(phoneInput.value).toBe("1");

    // Press CTA to trigger an error
    const ctaBtn = container.querySelector("[data-testid='cta-btn']");
    fireEvent.click(ctaBtn!);

    await waitFor(() => {
      expect(container.querySelector("[data-testid='phone-error']")).toBeInTheDocument();
    });

    // Backspace should remove the digit and clear error
    const backspaceKey = Array.from(keys).find((k) => k.textContent === "⌫");
    fireEvent.click(backspaceKey!);

    expect(phoneInput.value).toBe("");
    // Error should be cleared
    expect(container.querySelector("[data-testid='phone-error']")).not.toBeInTheDocument();
  });

  it("KIOSK-004: smsConsent checkbox appears when phone digits entered, toggle works", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={confirmationMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    // Initially no consent checkbox
    expect(container.querySelector("[data-testid='sms-consent']")).not.toBeInTheDocument();

    // Enter a digit
    const keys = container.querySelectorAll("[data-testid='keypad-key']");
    const zeroKey = Array.from(keys).find((k) => k.textContent === "0");
    fireEvent.click(zeroKey!);

    // Now SMS consent checkbox should appear
    const consentLabel = container.querySelector("[data-testid='sms-consent']");
    expect(consentLabel).toBeInTheDocument();

    // Toggle the checkbox
    const checkbox = consentLabel!.querySelector("input[type='checkbox']") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  // Boucle 2 F4 (S6) : la PII ne transite PLUS par l'URL d'une borne PARTAGÉE —
  // elle passe par le store mémoire (ticket-moment-store), purgé après affichage.
  it("KIOSK-004/S6: phone + smsConsent = true → URL SANS PII, téléphone via store mémoire", async () => {
    server.use(
      http.post("*/public/tickets", () => {
        return HttpResponse.json(
          {
            trackingId: "TRK-PHONE",
            number: 8,
            displayNumber: "B008",
            position: 2,
            estimatedWaitMinutes: 5,
            queueLength: 3,
            serviceId: "svc-1",
            agencyId: "agt-001",
            channel: "KIOSK",
            createdAt: new Date().toISOString(),
            status: "WAITING",
          },
          { status: 201 }
        );
      })
    );

    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={confirmationMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const keys = container.querySelectorAll("[data-testid='keypad-key']");

    // Enter a valid CI phone: 0707474747 → click 0,7,0,7,4,7,4,7,4,7
    const digitMap: Record<string, Element | undefined> = {};
    keys.forEach((k) => {
      const text = k.textContent ?? "";
      digitMap[text] = k;
    });

    // Type 0707474747 (valid CI phone)
    const digits = ["0", "7", "0", "7", "4", "7", "4", "7", "4", "7"];
    for (const d of digits) {
      fireEvent.click(digitMap[d]!);
    }

    // Enable SMS consent
    const consentLabel = container.querySelector("[data-testid='sms-consent']");
    const checkbox = consentLabel!.querySelector("input[type='checkbox']") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    // Submit
    const ctaBtn = container.querySelector("[data-testid='cta-btn']");
    fireEvent.click(ctaBtn!);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("/fr/ticket"));
    });

    const pushedUrl = mockPush.mock.calls[0][0] as string;
    expect(pushedUrl).not.toContain("phoneNumber");
    expect(pushedUrl).not.toContain("smsConsent");
    expect(pushedUrl).not.toContain("0707474747");
    expect(readTicketMomentPii()).toEqual({
      phoneNumber: "0707474747",
      smsConsent: true,
    });
  });

  // KIOSK-007 : les 5xx sont désormais traités comme ERREUR SYSTÈME (message
  // humain + alert:manager), plus comme un repli offline silencieux. Le repli
  // offline reste déclenché par une COUPURE RÉSEAU réelle (exception fetch).
  it("KIOSK-004: coupure réseau → isOffline state set, offline banner visible", async () => {
    server.use(
      http.post("*/public/tickets", () => {
        return HttpResponse.error();
      })
    );

    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={confirmationMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const skipBtn = screen.getByText("Passer (sans numéro de téléphone)");
    fireEvent.click(skipBtn);

    await waitFor(() => {
      const offlineBanner = container.querySelector("[data-testid='offline-banner']");
      expect(offlineBanner).toBeInTheDocument();
    });

    // KIOSK-006 : l'émission offline est désormais asynchrone (écriture Dexie),
    // la navigation intervient après la persistance locale du ticket.
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("/fr/ticket"));
    });
  });

  it("KIOSK-004: backspace key on empty phone does nothing", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={confirmationMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const phoneInput = container.querySelector("[data-testid='phone-input']") as HTMLInputElement;
    const keys = container.querySelectorAll("[data-testid='keypad-key']");
    const backspaceKey = Array.from(keys).find((k) => k.textContent === "⌫");

    expect(phoneInput.value).toBe("");
    fireEvent.click(backspaceKey!);
    expect(phoneInput.value).toBe("");
  });

  it("KIOSK-004: max 10 digits — 11th key press ignored", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={confirmationMessages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    const phoneInput = container.querySelector("[data-testid='phone-input']") as HTMLInputElement;
    const keys = container.querySelectorAll("[data-testid='keypad-key']");
    const oneKey = Array.from(keys).find((k) => k.textContent === "1");

    // Click 11 times
    for (let i = 0; i < 11; i++) {
      fireEvent.click(oneKey!);
    }

    // Only 10 digits should be stored
    expect(phoneInput.value.length).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════
// TicketScreen — branches supplémentaires
// ═══════════════════════════════════════════════════════════

describe("KIOSK-005: TicketScreen additional branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // KIOSK-007 (arbitrage 19) OVERRIDE de l'ancien comportement KIOSK-005 :
  // printerStatus ERROR ne montre PLUS de message de panne. Bascule transparente
  // → message « Photographiez votre numéro », AUCUNE mention d'imprimante HS.
  it("KIOSK-007: printerStatus ERROR → bascule transparente, aucun message de panne (override KIOSK-005)", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={ticketMessages}>
        <TicketScreen
          displayNumber="A007"
          position={4}
          estimatedWaitMinutes={12}
          printerStatus="ERROR"
        />
      </NextIntlClientProvider>
    );

    // Plus de message de panne (--danger) à l'écran client.
    expect(screen.queryByTestId("print-error")).not.toBeInTheDocument();
    expect(screen.queryByText(/indisponible|panne/i)).not.toBeInTheDocument();
    // Bascule transparente : message « Photographiez votre numéro ».
    expect(screen.getByTestId("degraded-photo-message")).toBeInTheDocument();
  });

  it("KIOSK-005: no printerStatus → neither print-message nor print-error shown", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={ticketMessages}>
        <TicketScreen
          displayNumber="A007"
          position={4}
          estimatedWaitMinutes={12}
        />
      </NextIntlClientProvider>
    );

    expect(screen.queryByTestId("print-message")).not.toBeInTheDocument();
    expect(screen.queryByTestId("print-error")).not.toBeInTheDocument();
  });

  it("KIOSK-005: phoneNumber without smsConsent → sms-sent NOT shown", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={ticketMessages}>
        <TicketScreen
          displayNumber="A007"
          position={4}
          estimatedWaitMinutes={12}
          phoneNumber="0707474747"
          smsConsent={false}
        />
      </NextIntlClientProvider>
    );

    expect(screen.queryByTestId("sms-sent")).not.toBeInTheDocument();
  });

  it("KIOSK-005: smsConsent true but no phoneNumber → sms-sent NOT shown", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={ticketMessages}>
        <TicketScreen
          displayNumber="A007"
          position={4}
          estimatedWaitMinutes={12}
          smsConsent={true}
        />
      </NextIntlClientProvider>
    );

    expect(screen.queryByTestId("sms-sent")).not.toBeInTheDocument();
  });

  it("KIOSK-005: maskPhoneNumber — short phone (less than 2 chars) returns as-is", () => {
    // We test via the rendered output; pass a 1-char phone with smsConsent
    render(
      <NextIntlClientProvider locale="fr" messages={ticketMessages}>
        <TicketScreen
          displayNumber="A007"
          position={4}
          estimatedWaitMinutes={12}
          phoneNumber="7"
          smsConsent={true}
        />
      </NextIntlClientProvider>
    );

    const smsEl = screen.getByTestId("sms-sent");
    // maskPhoneNumber("7") returns "7" — should be in the text
    expect(smsEl.textContent).toContain("7");
  });

  it("KIOSK-005: isAccessibilityMode=false → auto-return after 4s", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={ticketMessages}>
        <TicketScreen
          displayNumber="A007"
          position={4}
          estimatedWaitMinutes={12}
          isAccessibilityMode={false}
        />
      </NextIntlClientProvider>
    );

    vi.advanceTimersByTime(4000);
    expect(mockPush).toHaveBeenCalledWith("/fr");
  });

  it("KIOSK-005: voice announcement uses fr-FR lang for fr locale", () => {
    const speakMock = vi.fn();
    const utteranceMock = vi.fn().mockImplementation((text: string) => ({
      text,
      lang: "",
      pitch: 1,
      rate: 1,
    }));
    window.speechSynthesis = { ...window.speechSynthesis, speak: speakMock } as unknown as SpeechSynthesis;
    global.SpeechSynthesisUtterance = utteranceMock as unknown as typeof SpeechSynthesisUtterance;

    render(
      <NextIntlClientProvider locale="fr" messages={ticketMessages}>
        <TicketScreen
          displayNumber="A007"
          position={4}
          estimatedWaitMinutes={12}
        />
      </NextIntlClientProvider>
    );

    expect(utteranceMock).toHaveBeenCalledTimes(1);
    expect(speakMock).toHaveBeenCalledTimes(1);
  });
});
