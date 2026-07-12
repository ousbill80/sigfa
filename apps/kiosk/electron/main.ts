/**
 * KIOSK-001 — electron/main.ts
 * Processus principal Electron — shell minimal kiosque.
 * Exporte KIOSK_WINDOW_CONFIG pour les tests (sans dépendance Electron à l'import).
 *
 * Boucle 2 F4 (S5) : le processus principal est le SEUL détenteur du secret de
 * provisionnement (KIOSK_SECRET, lu depuis `.env`). Il crée la session borne
 * (POST /kiosk/session via @sigfa/contracts) sur demande IPC du renderer et ne
 * lui renvoie que le JWT — le secret n'atteint jamais le bundle client.
 */
import { fileURLToPath } from "node:url";
import {
  createKioskSession,
  type KioskSession,
} from "@/lib/kiosk-session";
import { KIOSK_SESSION_CREATE_CHANNEL } from "./kiosk-session-ipc";

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

/** Paramètres de provisionnement de la session borne (main process only). */
export interface KioskProvisioningEnv {
  kioskId: string;
  kioskSecret: string;
  agencyId: string;
  apiUrl: string;
}

/**
 * Lit KIOSK_ID / KIOSK_SECRET / AGENCY_ID depuis l'environnement (story
 * KIOSK-001 : « kioskId + kioskSecret + agencyId depuis .env »).
 * Env incomplet → null : borne non provisionnée, mode dégradé sans crash.
 */
export function readKioskProvisioningEnv(
  env: NodeJS.ProcessEnv
): KioskProvisioningEnv | null {
  const kioskId = env["KIOSK_ID"];
  const kioskSecret = env["KIOSK_SECRET"];
  const agencyId = env["AGENCY_ID"];
  if (!kioskId || !kioskSecret || !agencyId) return null;

  return {
    kioskId,
    kioskSecret,
    agencyId,
    apiUrl:
      env["KIOSK_API_URL"] ?? env["MOCK_API_URL"] ?? "http://localhost:4010",
  };
}

/**
 * Handler IPC `kiosk:session:create` : crée la session borne côté MAIN process
 * et renvoie le JWT (jamais le secret) au renderer. Null en cas d'échec —
 * le renderer bascule en mode dégradé (retry silencieux KioskSessionProvider).
 */
export async function handleKioskSessionCreate(
  env: NodeJS.ProcessEnv = process.env
): Promise<KioskSession | null> {
  const provisioning = readKioskProvisioningEnv(env);
  if (!provisioning) return null;
  return createKioskSession(provisioning);
}

/**
 * Chemin du preload compilé (CommonJS requis par sandbox:true).
 * `electron/preload.ts` est compilé vers `preload.cjs` au packaging.
 */
export function resolvePreloadPath(): string {
  const url = new URL("preload.cjs", import.meta.url);
  // En bundle de test, import.meta.url peut ne pas être un file:// — on
  // retombe alors sur le pathname (le runtime Electron réel est en file://).
  return url.protocol === "file:" ? fileURLToPath(url) : url.pathname;
}

/**
 * Lance la fenêtre principale Electron.
 * Cette fonction n'est appelée que dans le processus principal Electron,
 * jamais dans les tests unitaires.
 */
export async function createMainWindow(): Promise<void> {
  const { app, BrowserWindow, ipcMain } = await import("electron");

  // S5 : provisionnement de session borne servi par le main process.
  ipcMain.handle(KIOSK_SESSION_CREATE_CHANNEL, () => handleKioskSessionCreate());

  const win = new BrowserWindow({
    ...KIOSK_WINDOW_CONFIG,
    webPreferences: {
      ...KIOSK_WINDOW_CONFIG.webPreferences,
      preload: resolvePreloadPath(),
    },
  });

  const startUrl =
    process.env["ELECTRON_START_URL"] ?? "http://localhost:3002";
  await win.loadURL(startUrl);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
