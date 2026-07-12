/**
 * Boucle 2 F4 — S6 : PII du Moment Ticket EN MÉMOIRE (jamais dans l'URL).
 * Tests TDD écrits AVANT le correctif (phase rouge).
 *
 * Constat panel : le téléphone complet + smsConsent transitaient par la query
 * string de /ticket → PII dans l'historique de navigation d'une borne
 * PARTAGÉE (UEMOA). Le transport passe par ce store mémoire, purgé après
 * affichage/timeout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  storeTicketMomentPii,
  readTicketMomentPii,
  purgeTicketMomentPii,
  TICKET_MOMENT_PII_TTL_MS,
} from "@/lib/ticket-moment-store";

beforeEach(() => {
  purgeTicketMomentPii();
});

afterEach(() => {
  purgeTicketMomentPii();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("KIOSK-005/S6: ticket-moment-store — PII en mémoire, purge après affichage", () => {
  it("S6: store vide → lecture null (rechargement de page = dégradation propre)", () => {
    expect(readTicketMomentPii()).toBeNull();
  });

  it("S6: stocke puis relit le téléphone + consentement, en mémoire uniquement", () => {
    storeTicketMomentPii({ phoneNumber: "0707474747", smsConsent: true });
    expect(readTicketMomentPii()).toEqual({
      phoneNumber: "0707474747",
      smsConsent: true,
    });
  });

  it("S6: purge explicite → plus aucune PII lisible", () => {
    storeTicketMomentPii({ phoneNumber: "0707474747", smsConsent: true });
    purgeTicketMomentPii();
    expect(readTicketMomentPii()).toBeNull();
  });

  it("S6: purge automatique après timeout (TTL — horloge Vitest)", () => {
    vi.useFakeTimers();
    storeTicketMomentPii({ phoneNumber: "0707474747", smsConsent: true });
    expect(readTicketMomentPii()).not.toBeNull();

    vi.advanceTimersByTime(TICKET_MOMENT_PII_TTL_MS + 1);
    expect(readTicketMomentPii()).toBeNull();
  });

  it("S6: TTL dépassé côté lecture (timer non déclenché) → purge à la relecture", () => {
    // Seule l'horloge Date avance : le setTimeout de purge n'est PAS déclenché,
    // c'est la garde de lecture qui doit purger (défense en profondeur).
    vi.useFakeTimers({ toFake: ["Date"] });
    storeTicketMomentPii({ phoneNumber: "0707474747", smsConsent: true });

    vi.advanceTimersByTime(TICKET_MOMENT_PII_TTL_MS + 1);
    expect(readTicketMomentPii()).toBeNull();
  });

  it("S6: la PII ne touche JAMAIS localStorage ni sessionStorage (appareil partagé)", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    storeTicketMomentPii({ phoneNumber: "0707474747", smsConsent: true });
    readTicketMomentPii();
    expect(setItemSpy).not.toHaveBeenCalled();
  });
});
