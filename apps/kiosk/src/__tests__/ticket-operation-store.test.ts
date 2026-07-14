/**
 * KIOSK-005b (audit F8) — Store mémoire du libellé d'opération choisi.
 * Tests TDD écrits AVANT l'implémentation (phase rouge).
 *
 * Le Moment Ticket doit afficher l'OPÉRATION choisie (« Retrait espèces »)
 * pour que le client vérifie son choix d'un coup d'œil. Le libellé (donnée
 * publique, non-PII) transite d'OperationsScreen à l'écran ticket via une
 * variable de module (même patron que ticket-moment-store) :
 *  - purge automatique après TTL (un parcours borne dure < 5 min) ;
 *  - purge explicite (départ de l'écran ticket, nouveau parcours) ;
 *  - rechargement de page → store vide → dégradation propre (eyebrow neutre).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  storeTicketOperationLabel,
  readTicketOperationLabel,
  purgeTicketOperationLabel,
  TICKET_OPERATION_TTL_MS,
} from "@/lib/ticket-operation-store";

describe("KIOSK-005b (audit F8): ticket-operation-store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    purgeTicketOperationLabel();
  });
  afterEach(() => {
    purgeTicketOperationLabel();
    vi.useRealTimers();
  });

  it("KIOSK-005b: store vide par défaut → null (dégradation propre)", () => {
    expect(readTicketOperationLabel()).toBeNull();
  });

  it("KIOSK-005b: le libellé stocké est relu tel quel (lecture non destructive)", () => {
    storeTicketOperationLabel("Retrait espèces");
    expect(readTicketOperationLabel()).toBe("Retrait espèces");
    // Relecture pendant le rendu React → toujours présent.
    expect(readTicketOperationLabel()).toBe("Retrait espèces");
  });

  it("KIOSK-005b: purge explicite → null (nouveau parcours, départ d'écran)", () => {
    storeTicketOperationLabel("Dépôt espèces");
    purgeTicketOperationLabel();
    expect(readTicketOperationLabel()).toBeNull();
  });

  it("KIOSK-005b: un nouveau store remplace l'ancien libellé (jamais de libellé périmé)", () => {
    storeTicketOperationLabel("Retrait espèces");
    storeTicketOperationLabel("Virement");
    expect(readTicketOperationLabel()).toBe("Virement");
  });

  it("KIOSK-005b: purge automatique après TTL (aucun libellé du client précédent)", () => {
    storeTicketOperationLabel("Retrait espèces");
    vi.advanceTimersByTime(TICKET_OPERATION_TTL_MS + 1);
    expect(readTicketOperationLabel()).toBeNull();
  });
});
