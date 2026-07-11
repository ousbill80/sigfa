/**
 * KIOSK-001 — __mocks__/electron.ts
 * Stub Electron pour les tests unitaires (hors runtime Electron).
 * Le pattern CI/CD adopté teste la logique métier sans lancer Electron.
 */

export const app = {
  whenReady: () => Promise.resolve(),
  on: () => {},
  quit: () => {},
};

export const BrowserWindow = class {
  loadURL(_url: string) {
    return Promise.resolve();
  }
};
