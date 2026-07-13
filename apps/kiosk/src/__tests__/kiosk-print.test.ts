/**
 * KIOSK-BORNE — Tests du déclenchement d'impression (renderer).
 * Décision PURE (`shouldAutoPrintTicket`) + routage Electron/navigateur
 * (`triggerTicketPrint`). JAMAIS d'impression en mode dégradé (KIOSK-007).
 */
import { describe, it, expect, vi } from "vitest";
import {
  shouldAutoPrintTicket,
  triggerTicketPrint,
  type KioskPrintBridge,
} from "@/lib/kiosk-print";

describe("KIOSK-BORNE: shouldAutoPrintTicket (décision pure)", () => {
  it("KIOSK-BORNE: imprimante OK, réseau présent → impression", () => {
    expect(
      shouldAutoPrintTicket({ printerStatus: "OK", isBrowserOnline: true })
    ).toBe(true);
  });

  it("KIOSK-BORNE: statut imprimante ABSENT → PAS d'impression (confirmation positive exigée)", () => {
    expect(shouldAutoPrintTicket({})).toBe(false);
    expect(shouldAutoPrintTicket({ isBrowserOnline: true })).toBe(false);
  });

  it("KIOSK-007: PAPER_LOW / ERROR / OFFLINE → JAMAIS d'impression (bascule transparente intacte)", () => {
    for (const printerStatus of ["PAPER_LOW", "ERROR", "OFFLINE"] as const) {
      expect(shouldAutoPrintTicket({ printerStatus })).toBe(false);
    }
  });

  it("KIOSK-007: réseau coupé après 201 avant confirmation imprimante → PAS d'impression", () => {
    expect(
      shouldAutoPrintTicket({
        printerStatus: "OK",
        networkLostBeforePrinterConfirm: true,
      })
    ).toBe(false);
  });

  it("KIOSK-BORNE: navigateur hors ligne → PAS d'impression", () => {
    expect(
      shouldAutoPrintTicket({ printerStatus: "OK", isBrowserOnline: false })
    ).toBe(false);
  });
});

describe("KIOSK-BORNE: triggerTicketPrint (Electron vs navigateur)", () => {
  it("KIOSK-BORNE: pont Electron présent → impression silencieuse IPC, PAS window.print", () => {
    const printTicket = vi.fn().mockResolvedValue(true);
    const print = vi.fn();
    const win = { kioskPrint: { printTicket } as KioskPrintBridge, print } as unknown as Window;

    triggerTicketPrint(win);

    expect(printTicket).toHaveBeenCalledTimes(1);
    expect(print).not.toHaveBeenCalled();
  });

  it("KIOSK-BORNE: navigateur nu → repli window.print()", () => {
    const print = vi.fn();
    const win = { print } as unknown as Window;

    triggerTicketPrint(win);

    expect(print).toHaveBeenCalledTimes(1);
  });

  it("KIOSK-BORNE: window.print qui lève → aucun crash (borne sans surveillance)", () => {
    const win = {
      print: () => {
        throw new Error("Not implemented");
      },
    } as unknown as Window;

    expect(() => triggerTicketPrint(win)).not.toThrow();
  });
});
