/**
 * Browser-safe entry for @sigfa/contracts.
 *
 * The package barrel (dist/src/index.js) re-exports OPENAPI_PATHS, which pulls
 * in node:url / node:path and cannot be bundled for the browser. Web only needs
 * the realtime event schemas (CONTRACT-002) and the typed client factory
 * (CONTRACT-009a) — both are node-free — so we re-export just those here and
 * alias `@sigfa/contracts` to this module (vitest / next / tsconfig).
 *
 * @module lib/contracts-entry
 */
// eslint-disable-next-line no-restricted-imports
export * from "../../../../packages/contracts/dist/events/realtime.js";
// eslint-disable-next-line no-restricted-imports
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
} from "../../../../packages/contracts/dist/src/client.js";
