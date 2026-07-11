/**
 * KIOSK-001 — mocks/browser.ts
 * Worker MSW 2.x pour le navigateur (développement / Storybook).
 */
import { setupWorker } from "msw/browser";
import { handlers } from "./handlers.js";

export const worker = setupWorker(...handlers);
