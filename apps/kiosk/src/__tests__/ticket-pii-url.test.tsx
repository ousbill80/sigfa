/**
 * Boucle 2 F4 — S6 : plus AUCUNE PII dans l'URL /ticket (borne PARTAGÉE, UEMOA).
 * Tests TDD écrits AVANT le correctif (phase rouge).
 *
 * - ConfirmationScreen ne place NI le téléphone NI le consentement dans l'URL :
 *   ils transitent par le store mémoire (ticket-moment-store).
 * - TicketPageClient relit la PII depuis le store ; au rechargement de page
 *   (store purgé), l'écran dégrade proprement (ticket sans ligne SMS, ou
 *   retour accueil si l'URL ne porte aucun ticket) — jamais de crash.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import { server } from "@/mocks/server";

// Mock next/navigation — searchParams contrôlables par test.
const mockPush = vi.fn();
const mockReplace = vi.fn();
let currentSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useParams: () => ({ locale: "fr" }),
  useSearchParams: () => currentSearchParams,
}));

vi.mock("@/hooks/useInactivityTimeout", () => ({
  useInactivityTimeout: vi.fn(),
}));

import { ConfirmationScreen } from "@/components/ConfirmationScreen";
import { TicketPageClient } from "@/app/[locale]/ticket/TicketPageClient";
import {
  readTicketMomentPii,
  storeTicketMomentPii,
  purgeTicketMomentPii,
} from "@/lib/ticket-moment-store";
import {
  storeTicketOperationLabel,
  readTicketOperationLabel,
  purgeTicketOperationLabel,
} from "@/lib/ticket-operation-store";

const PHONE = "0707474747";

const messages = {
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
  ticket005: {
    eyebrow: "Votre ticket",
    position: "Position dans la file : {position}e",
    waitEstimate: "Attente estimée : {minutes} minutes",
    printing: "Votre ticket s'imprime...",
    smsSent: "SMS envoyé au {maskedPhone}",
    returning: "Retour automatique dans {seconds} s",
    finishButton: "Terminer",
    voiceAnnounce: "Votre numéro est {displayNumber}.",
    voiceAnnounceOffline:
      "Votre numéro est {displayNumber}. Position et attente estimées dès la reconnexion.",
    offlineBanner: "Mode hors connexion — ticket temporaire",
    offlineInfo: "Ticket local — synchronisation dès reconnexion",
    offlineEstimate: "Position et attente : estimation à la reconnexion",
    printerError: "Imprimante indisponible",
  },
  voice008: { playLabel: "Écouter" },
  degraded007: {
    systemError: "Un problème est survenu. Adressez-vous à l'accueil, on s'occupe de vous.",
    photographNumber: "Photographiez votre numéro ou recevez-le par SMS",
  },
};

function typePhone(digits: string) {
  const keys = screen.getAllByTestId("keypad-key");
  for (const d of digits) {
    const key = keys.find((k) => k.textContent === d);
    fireEvent.click(key!);
  }
}

beforeAll(() => {
  window.speechSynthesis = {
    speak: vi.fn(),
    cancel: vi.fn(),
    getVoices: () => [],
  } as unknown as SpeechSynthesis;
  global.SpeechSynthesisUtterance = vi
    .fn()
    .mockImplementation((text: string) => ({ text, lang: "" })) as unknown as typeof SpeechSynthesisUtterance;
});

beforeEach(() => {
  server.listen({ onUnhandledRequest: "bypass" });
  mockPush.mockClear();
  mockReplace.mockClear();
  currentSearchParams = new URLSearchParams();
  purgeTicketMomentPii();
});

afterEach(() => {
  server.resetHandlers();
  server.close();
  purgeTicketMomentPii();
});

describe("KIOSK-004/S6: ConfirmationScreen — zéro PII dans l'URL de navigation", () => {
  it("S6: 201 avec téléphone + consentement → l'URL /ticket ne contient NI phoneNumber NI smsConsent", async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    typePhone(PHONE);
    fireEvent.click(screen.getByTestId("sms-consent").querySelector("input")!);
    fireEvent.click(screen.getByTestId("cta-btn"));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const pushedUrl = mockPush.mock.calls[0]![0] as string;

    expect(pushedUrl).toContain("/fr/ticket");
    expect(pushedUrl).not.toContain("phoneNumber");
    expect(pushedUrl).not.toContain("smsConsent");
    expect(pushedUrl).not.toContain(PHONE);
    // La PII transite par le store mémoire, pas par l'URL.
    expect(readTicketMomentPii()).toEqual({
      phoneNumber: PHONE,
      smsConsent: true,
    });
  });

  it("S6: repli offline avec téléphone → URL toujours sans PII", async () => {
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.post("*/public/tickets", () => HttpResponse.error())
    );

    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    typePhone(PHONE);
    fireEvent.click(screen.getByTestId("cta-btn"));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const pushedUrl = mockPush.mock.calls[0]![0] as string;
    expect(pushedUrl).not.toContain("phoneNumber");
    expect(pushedUrl).not.toContain(PHONE);
    expect(readTicketMomentPii()?.phoneNumber).toBe(PHONE);
  });

  it("S6: Passer (skip) malgré des chiffres saisis → AUCUNE PII stockée ni transportée", async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <ConfirmationScreen serviceId="svc-1" agencyId="agt-001" />
      </NextIntlClientProvider>
    );

    typePhone("0707");
    fireEvent.click(screen.getByTestId("skip-btn"));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const pushedUrl = mockPush.mock.calls[0]![0] as string;
    expect(pushedUrl).not.toContain("phoneNumber");
    expect(readTicketMomentPii()).toBeNull();
  });
});

