/**
 * KIOSK-001 — mocks/server.ts
 * Serveur MSW 2.x pour les tests Node.js.
 */
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);
