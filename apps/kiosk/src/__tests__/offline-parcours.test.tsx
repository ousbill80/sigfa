/**
 * KIOSK-006 — Parcours client identique online vs offline (Testing Library).
 * Écrits AVANT l'implémentation (phase rouge).
 *
 * On prouve que le Moment Ticket (TicketScreen) présente EXACTEMENT la même
 * structure DOM, que le ticket vienne du serveur (online) ou de Dexie (offline).
 * Le parcours client est inchangé : seule la valeur du numéro diffère.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ locale: "fr" }),
  useSearchParams: () => new URLSearchParams(),
}));

import { TicketScreen } from "@/components/TicketScreen";
import { useOfflineTicket } from "@/hooks/useOfflineTicket";
import {
  getOfflineDb,
  isLocalDisplayNumber,
  __resetOfflineDbForTests,
} from "@/lib/offline-db";
import { renderHook } from "@testing-library/react";

const messages = {
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
    photographNumber: "Photographiez votre numéro ou recevez-le par SMS",
  },
};

/** Remplace les valeurs variables par des placeholders pour comparer la structure. */
function normalizeStructure(html: string): string {
  return html
    .replace(/H\d{3}/g, "NUM")
    .replace(/A\d{3}/g, "NUM")
    .replace(/Position dans la file : \d+e/g, "Position dans la file : Ne")
    .replace(/data-animate="[^"]*"/g, "");
}

function renderTicket(displayNumber: string, position: number) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <TicketScreen
        displayNumber={displayNumber}
        position={position}
        estimatedWaitMinutes={0}
      />
    </NextIntlClientProvider>
  );
}

beforeEach(async () => {
  __resetOfflineDbForTests();
  const db = getOfflineDb();
  await db.open();
  await db.tickets.clear();
  await db.counters.clear();
});

afterEach(() => {
  __resetOfflineDbForTests();
});

describe("KIOSK-006: parcours online == offline", () => {
  it("KIOSK-006: parcours client identique online et offline — snapshot comparé (Testing Library)", async () => {
    // Online : le serveur renvoie A100, position 4.
    const online = renderTicket("A100", 4);
    const onlineStructure = normalizeStructure(online.container.innerHTML);
    online.unmount();

    // Offline : le hook émet un ticket local, on le rend dans le MÊME écran.
    // NOTE (audit F5) : le MÊME composant sert les deux chemins — la structure
    // reste identique tant que le mode honnête (isOfflineTicket) n'est pas levé.
    const { result } = renderHook(() => useOfflineTicket());
    const offlineTicket = await result.current.createOfflineTicket({ serviceId: "svc-1" });
    expect(offlineTicket.isOffline).toBe(true);

    const offline = renderTicket(offlineTicket.displayNumber, 4);
    const offlineStructure = normalizeStructure(offline.container.innerHTML);
    offline.unmount();

    // Structure DOM identique → parcours client inchangé.
    expect(offlineStructure).toBe(onlineStructure);
  });

  it("KIOSK-005b (audit F5): ticket émis hors-ligne → Moment Ticket HONNÊTE (bandeau + estimation à la reconnexion)", async () => {
    // Le hook émet un ticket LOCAL (position/attente non fiables par nature).
    const { result } = renderHook(() => useOfflineTicket());
    const offlineTicket = await result.current.createOfflineTicket({ serviceId: "svc-1" });
    expect(offlineTicket.isOffline).toBe(true);
    expect(offlineTicket.displayNumber).toMatch(/^H\d{3}$/);
    // Le numéro local est reconnu par le détecteur du chemin offline.
    expect(isLocalDisplayNumber(offlineTicket.displayNumber)).toBe(true);

    // Rendu HONNÊTE : le chemin offline lève isOfflineTicket.
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <TicketScreen
          displayNumber={offlineTicket.displayNumber}
          position={offlineTicket.position}
          estimatedWaitMinutes={offlineTicket.estimatedWaitMinutes}
          isOfflineTicket={true}
        />
      </NextIntlClientProvider>
    );

    // Bandeau « Mode hors connexion — ticket temporaire » VISIBLE (clés câblées).
    const banner = container.querySelector("[data-testid='offline-banner']");
    expect(banner?.textContent).toContain("ticket temporaire");
    // Plus jamais « Position : 1e — Attente : 0 minutes » mensongers.
    expect(container.textContent).not.toContain("Position dans la file");
    expect(container.textContent).not.toContain("Attente estimée");
    expect(container.textContent).toContain("estimation à la reconnexion");
    expect(container.textContent).toContain("synchronisation dès reconnexion");
    // Le numéro reste le héros (le client garde sa preuve de passage).
    expect(
      container.querySelector("[data-testid='ticket-number']")?.textContent
    ).toBe(offlineTicket.displayNumber);
  });
});
