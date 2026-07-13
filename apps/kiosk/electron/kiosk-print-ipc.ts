/**
 * KIOSK-BORNE — canal IPC d'impression silencieuse du ticket.
 *
 * Partagé entre `electron/main.ts` (ipcMain.handle) et `electron/preload.ts`
 * (ipcRenderer.invoke, exposé au renderer via `window.kioskPrint`). En
 * environnement Electron, le ticket s'imprime en SILENCIEUX sur l'imprimante
 * thermique de la borne (`SIGFA_KIOSK_PRINTER`, sinon imprimante par défaut) —
 * aucun dialogue d'impression n'apparaît jamais à l'usager.
 */

/** Canal IPC : le renderer demande l'impression silencieuse du ticket. */
export const KIOSK_PRINT_TICKET_CHANNEL = "kiosk:print-ticket";

/** Surface minimale de `webContents` requise pour imprimer (testable sans Electron). */
export interface PrintableWebContents {
  print(
    options: { silent: boolean; deviceName?: string },
    callback?: (success: boolean, failureReason: string) => void
  ): void;
}

/** Options d'impression silencieuse dérivées de l'environnement borne. */
export function buildSilentPrintOptions(
  env: NodeJS.ProcessEnv = process.env
): { silent: true; deviceName?: string } {
  const deviceName = env["SIGFA_KIOSK_PRINTER"];
  return deviceName ? { silent: true, deviceName } : { silent: true };
}

/**
 * Handler du canal `kiosk:print-ticket` : imprime la page courante du renderer
 * en silencieux (le layout thermique 80 mm est porté par `@media print` côté
 * renderer). Résout `true` si l'impression a été acceptée par le spouleur,
 * `false` sinon — ne lève JAMAIS (borne sans surveillance).
 *
 * @param webContents - webContents de la fenêtre appelante (event.sender).
 * @param env - Environnement (imprimante `SIGFA_KIOSK_PRINTER`).
 */
export function handleKioskPrintTicket(
  webContents: PrintableWebContents,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      webContents.print(buildSilentPrintOptions(env), (success) => {
        resolve(success);
      });
    } catch {
      resolve(false);
    }
  });
}
