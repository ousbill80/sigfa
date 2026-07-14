/**
 * Boucle 2 F4 — S5 : preload Electron (contextBridge) — pont session borne.
 *
 * Expose au renderer une API MINIMALE (`window.kioskAuth.createSession`) qui
 * délègue la création de session au processus principal via IPC. Le renderer
 * ne voit JAMAIS le secret de provisionnement (KIOSK_SECRET) : il ne reçoit
 * que le JWT de session (scope agency, TTL 43 200 s).
 *
 * Compatible avec le durcissement existant, qui est PRÉSERVÉ :
 * `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true` — en mode
 * sandbox, seuls `contextBridge` et `ipcRenderer` sont accessibles ici.
 *
 * NOTE packaging (gate humain démo RT-003) : en sandbox, le preload doit être
 * chargé en CommonJS — ce fichier est compilé vers `preload.cjs` au packaging
 * Electron (voir `resolvePreloadPath()` dans `electron/main.ts`).
 */
import { contextBridge, ipcRenderer } from "electron";
import { KIOSK_SESSION_CREATE_CHANNEL } from "./kiosk-session-ipc";
import { KIOSK_PRINT_TICKET_CHANNEL } from "./kiosk-print-ipc";

/** DTO session renvoyé au renderer — strictement sans secret. */
export interface KioskSessionBridgeDto {
  accessToken: string;
  expiresIn: number;
  kioskId: string;
  agencyId: string;
  /** CONTRACT-014 : bankId public de la borne (theming session, zéro PII). */
  bankId: string;
}

/** Expose `window.kioskAuth` au monde isolé du renderer. */
export function exposeKioskAuthBridge(): void {
  contextBridge.exposeInMainWorld("kioskAuth", {
    createSession: (): Promise<KioskSessionBridgeDto | null> =>
      ipcRenderer.invoke(
        KIOSK_SESSION_CREATE_CHANNEL
      ) as Promise<KioskSessionBridgeDto | null>,
  });
}

/**
 * KIOSK-BORNE — Expose `window.kioskPrint` au monde isolé du renderer.
 * `printTicket()` délègue l'impression SILENCIEUSE du ticket au main process
 * (canal `kiosk:print-ticket`). La présence de ce pont sert aussi de détection
 * Electron propre côté renderer (repli `window.print()` en navigateur nu).
 */
export function exposeKioskPrintBridge(): void {
  contextBridge.exposeInMainWorld("kioskPrint", {
    printTicket: (): Promise<boolean> =>
      ipcRenderer.invoke(KIOSK_PRINT_TICKET_CHANNEL) as Promise<boolean>,
  });
}

exposeKioskAuthBridge();
exposeKioskPrintBridge();
