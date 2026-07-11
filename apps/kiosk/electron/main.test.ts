/**
 * KIOSK-001 — Tests TDD pour electron/main.ts
 * Écrits AVANT l'implémentation (phase rouge).
 * Test smoke : vérifie la config Electron sans lancer Electron.
 */
import { describe, it, expect } from "vitest";

describe("KIOSK-001: electron main config", () => {
  it("KIOSK-001: config Electron inclut kiosk:true et fullscreen:true", async () => {
    const { KIOSK_WINDOW_CONFIG } = await import("./main.js");

    expect(KIOSK_WINDOW_CONFIG.kiosk).toBe(true);
    expect(KIOSK_WINDOW_CONFIG.fullscreen).toBe(true);
  });

  it("KIOSK-001: config Electron désactive le menu (autoHideMenuBar)", async () => {
    const { KIOSK_WINDOW_CONFIG } = await import("./main.js");

    expect(KIOSK_WINDOW_CONFIG.autoHideMenuBar).toBe(true);
  });
});