describe("KIOSK-005/S6: TicketPageClient — PII depuis le store, dégradation propre", () => {
  it("S6: PII en mémoire → ligne SMS affichée MASQUÉE, téléphone complet jamais dans le DOM", () => {
    currentSearchParams = new URLSearchParams({
      trackingId: "TRK-00001",
      displayNumber: "A007",
      position: "4",
      estimatedWaitMinutes: "12",
    });
    storeTicketMomentPii({ phoneNumber: PHONE, smsConsent: true });

    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <TicketPageClient />
      </NextIntlClientProvider>
    );

    expect(screen.getByTestId("ticket-number")).toHaveTextContent("A007");
    expect(screen.getByTestId("sms-sent")).toBeInTheDocument();
    // Masquage conservé : jamais le numéro complet à l'écran.
    expect(container.innerHTML).not.toContain(PHONE);
  });

  it("S6: rechargement de page (store purgé) → ticket affiché SANS ligne SMS, zéro crash", () => {
    currentSearchParams = new URLSearchParams({
      trackingId: "TRK-00001",
      displayNumber: "A007",
      position: "4",
      estimatedWaitMinutes: "12",
    });
    // Store vide : la PII a été purgée (reload / retour historique).
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <TicketPageClient />
      </NextIntlClientProvider>
    );

    expect(screen.getByTestId("ticket-number")).toHaveTextContent("A007");
    expect(screen.queryByTestId("sms-sent")).not.toBeInTheDocument();
  });

  it("S6: URL sans ticket (visite directe de /ticket) → retour accueil, pas d'écran fantôme", () => {
    currentSearchParams = new URLSearchParams();

    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <TicketPageClient />
      </NextIntlClientProvider>
    );

    expect(mockReplace).toHaveBeenCalledWith("/fr");
    expect(screen.queryByTestId("ticket-number")).not.toBeInTheDocument();
  });
});

describe("KIOSK-005b (audit F5/F8): TicketPageClient — honnêteté offline + opération affichée", () => {
  it("F5: numéro LOCAL (H###) dans l'URL → Moment Ticket HONNÊTE (bandeau offline, zéro fausse position)", () => {
    currentSearchParams = new URLSearchParams({
      trackingId: "9d3a2f30-6b1c-4c8e-9f4a-1b2c3d4e5f60",
      displayNumber: "H001",
      position: "1",
      estimatedWaitMinutes: "0",
    });

    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <TicketPageClient />
      </NextIntlClientProvider>
    );

    expect(screen.getByTestId("ticket-number")).toHaveTextContent("H001");
    // Bandeau « ticket temporaire » câblé (clés i18n existantes enfin rendues).
    expect(screen.getByTestId("offline-banner").textContent).toContain("ticket temporaire");
    // Plus jamais « Position : 1e — 0 minutes » sur un ticket hors-ligne.
    expect(container.textContent).not.toContain("Position dans la file");
    expect(container.textContent).not.toContain("Attente estimée");
    expect(container.textContent).toContain("estimation à la reconnexion");
  });

  it("F5: numéro SERVEUR → aucun bandeau offline, position/attente réelles", () => {
    currentSearchParams = new URLSearchParams({
      trackingId: "TRK-00001",
      displayNumber: "A007",
      position: "4",
      estimatedWaitMinutes: "12",
    });

    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <TicketPageClient />
      </NextIntlClientProvider>
    );

    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("ticket-position").textContent).toContain("4");
  });

  it("F8: libellé d'opération stocké → affiché en eyebrow du Moment Ticket, puis purgé au départ", () => {
    currentSearchParams = new URLSearchParams({
      trackingId: "TRK-00001",
      displayNumber: "A007",
      position: "4",
      estimatedWaitMinutes: "12",
    });
    storeTicketOperationLabel("Retrait espèces");

    const { container, unmount } = render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <TicketPageClient />
      </NextIntlClientProvider>
    );

    expect(container.querySelector(".sig-ticket__eyebrow")?.textContent).toBe(
      "Retrait espèces"
    );

    // Départ de l'écran → libellé purgé (jamais réaffiché au client suivant).
    unmount();
    expect(readTicketOperationLabel()).toBeNull();
  });

  it("F8: store vide (rechargement) → eyebrow neutre, zéro crash", () => {
    currentSearchParams = new URLSearchParams({
      trackingId: "TRK-00001",
      displayNumber: "A007",
      position: "4",
      estimatedWaitMinutes: "12",
    });
    purgeTicketOperationLabel();

    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <TicketPageClient />
      </NextIntlClientProvider>
    );

    expect(container.querySelector(".sig-ticket__eyebrow")?.textContent).toBe("Votre ticket");
  });
});
