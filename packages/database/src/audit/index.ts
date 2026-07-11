export {
  insertAuditEntry,
} from "./insert-audit-entry.js";

export type {
  AuditEntryInput,
  AuditEntryRow,
  ActorRole,
} from "./insert-audit-entry.js";

/**
 * Liste VERSIONNÉE des tables sensibles portant un trigger d'audit en base.
 *
 * `tickets` en est INTENTIONNELLEMENT absente (fréquence d'UPDATE incompatible avec
 * un trigger synchrone) — journalisée applicativement par SEC-001 via `insertAuditEntry()`.
 *
 * Tables de notifications (DB-005) — décision d'inclusion/exclusion documentée :
 * - `notification_templates` : INCLUSE — configuration bancaire sensible (mutations par BANK_ADMIN).
 * - `notification_log` : EXCLUE — journal haute fréquence, auditer le journal crée une boucle.
 * - `notification_devices` : EXCLUE — fréquence d'upsert élevée, trigger trop bruité.
 * - `notification_consents` : EXCLUE — données pseudonymisées, contexte acteur non résolvable.
 * - `notification_test_recipients` : EXCLUE — volume faible, mutations tracées applicativement.
 *
 * Cette liste est verrouillée par test (DB-004).
 */
export const AUDITED_TABLES = [
  "banks",
  "agencies",
  "services",
  "counters",
  "users",
  "kiosks",
  "notification_templates",
] as const;

/**
 * Motifs de nom des colonnes sensibles EXCLUES du `diff` d'audit.
 * Robuste aux colonnes futures (matching par suffixe de nom).
 */
export const SENSITIVE_COLUMN_SUFFIXES = ["_hash", "_encrypted", "_cipher"] as const;
