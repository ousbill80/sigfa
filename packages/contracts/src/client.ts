/**
 * src/client.ts — CONTRACT-009a
 * Client typé SIGFA basé sur openapi-fetch.
 * Expose createSigfaClient(module, baseUrl) pour chaque module OpenAPI.
 *
 * Accès typé par chemin+méthode couvrant 100% des endpoints.
 * Consommé par web/kiosk/mobile.
 */
import createClient from "openapi-fetch";

// Imports des types générés par openapi-typescript (generated/types/<module>.ts)
// Ces fichiers sont dans generated/ — l'import relatif est nécessaire car les types
// sont générés en dehors de src/ (exemption explicite de la règle no-restricted-imports).
// eslint-disable-next-line no-restricted-imports
import type { paths as CorePaths } from "../generated/types/core.js";
// eslint-disable-next-line no-restricted-imports
import type { paths as PublicPaths } from "../generated/types/public.js";
// eslint-disable-next-line no-restricted-imports
import type { paths as AgentsPaths } from "../generated/types/agents.js";
// eslint-disable-next-line no-restricted-imports
import type { paths as AdminPaths } from "../generated/types/admin.js";
// eslint-disable-next-line no-restricted-imports
import type { paths as ReportingPaths } from "../generated/types/reporting.js";
// eslint-disable-next-line no-restricted-imports
import type { paths as NotificationsPaths } from "../generated/types/notifications.js";
// eslint-disable-next-line no-restricted-imports
import type { paths as AiPaths } from "../generated/types/ai.js";

// ─── Types d'union des modules ────────────────────────────────────────────────

export type SigfaModule =
  | "core"
  | "public"
  | "agents"
  | "admin"
  | "reporting"
  | "notifications"
  | "ai";

// ─── Type conditionnel : mappe module → paths ─────────────────────────────────

type ModulePaths = {
  core: CorePaths;
  public: PublicPaths;
  agents: AgentsPaths;
  admin: AdminPaths;
  reporting: ReportingPaths;
  notifications: NotificationsPaths;
  ai: AiPaths;
};

// ─── Options de création du client ───────────────────────────────────────────

export interface SigfaClientOptions {
  /** Token JWT Bearer à inclure dans chaque requête */
  token?: string;
  /** Headers supplémentaires */
  headers?: Record<string, string>;
}

// ─── Factory : createSigfaClient ─────────────────────────────────────────────

/**
 * Crée un client openapi-fetch typé pour un module SIGFA donné.
 *
 * @param module - Le module SIGFA (core, public, agents, admin, reporting, notifications, ai)
 * @param baseUrl - L'URL de base de l'API (ex: "https://api.sigfa.example.com")
 * @param options - Options optionnelles (token JWT, headers)
 * @returns Client openapi-fetch typé par les paths du module
 *
 * @example
 * ```ts
 * const client = createSigfaClient("core", "https://api.sigfa.example.com", {
 *   token: "eyJhbGciOiJIUzI1NiJ9..."
 * });
 * const { data, error } = await client.GET("/tickets/{id}", {
 *   params: { path: { id: "ticket_01" } }
 * });
 * ```
 */
export function createSigfaClient<M extends SigfaModule>(
  module: M,
  baseUrl: string,
  options: SigfaClientOptions = {}
): ReturnType<typeof createClient<ModulePaths[M]>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  // Le cast est nécessaire car TypeScript ne peut pas inférer le type conditionnel
  // retourné par createClient<ModulePaths[M]> via le paramètre générique M.
  return createClient<ModulePaths[M]>({
    baseUrl,
    headers,
  }) as ReturnType<typeof createClient<ModulePaths[M]>>;
}

// ─── Exports des types de paths pour consommation externe ────────────────────

export type {
  CorePaths,
  PublicPaths,
  AgentsPaths,
  AdminPaths,
  ReportingPaths,
  NotificationsPaths,
  AiPaths,
};
