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
import { getOfflineDb, __resetOfflineDbForTests } from "@/lib/offline-db";
import { renderHook } from "@testing-library/react";

const messages = {
  ticket005: {
    position: "Position dans la file : {position}e",
    waitEstimate: "Attente estimée : {minutes} minutes",
    printing: "Votre ticket s'imprime...",
    smsSent: "SMS envoyé au {maskedPhone}",
    returning: "Retour automatique dans {seconds} s",
    voiceAnnounce: "Votre numéro est {displayNumber}.",
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
    const { result } = renderHook(() => useOfflineTicket());
    const offlineTicket = await result.current.createOfflineTicket({ serviceId: "svc-1" });
    expect(offlineTicket.isOffline).toBe(true);

    const offline = renderTicket(offlineTicket.displayNumber, 4);
    const offlineStructure = normalizeStructure(offline.container.innerHTML);
    offline.unmount();

    // Structure DOM identique → parcours client inchangé.
    expect(offlineStructure).toBe(onlineStructure);
  });
});
