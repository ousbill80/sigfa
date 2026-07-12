/**
 * Boucle 2 F4 — S5 : canal IPC du provisionnement de session borne.
 *
 * Partagé entre `electron/main.ts` (ipcMain.handle) et `electron/preload.ts`
 * (ipcRenderer.invoke). Le renderer ne reçoit QUE le JWT de session — le
 * secret de provisionnement (KIOSK_SECRET) reste dans le processus principal.
 */

/** Canal IPC : le renderer demande la création d'une session borne. */
export const KIOSK_SESSION_CREATE_CHANNEL = "kiosk:session:create";
