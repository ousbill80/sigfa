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
  /** Contrat agents : profils, planning, performance, import */
  agents: resolve(__dirname, "../openapi/agents.yaml"),
  /** Contrat public / client : tickets, kiosques, feedback */
  public: resolve(__dirname, "../openapi/public.yaml"),
  /** Contrat admin : banques, agences, templates, RGPD */
  admin: resolve(__dirname, "../openapi/admin.yaml"),
  /** Contrat notifications : envois, journal, webhooks, devices */
  notifications: resolve(__dirname, "../openapi/notifications.yaml"),
  /** Contrat reporting & supervision : KPIs, exports, kiosques */
  reporting: resolve(__dirname, "../openapi/reporting.yaml"),
  /** Contrat IA : prévisions, staffing, anomalies, insights */
  ai: resolve(__dirname, "../openapi/ai.yaml"),
} as const;

// CONTRACT-002 : événements Socket.io temps réel
// eslint-disable-next-line no-restricted-imports
export * from "../events/realtime.js";

// CONTRACT-009a : factory client typé + types de paths
export {
  createSigfaClient,
  type SigfaModule,
  type SigfaClientOptions,
  type CorePaths,
  type PublicPaths,
  type AgentsPaths,
  type AdminPaths,
  type ReportingPaths,
  type NotificationsPaths,
  type AiPaths,
} from "./client.js";
