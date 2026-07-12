/**
 * realtime — bus d'événements typé et validé par Zod (injectable).
 *
 * LA LOI (API-003) : les événements `ticket:created`, `ticket:called`,
 * `ticket:closed` et `queue:updated` sont émis en <500 ms. Le payload de
 * `queue:updated` ne porte QUE `{ length, estimate }` (jamais de liste de
 * tickets). Chaque émission est validée par un schéma Zod : un payload non
 * conforme lève une `SigfaError` interne, jamais un événement corrompu.
 *
 * Le bus est INJECTABLE : en production on branche un adaptateur Socket.io ;
 * en test on injecte un bus de capture (`createCaptureBus`).
 *
 * @module
 */

import { z } from "zod";
import { SigfaError } from "src/lib/errors.js";

/** Schéma du payload `ticket:created`. */
export const ticketCreatedSchema = z.object({
  ticketId: z.string().uuid(),
  queueId: z.string().uuid(),
  agencyId: z.string().uuid(),
  displayNumber: z.string(),
  status: z.literal("WAITING"),
});

/** Schéma du payload `ticket:called`. */
export const ticketCalledSchema = z.object({
  ticketId: z.string().uuid(),
  queueId: z.string().uuid(),
  counterId: z.string().uuid(),
  displayNumber: z.string(),
  status: z.literal("CALLED"),
});

/** Schéma du payload `ticket:closed`. */
export const ticketClosedSchema = z.object({
  ticketId: z.string().uuid(),
  queueId: z.string().uuid(),
  counterId: z.string().uuid(),
  status: z.literal("DONE"),
  waitTime: z.number().int().nonnegative(),
  serviceTime: z.number().int().nonnegative(),
});

/**
 * Schéma du payload `queue:updated` — STRICT : uniquement `length` + `estimate`.
 * `.strict()` rejette toute clé supplémentaire (ex: une liste de tickets).
 */
export const queueUpdatedSchema = z
  .object({
    queueId: z.string().uuid(),
    length: z.number().int().nonnegative(),
    estimate: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Types d'alertes manager — LA LOI `alertManagerEvent.payloadSchema`
 * (packages/contracts/events/realtime.ts). Énuméré fermé : aucune fuite hors
 * contrat. QUEUE_CRITICAL (API-004), KIOSK_SYSTEM_ERROR (API-005),
 * AGENT_INACTIVE / AGENT_DISCONNECTED_WITH_TICKET / SLA_BREACH (API-007).
 */
export const alertManagerTypeSchema = z.enum([
  "AGENT_INACTIVE",
  "AGENT_DISCONNECTED_WITH_TICKET",
  "SLA_BREACH",
  "QUEUE_CRITICAL",
  "KIOSK_SYSTEM_ERROR",
]);

/**
 * Schéma UNIQUE du payload `alert:manager` — forme contractuelle `{ type, payload }`.
 * API-007 : l'union héritée (`alertManagerOverflowSchema`) est SUPPRIMÉE ; toutes
 * les alertes (dont QUEUE_CRITICAL migrée) transitent désormais par cette forme.
 */
export const alertManagerSchema = z.object({
  type: alertManagerTypeSchema,
  payload: z.record(z.string(), z.unknown()),
});

/** Schéma du payload `counter:status` (LA LOI CONTRACT-002 `counterStatusEvent`). */
export const counterStatusSchema = z.object({
  counterId: z.string().uuid(),
  status: z.enum(["OPEN", "PAUSED", "CLOSED"]),
  agentId: z.string().uuid().optional(),
});

/** Association nom d'événement → schéma Zod du payload. */
const EVENT_SCHEMAS = {
  "ticket:created": ticketCreatedSchema,
  "ticket:called": ticketCalledSchema,
  "ticket:closed": ticketClosedSchema,
  "queue:updated": queueUpdatedSchema,
  "counter:status": counterStatusSchema,
  "alert:manager": alertManagerSchema,
} as const;

/** Noms d'événements supportés. */
export type EventName = keyof typeof EVENT_SCHEMAS;

/** Type du payload pour un événement donné. */
export type EventPayload<E extends EventName> = z.infer<(typeof EVENT_SCHEMAS)[E]>;

/** Contrat d'un bus temps réel injectable. */
export interface RealtimeBus {
  /**
   * Émet un événement typé après validation Zod du payload.
   * @param event   - Nom de l'événement
   * @param payload - Payload conforme au schéma de l'événement
   */
  emit<E extends EventName>(event: E, payload: EventPayload<E>): void;
}

/** Événement capturé (pour les tests). */
export interface CapturedEvent {
  event: EventName;
  payload: unknown;
  at: number;
}

/** Bus de capture — mémorise chaque émission validée (tests). */
export interface CaptureBus extends RealtimeBus {
  /** Événements capturés dans l'ordre d'émission. */
  readonly events: CapturedEvent[];
  /** Retourne les événements d'un type donné. */
  ofType<E extends EventName>(event: E): CapturedEvent[];
}

/**
 * Valide un payload contre le schéma de son événement.
 * @param event   - Nom de l'événement
 * @param payload - Payload à valider
 * @throws {SigfaError} 500 REALTIME_INVALID_PAYLOAD si non conforme
 */
export function validateEvent<E extends EventName>(event: E, payload: EventPayload<E>): void {
  const schema = EVENT_SCHEMAS[event];
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new SigfaError(
      "REALTIME_INVALID_PAYLOAD",
      `Payload d'événement ${event} invalide.`,
      500,
      { issues: result.error.issues }
    );
  }
}

/**
 * Crée un bus de capture pour les tests : chaque `emit` valide puis mémorise.
 * @returns Bus de capture avec la liste `events`
 */
export function createCaptureBus(): CaptureBus {
  const events: CapturedEvent[] = [];
  return {
    events,
    emit<E extends EventName>(event: E, payload: EventPayload<E>): void {
      validateEvent(event, payload);
      events.push({ event, payload, at: Date.now() });
    },
    ofType<E extends EventName>(event: E): CapturedEvent[] {
      return events.filter((e) => e.event === event);
    },
  };
}

/**
 * Crée un bus « no-op » validant (émissions silencieuses en production sans
 * adaptateur socket branché). Valide toujours le payload.
 * @returns Bus qui valide sans transporter
 */
export function createNoopBus(): RealtimeBus {
  return {
    emit<E extends EventName>(event: E, payload: EventPayload<E>): void {
      validateEvent(event, payload);
    },
  };
}
