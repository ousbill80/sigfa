import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Enums PostgreSQL du schéma cœur SIGFA (DB-001).
 *
 * SOURCE DE VÉRITÉ : LA LOI — contrats OpenAPI bundlés
 * (`packages/contracts/generated/bundled/{core,agents}.yaml`).
 * Toute valeur DOIT correspondre à l'identique aux enums des contrats
 * (test d'alignement `enums.test.ts`).
 *
 * Exception documentée `Role` : le schéma Drizzle est le sous-ensemble strict
 * LA LOI \ {NONE}. `NONE` et `AUTHENTICATED` sont des conventions de route
 * (accès public / authentifié) et n'ont pas de représentation en base — le test
 * assure que `NONE` est absent de `pg_enum`.
 */

/**
 * États du ticket dans la machine à états SIGFA (LA LOI `TicketStatus`, 7 valeurs).
 * Transitions gérées par l'API (API-003/004) — hors périmètre DB-001.
 */
export const ticketStatusEnum = pgEnum("ticket_status", [
  "WAITING",
  "CALLED",
  "SERVING",
  "DONE",
  "NO_SHOW",
  "ABANDONED",
  "TRANSFERRED",
]);

/**
 * Niveau de priorité d'un ticket (LA LOI `TicketPriority`, 5 valeurs — CONTRACT-011).
 * Défaut métier : `STANDARD`. Influence le rang dans le moteur de file (API-004).
 */
export const ticketPriorityEnum = pgEnum("ticket_priority", [
  "STANDARD",
  "PRIORITY",
  "VIP",
  "PMR",
  "SENIOR",
]);

/** Canal d'émission du ticket (LA LOI `TicketChannel`). */
export const ticketChannelEnum = pgEnum("ticket_channel", ["KIOSK", "QR", "MOBILE", "WHATSAPP"]);

/**
 * États de disponibilité d'un agent (LA LOI `AgentStatus`, 5 valeurs).
 * Source de `agent_status_history.from_status` / `to_status`.
 */
export const agentStatusEnum = pgEnum("agent_status", [
  "AVAILABLE",
  "SERVING",
  "PAUSED",
  "ABSENT",
  "OFFLINE",
]);

/** Statut d'un guichet (LA LOI `CounterStatus`). */
export const counterStatusEnum = pgEnum("counter_status", ["OPEN", "PAUSED", "CLOSED"]);

/** Statut d'une file d'attente (LA LOI `QueueStatus`). */
export const queueStatusEnum = pgEnum("queue_status", ["OPEN", "PAUSED", "CLOSED"]);

/** Statut de l'imprimante d'une borne kiosque (LA LOI `PrinterStatus`, 4 valeurs). */
export const printerStatusEnum = pgEnum("printer_status", ["OK", "PAPER_LOW", "ERROR", "OFFLINE"]);

/**
 * Rôles utilisateur (LA LOI `Role` \ {NONE} — sous-ensemble strict documenté).
 * `NONE`/`AUTHENTICATED` restent des conventions de route sans représentation en base.
 */
export const roleEnum = pgEnum("role", [
  "SUPER_ADMIN",
  "BANK_ADMIN",
  "AGENCY_DIRECTOR",
  "MANAGER",
  "AGENT",
  "AUDITOR",
]);

/**
 * Langues parlées par un agent (LA LOI `AgentLanguage`) — données du routage API-004.
 * Décision PO 2026-07 : DIOULA et BAOULE retirés du périmètre (migration 0011).
 */
export const agentLanguageEnum = pgEnum("agent_language", ["FR", "EN"]);
