/**
 * KIOSK-BORNE — Tests du déclenchement d'impression sur TicketScreen.
 * Impression automatique UNE SEULE FOIS si `printerStatus === "OK"` et hors
 * ligne/dégradé exclus ; JAMAIS d'impression en mode dégradé (KIOSK-007
 * intact) ; pont Electron silencieux prioritaire sur window.print().
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";

beforeAll(() => {
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
  global.SpeechSynthesisUtterance = vi
    .fn()
    .mockImplementation((text: string) => ({ text, lang: "" })) as unknown as typeof SpeechSynthesisUtterance;
});

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ locale: "fr" }),
  useSearchParams: () => new URLSearchParams(),
}));

const frMessages = {
  ticket005: {
    position: "Position dans la file : {position}e",
    waitEstimate: "Attente estimée : {minutes} minutes",
    printing: "Votre ticket s'imprime...",
    smsSent: "SMS envoyé au {maskedPhone}",
    voiceAnnounce: "Votre numéro est {displayNumber}.",
  },
  voice008: { playLabel: "Écouter" },
  degraded007: {
    photographNumber: "Photographiez votre numéro ou recevez-le par SMS",
  },
  print: {
    welcome: "Bienvenue à l'agence {agency}",
    yourNumber: "Votre numéro de passage",
    peopleAhead: "Personnes avant vous : {count}",
    estimatedWait: "Attente estimée : ~{minutes} min",
    trackingLabel: "Code de suivi : {code}",
    smsNotice: "Vous serez prévenu par SMS avant votre passage.",
    courtesy: "Merci de patienter, nous allons vous recevoir.",
  },
};

import { TicketScreen } from "@/components/TicketScreen";

const baseProps = {
  displayNumber: "A007",
  position: 4,
  estimatedWaitMinutes: 12,
  trackingId: "V9k2mXpLqRwZsYn8fBjH3",
  serviceLabel: "Retrait espèces",
};

function renderTicket(props: Partial<React.ComponentProps<typeof TicketScreen>> = {}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <TicketScreen {...baseProps} {...props} />
    </NextIntlClientProvider>
  );
}

describe("KIOSK-BORNE: TicketScreen — impression automatique", () => {
  let printSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    printSpy = vi.fn();
    window.print = printSpy as unknown as typeof window.print;
    delete (window as { kioskPrint?: unknown }).kioskPrint;
    Object.defineProperty(window.navigator, "onLine", {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as { kioskPrint?: unknown }).kioskPrint;
  });

  it("KIOSK-BORNE: printerStatus OK → PrintTicket rendu + window.print() déclenché UNE SEULE FOIS", () => {
    const { rerender } = renderTicket({ printerStatus: "OK" });

    // Le ticket thermique est rendu (masqué à l'écran) avec les bonnes données.
    expect(screen.getByTestId("print-ticket")).toBeInTheDocument();
    expect(screen.getByTestId("print-service-label").textContent).toBe("Retrait espèces");
    expect(screen.getByTestId("print-number").textContent).toBe("A007");

    expect(printSpy).toHaveBeenCalledTimes(1);

    // Re-rendu + temps qui passe → toujours UNE seule impression.
    rerender(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TicketScreen {...baseProps} printerStatus="OK" />
      </NextIntlClientProvider>
    );
    vi.advanceTimersByTime(3000);
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("KIOSK-BORNE: pont Electron présent → impression SILENCIEUSE via IPC, PAS window.print()", () => {
    const bridgePrint = vi.fn().mockResolvedValue(true);
    (window as { kioskPrint?: { printTicket: () => Promise<boolean> } }).kioskPrint = {
      printTicket: bridgePrint,
    };

    renderTicket({ printerStatus: "OK" });

    expect(bridgePrint).toHaveBeenCalledTimes(1);
    expect(printSpy).not.toHaveBeenCalled();
  });

  it("KIOSK-007: PAPER_LOW / ERROR / OFFLINE → JAMAIS d'impression, comportement dégradé intact", () => {
    for (const printerStatus of ["PAPER_LOW", "ERROR", "OFFLINE"] as const) {
      const { unmount } = renderTicket({ printerStatus });

      expect(printSpy).not.toHaveBeenCalled();
      expect(screen.queryByTestId("print-ticket")).not.toBeInTheDocument();
      // La bascule transparente reste : « Photographiez votre numéro ».
      expect(screen.getByTestId("degraded-photo-message")).toBeInTheDocument();

      unmount();
    }
  });

  it("KIOSK-007: réseau coupé après 201 (avant confirmation imprimante) → PAS d'impression", () => {
    renderTicket({ printerStatus: "OK", networkLostBeforePrinterConfirm: true });

    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("print-ticket")).not.toBeInTheDocument();
    expect(screen.getByTestId("degraded-photo-message")).toBeInTheDocument();
  });

  it("KIOSK-BORNE: navigateur hors ligne → PAS d'impression (offline exclu)", () => {
    Object.defineProperty(window.navigator, "onLine", {
      value: false,
      configurable: true,
    });

    renderTicket({ printerStatus: "OK" });

    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("print-ticket")).not.toBeInTheDocument();
  });

  it("KIOSK-BORNE: statut imprimante ABSENT → PAS d'impression (confirmation positive exigée)", () => {
    renderTicket();

    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("print-ticket")).not.toBeInTheDocument();
  });

  it("KIOSK-BORNE: SMS consenti → mention SMS sur le ticket imprimé", () => {
    renderTicket({ printerStatus: "OK", phoneNumber: "0707474747", smsConsent: true });

    expect(screen.getByTestId("print-sms")).toBeInTheDocument();
  });
});
