/**
 * KIOSK-BORNE — Tests du canal IPC d'impression silencieuse du ticket.
 * Main process : `webContents.print({ silent:true, deviceName: SIGFA_KIOSK_PRINTER })`.
 * Preload : expose `window.kioskPrint.printTicket` (détection Electron propre).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  KIOSK_PRINT_TICKET_CHANNEL,
  buildSilentPrintOptions,
  handleKioskPrintTicket,
  type PrintableWebContents,
} from "./kiosk-print-ipc.js";
// L'alias vitest résout "electron" vers __mocks__/electron.ts (stubs inspectables).
import {
  ipcMain as ipcMainElectron,
  contextBridge as contextBridgeElectron,
} from "electron";

const ipcMain = ipcMainElectron as unknown as {
  handlers: Map<string, (...args: unknown[]) => unknown>;
};
const contextBridge = contextBridgeElectron as unknown as {
  exposed: Map<string, unknown>;
};

beforeEach(() => {
  ipcMain.handlers.clear();
  contextBridge.exposed.clear();
});

describe("KIOSK-BORNE: kiosk-print-ipc — main process", () => {
  it("KIOSK-BORNE: le canal IPC est stable (contrat preload ↔ main)", () => {
    expect(KIOSK_PRINT_TICKET_CHANNEL).toBe("kiosk:print-ticket");
  });

  it("KIOSK-BORNE: SIGFA_KIOSK_PRINTER défini → options silencieuses avec deviceName", () => {
    expect(
      buildSilentPrintOptions({ NODE_ENV: "test", SIGFA_KIOSK_PRINTER: "EPSON-TM-T20III" } as NodeJS.ProcessEnv)
    ).toEqual({ silent: true, deviceName: "EPSON-TM-T20III" });
  });

  it("KIOSK-BORNE: SIGFA_KIOSK_PRINTER absent ou vide → imprimante par défaut (deviceName omis)", () => {
    expect(buildSilentPrintOptions({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toEqual({ silent: true });
    expect(
      buildSilentPrintOptions({ NODE_ENV: "test", SIGFA_KIOSK_PRINTER: "" } as NodeJS.ProcessEnv)
    ).toEqual({ silent: true });
  });

  it("KIOSK-BORNE: handleKioskPrintTicket imprime en SILENCIEUX et résout le succès du spouleur", async () => {
    const print = vi.fn(
      (
        _options: { silent: boolean; deviceName?: string },
        callback?: (success: boolean, reason: string) => void
      ) => callback?.(true, "")
    );
    const webContents: PrintableWebContents = { print };

    const ok = await handleKioskPrintTicket(webContents, {
      NODE_ENV: "test",
      SIGFA_KIOSK_PRINTER: "THERMIQUE-80MM",
    } as NodeJS.ProcessEnv);

    expect(ok).toBe(true);
    expect(print).toHaveBeenCalledWith(
      { silent: true, deviceName: "THERMIQUE-80MM" },
      expect.any(Function)
    );
  });

  it("KIOSK-BORNE: échec spouleur → false ; print qui lève → false (jamais de crash)", async () => {
    const failing: PrintableWebContents = {
      print: (_options, callback) => callback?.(false, "printer offline"),
    };
    await expect(handleKioskPrintTicket(failing, { NODE_ENV: "test" } as NodeJS.ProcessEnv)).resolves.toBe(false);

    const throwing: PrintableWebContents = {
      print: () => {
        throw new Error("no printer");
      },
    };
    await expect(handleKioskPrintTicket(throwing, { NODE_ENV: "test" } as NodeJS.ProcessEnv)).resolves.toBe(false);
  });
});

describe("KIOSK-BORNE: kiosk-print-ipc — preload", () => {
  it("KIOSK-BORNE: le preload expose kioskPrint.printTicket via contextBridge (IPC uniquement)", async () => {
    // Handler main enregistré pour que l'invoke du stub réponde.
    ipcMain.handlers.set(KIOSK_PRINT_TICKET_CHANNEL, () => true);

    await import("./preload.js");

    const api = contextBridge.exposed.get("kioskPrint") as
      | { printTicket: () => Promise<boolean> }
      | undefined;
    expect(api).toBeDefined();
    await expect(api!.printTicket()).resolves.toBe(true);
  });
});
