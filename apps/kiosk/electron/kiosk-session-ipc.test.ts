/**
 * Boucle 2 F4 — S5 : provisionnement de la session borne côté PROCESSUS
 * PRINCIPAL Electron. Tests TDD écrits AVANT l'implémentation (phase rouge).
 *
 * Le secret (KIOSK_SECRET) ne quitte JAMAIS le main process : il n'est ni dans
 * le bundle client (aucune NEXT_PUBLIC_*), ni dans le renderer. Le renderer ne
 * reçoit que le JWT de session via IPC (preload contextBridge), sans dégrader
 * le durcissement existant (nodeIntegration:false, contextIsolation:true,
 * sandbox:true).
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readKioskProvisioningEnv,
  handleKioskSessionCreate,
  createMainWindow,
  KIOSK_WINDOW_CONFIG,
} from "./main.js";
import { KIOSK_SESSION_CREATE_CHANNEL } from "./kiosk-session-ipc.js";
// L'alias vitest résout "electron" vers __mocks__/electron.ts : on retype les
// stubs inspectables du mock (handlers/invocations/exposed) sans `any`.
import {
  ipcMain as ipcMainElectron,
  ipcRenderer as ipcRendererElectron,
  contextBridge as contextBridgeElectron,
  BrowserWindow as BrowserWindowElectron,
} from "electron";

const ipcMain = ipcMainElectron as unknown as {
  handlers: Map<string, (...args: unknown[]) => unknown>;
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => void;
};
const ipcRenderer = ipcRendererElectron as unknown as {
  invocations: string[];
  invoke: (channel: string) => Promise<unknown>;
};
const contextBridge = contextBridgeElectron as unknown as {
  exposed: Map<string, unknown>;
};
const BrowserWindow = BrowserWindowElectron as unknown as {
  lastOptions: Record<string, unknown> | undefined;
};

const ENV_OK: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  KIOSK_ID: "14141414-1414-4141-a141-141414141414",
  KIOSK_SECRET: "s3cr3t-kiosk-k3y",
  AGENCY_ID: "33333333-3333-4333-a333-333333333333",
  MOCK_API_URL: "http://localhost:4010",
};

const server = setupServer(
  http.post("http://localhost:4010/kiosk/session", () =>
    HttpResponse.json(
      {
        accessToken: "jwt-main-process",
        expiresIn: 43200,
        kioskId: ENV_OK.KIOSK_ID,
        agencyId: ENV_OK.AGENCY_ID,
      },
      { status: 201 }
    )
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

beforeEach(() => {
  ipcMain.handlers.clear();
  ipcRenderer.invocations.length = 0;
  contextBridge.exposed.clear();
});

describe("KIOSK-001/S5: provisionnement session borne — main process Electron", () => {
  it("S5: readKioskProvisioningEnv lit KIOSK_ID/KIOSK_SECRET/AGENCY_ID depuis .env (story KIOSK-001)", () => {
    const cfg = readKioskProvisioningEnv(ENV_OK);
    expect(cfg).toEqual({
      kioskId: ENV_OK.KIOSK_ID,
      kioskSecret: ENV_OK.KIOSK_SECRET,
      agencyId: ENV_OK.AGENCY_ID,
      apiUrl: "http://localhost:4010",
    });
  });

  it("S5: env incomplet (secret absent) → null, borne dégradée sans crash", () => {
    const withoutSecret: NodeJS.ProcessEnv = { ...ENV_OK };
    delete withoutSecret.KIOSK_SECRET;
    expect(readKioskProvisioningEnv(withoutSecret)).toBeNull();
  });

  it("S5: handleKioskSessionCreate → POST /kiosk/session, renvoie le JWT SANS le secret", async () => {
    const session = await handleKioskSessionCreate(ENV_OK);
    expect(session).not.toBeNull();
    expect(session?.accessToken).toBe("jwt-main-process");
    expect(session?.expiresIn).toBe(43200);
    // Le secret ne traverse JAMAIS l'IPC vers le renderer.
    expect(Object.keys(session!)).not.toContain("kioskSecret");
    expect(JSON.stringify(session)).not.toContain("s3cr3t-kiosk-k3y");
  });

  it("S5: handleKioskSessionCreate sans env → null (pas de crash)", async () => {
    const session = await handleKioskSessionCreate({ NODE_ENV: "test" });
    expect(session).toBeNull();
  });

  it("S5: createMainWindow enregistre le handler IPC et PRÉSERVE le durcissement Electron", async () => {
    await createMainWindow();

    // Handler IPC session borne enregistré sur le canal dédié.
    expect(ipcMain.handlers.has(KIOSK_SESSION_CREATE_CHANNEL)).toBe(true);

    // Durcissement inchangé + preload câblé (relevé sain du panel à préserver).
    const options = BrowserWindow.lastOptions as {
      kiosk: boolean;
      fullscreen: boolean;
      webPreferences: {
        nodeIntegration: boolean;
        contextIsolation: boolean;
        sandbox: boolean;
        preload?: string;
      };
    };
    expect(options.kiosk).toBe(true);
    expect(options.fullscreen).toBe(true);
    expect(options.webPreferences.nodeIntegration).toBe(false);
    expect(options.webPreferences.contextIsolation).toBe(true);
    expect(options.webPreferences.sandbox).toBe(true);
    expect(options.webPreferences.preload).toMatch(/preload\.cjs$/);
    // La config statique exportée reste elle aussi durcie.
    expect(KIOSK_WINDOW_CONFIG.webPreferences.nodeIntegration).toBe(false);
    expect(KIOSK_WINDOW_CONFIG.webPreferences.contextIsolation).toBe(true);
    expect(KIOSK_WINDOW_CONFIG.webPreferences.sandbox).toBe(true);
  });

  it("S5: le preload expose kioskAuth.createSession via contextBridge (IPC uniquement)", async () => {
    await createMainWindow();
    await import("./preload.js");

    const api = contextBridge.exposed.get("kioskAuth") as
      | { createSession: () => Promise<unknown> }
      | undefined;
    expect(api).toBeDefined();

    await api!.createSession();
    expect(ipcRenderer.invocations).toContain(KIOSK_SESSION_CREATE_CHANNEL);
  });

  it("S5: le secret ne transite par AUCUNE variable NEXT_PUBLIC_* (bundle client sain)", () => {
    const __filename = fileURLToPath(import.meta.url);
    const appRoot = resolve(dirname(__filename), "..");

    // .env.example : aucune variable NEXT_PUBLIC_* portant un secret.
    const envExample = readFileSync(join(appRoot, ".env.example"), "utf-8");
    expect(envExample).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SECRET/);

    // src/ : KIOSK_SECRET n'apparaît nulle part côté renderer.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry) && !full.includes("__tests__")) {
          const content = readFileSync(full, "utf-8");
          if (content.includes("KIOSK_SECRET") || /NEXT_PUBLIC_[A-Z_]*SECRET/.test(content)) {
            offenders.push(full);
          }
        }
      }
    };
    walk(join(appRoot, "src"));
    expect(offenders).toEqual([]);
  });
});
