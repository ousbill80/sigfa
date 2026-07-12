/**
 * Browser-safe entry for the realtime event schemas of @sigfa/contracts.
 *
 * L'alias `@sigfa/contracts` du kiosk pointe vers `client.js` (KIOSK-001) et
 * n'expose donc PAS les événements temps réel (CONTRACT-002). Le barrel complet
 * du package tire `OPENAPI_PATHS` (node:url / node:path, non bundlable browser).
 * On ré-exporte donc UNIQUEMENT les schémas d'événements (node-free) depuis le
 * module compilé, comme le fait `apps/web/src/lib/contracts-entry.ts`.
 *
 * @module lib/contracts-realtime
 */
/* eslint-disable no-restricted-imports, import/no-relative-parent-imports -- ré-export browser-safe des schémas d'événements du contrat compilé (cf. entête) */
export * from "../../../../packages/contracts/dist/events/realtime.js";
/* eslint-enable no-restricted-imports, import/no-relative-parent-imports */
