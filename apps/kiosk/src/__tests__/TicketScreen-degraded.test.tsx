/**
 * KIOSK-007 — Tests TDD (phase rouge) : états dégradés imprimante sur TicketScreen.
 * Bascule transparente (aucune mention de panne au client), affichage 8 s,
 * « Photographiez votre numéro ». Réseau coupé après 201.
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
    returning: "Retour automatique dans {seconds} s",
    voiceAnnounce: "Votre numéro est {displayNumber}.",
    printerError: "Imprimante indisponible",
  },
  degraded007: {
    photographNumber: "Photographiez votre numéro ou recevez-le par SMS",
    photographNumberShort: "Photographiez votre numéro",
  },
};

import { TicketScreen } from "@/components/TicketScreen";

const baseProps = { displayNumber: "A007", position: 4, estimatedWaitMinutes: 12 };

function renderTicket(props: Record<string, unknown> = {}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <TicketScreen {...baseProps} {...props} />
    </NextIntlClientProvider>
  );
}

describe("KIOSK-007: TicketScreen états dégradés", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("KIOSK-007: printerStatus PAPER_LOW → affichage prolongé 8 s, message 'Photographiez' visible", () => {
    renderTicket({ printerStatus: "PAPER_LOW" });

    // Message « Photographiez votre numéro ou recevez-le par SMS » visible.
    expect(screen.getByTestId("degraded-photo-message")).toBeInTheDocument();
    expect(screen.getByTestId("degraded-photo-message").textContent).toContain("Photographiez");

    // Aucune mention de panne côté client.
    expect(screen.queryByText(/panne|indisponible|erreur|imprimante/i)).not.toBeInTheDocument();

    // Retour auto NON déclenché avant 8 s.
    vi.advanceTimersByTime(4000);
    expect(mockPush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4000);
    expect(mockPush).toHaveBeenCalledWith("/fr");
  });

  it("KIOSK-007: printerStatus OK → affichage normal 4 s, aucun message dégradé", () => {
    renderTicket({ printerStatus: "OK" });
    expect(screen.queryByTestId("degraded-photo-message")).not.toBeInTheDocument();
    vi.advanceTimersByTime(4000);
    expect(mockPush).toHaveBeenCalledWith("/fr");
  });

  it("KIOSK-007: printerStatus ERROR et OFFLINE → même bascule transparente 8 s", () => {
    const { unmount } = renderTicket({ printerStatus: "ERROR" });
    expect(screen.getByTestId("degraded-photo-message")).toBeInTheDocument();
    // Toujours pas de mot « panne » à l'écran.
    expect(screen.queryByText(/panne/i)).not.toBeInTheDocument();
    unmount();

    renderTicket({ printerStatus: "OFFLINE" });
    expect(screen.getByTestId("degraded-photo-message")).toBeInTheDocument();
  });

  it("KIOSK-007: réseau coupé après 201 avant confirmation imprimante → numéro affiché 8 s + 'Photographiez votre numéro'", () => {
    renderTicket({ networkLostBeforePrinterConfirm: true });
    expect(screen.getByTestId("degraded-photo-message")).toBeInTheDocument();
    expect(screen.getByText("A007")).toBeInTheDocument();
    vi.advanceTimersByTime(4000);
    expect(mockPush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4000);
    expect(mockPush).toHaveBeenCalledWith("/fr");
  });
});
