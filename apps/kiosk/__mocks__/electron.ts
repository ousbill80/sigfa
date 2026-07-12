/**
 * KIOSK-001 — __mocks__/electron.ts
 * Stub Electron pour les tests unitaires (hors runtime Electron).
 * Le pattern CI/CD adopté teste la logique métier sans lancer Electron.
 *
 * Boucle 2 F4 (S5) : ajout des stubs IPC (ipcMain/ipcRenderer/contextBridge)
 * pour tester le provisionnement de la session borne côté processus principal.
 */

export const app = {
  whenReady: () => Promise.resolve(),
  on: () => {},
  quit: () => {},
};

type IpcHandler = (...args: unknown[]) => unknown;

export const ipcMain = {
  /** Handlers enregistrés — inspectables par les tests. */
  handlers: new Map<string, IpcHandler>(),
  handle(channel: string, handler: IpcHandler): void {
    this.handlers.set(channel, handler);
  },
};

export const ipcRenderer = {
  /** Canaux invoqués — inspectables par les tests. */
  invocations: [] as string[],
  invoke(channel: string): Promise<unknown> {
    this.invocations.push(channel);
    const handler = ipcMain.handlers.get(channel);
    return Promise.resolve(handler ? handler() : null);
  },
};

export const contextBridge = {
  /** APIs exposées au renderer — inspectables par les tests. */
  exposed: new Map<string, unknown>(),
  exposeInMainWorld(key: string, api: unknown): void {
    this.exposed.set(key, api);
  },
};

export class BrowserWindow {
  /** Dernières options de fenêtre — inspectables par les tests. */
  static lastOptions: Record<string, unknown> | undefined;

  constructor(options?: Record<string, unknown>) {
    BrowserWindow.lastOptions = options;
  }

  loadURL(_url: string) {
    return Promise.resolve();
  }
}
