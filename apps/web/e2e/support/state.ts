/**
 * État partagé du harnais E2E (RT-003) — pont entre globalSetup et les specs.
 *
 * globalSetup écrit les fixtures + URLs dans un fichier JSON temporaire ; les
 * specs le relisent (les workers Playwright sont des process séparés, aucune
 * mémoire partagée).
 *
 * @module e2e/support/state
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Fichier d'état (ignoré par git via e2e/.gitignore). Playwright charge ce
 * module en CJS → `__dirname` disponible (pas d'`import.meta`). */
export const STATE_FILE = join(__dirname, "..", ".e2e-state.json");

/** Forme de l'état persisté pour les specs. */
export interface E2eState {
  /** Base URL de l'app web (Next). */
  webBaseUrl: string;
  /** Origine de l'API réelle (HTTP + WS). */
  apiOrigin: string;
  /** Base REST /api/v1. */
  apiBase: string;
  /** JWT agent (scope agence). */
  agentToken: string;
  /** JWT BANK_ADMIN (scope banque) — console theming ADM-001b. */
  adminToken: string;
  bankId: string;
  agencyId: string;
  serviceId: string;
  queueId: string;
  counterId: string;
  agentId: string;
  kioskId: string;
}

/** Persiste l'état pour les workers. */
export function writeState(state: E2eState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

/** Relit l'état persisté (appelé par les specs). */
export function readState(): E2eState {
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as E2eState;
}
