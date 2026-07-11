/**
 * KIOSK-001 — electron/main.ts
 * Processus principal Electron — shell minimal kiosque.
 * Exporte KIOSK_WINDOW_CONFIG pour les tests (sans dépendance Electron à l'import).
 */

/** Configuration de la fenêtre Electron kiosque */
export const KIOSK_WINDOW_CONFIG = {
  kiosk: true,
  fullscreen: true,
  autoHideMenuBar: true,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  },
} as const;

/**
 * Lance la fenêtre principale Electron.
 * Cette fonction n'est appelée que dans le processus principal Electron,
 * jamais dans les tests unitaires.
 */
export async function createMainWindow(): Promise<void> {
  const { app, BrowserWindow } = await import("electron");

  const win = new BrowserWindow(KIOSK_WINDOW_CONFIG);

  const startUrl =
    process.env["ELECTRON_START_URL"] ?? "http://localhost:3002";
  await win.loadURL(startUrl);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
