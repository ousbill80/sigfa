import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const CONTRACTS_VERSION = "0.0.0";

/**
 * Chemins absolus vers les fichiers OpenAPI YAML du contrat SIGFA.
 * Utilisés par les tests structurels et les outils de génération (CONTRACT-009).
 */
export const OPENAPI_PATHS = {
  /** Contrat cœur : auth, banks, agencies, services, counters, queues, tickets */
  core: resolve(__dirname, "../openapi/core.yaml"),
} as const;

// CONTRACT-002 : événements Socket.io temps réel
// eslint-disable-next-line no-restricted-imports
export * from "../events/realtime.js";
