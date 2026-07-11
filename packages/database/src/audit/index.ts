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
 * `tickets` en est INTENTIONNELLEMENT absente (fréquence d'UPDATE incompatible avec
 * un trigger synchrone) — journalisée applicativement par SEC-001 via `insertAuditEntry()`.
 * Cette liste est verrouillée par test (DB-004).
 */
export const AUDITED_TABLES = [
  "banks",
  "agencies",
  "services",
  "counters",
  "users",
  "kiosks",
] as const;

/**
 * Motifs de nom des colonnes sensibles EXCLUES du `diff` d'audit.
 * Robuste aux colonnes futures (matching par suffixe de nom).
 */
export const SENSITIVE_COLUMN_SUFFIXES = ["_hash", "_encrypted", "_cipher"] as const;
