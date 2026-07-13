/**
 * realtime — bus d'événements typé et validé par Zod (injectable).
 *
 * RT-001a : les payloads émis vers le bus sont désormais conformes AU CONTRAT
 * (`packages/contracts/events/realtime.ts`, chaque `*.payloadSchema`). Les
 * `EVENT_SCHEMAS` ci-dessous TRANSCRIVENT ces schémas contractuels (le contrat
 * reste LA LOI ; une suite de PARITÉ importe le contrat et prouve l'équivalence
 * champ à champ, par événement — cf. `contract-parity.test.ts`).
 *
 * Signature du bus : `emit(event, agencyId, payload)`. L'`agencyId` en 2e
 * position est la room cible (`agency:{agencyId}`) ; le payload est la forme
 * CONTRAT de l'événement.
 *
 * Le bus est INJECTABLE :
 *  - production : `createSocketBus(io)` (diffusion Socket.io après validation) ;
 *  - production sans socket (`REALTIME_MODE=off`) : `createNoopBus` (valide, ne
 *    transporte pas) ;
 *  - test : `createCaptureBus` (capture `(event, agencyId, payload)` validés).
 *
 * @module
 */

import { z } from "zod";
import { SigfaError } from "src/lib/errors.js";

// ─── Fragments réutilisés (transcription du contrat CONTRACT-002) ────────────

/** Statuts de ticket (contrat `ticketStatusSchema`). */
const ticketStatusSchema = z.enum([
  "WAITING",
  "CALLED",
  "SERVING",
  "DONE",
  "NO_SHOW",
  "ABANDONED",
  "TRANSFERRED",
]);

/** Canaux d'émission (contrat `ticketChannelSchema`). */
const ticketChannelSchema = z.enum(["KIOSK", "QR", "MOBILE", "WHATSAPP"]);

/** Statut de guichet (contrat `counterStatusEnumSchema`). */
const counterStatusEnumSchema = z.enum(["OPEN", "PAUSED", "CLOSED"]);

/** Résumé de ticket embarqué (contrat `ticketSummarySchema`). */
const ticketSummarySchema = z.object({
  id: z.string().uuid(),
  number: z.string().min(1),
  status: ticketStatusSchema,
  serviceId: z.string().uuid(),
  agencyId: z.string().uuid(),
  channel: ticketChannelSchema,
  createdAt: z.string().datetime(),
});

/** Résumé de guichet embarqué (contrat `counterSummarySchema`). */
const counterSummarySchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
});

// ─── Schémas de payload — forme CONTRAT par événement ────────────────────────

/** Schéma du payload `ticket:created` (contrat `ticketCreatedEvent`). */
export const ticketCreatedSchema = z.object({
  ticket: ticketSummarySchema,
  position: z.number().int().min(0),
  estimate: z.number().int().min(0),
});

/** Schéma du payload `ticket:called` (contrat `ticketCalledEvent`). */
export const ticketCalledSchema = z.object({
  ticket: ticketSummarySchema,
  counter: counterSummarySchema,
});

/** Schéma du payload `ticket:closed` (contrat `ticketClosedEvent`). */
export const ticketClosedSchema = z.object({
  ticketId: z.string().uuid(),
  waitTime: z.number().int().min(0),
  serviceTime: z.number().int().min(0),
});

/** Schéma du payload `queue:updated` (contrat `queueUpdatedEvent`). */
export const queueUpdatedSchema = z.object({
  queueId: z.string().uuid(),
  length: z.number().int().min(0),
  estimate: z.number().int().min(0),
});

/**
 * Types d'alertes manager — contrat `alertManagerTypeSchema`. Énuméré fermé :
 * QUEUE_CRITICAL (API-004), KIOSK_SYSTEM_ERROR (API-005), AGENT_INACTIVE /
 * AGENT_DISCONNECTED_WITH_TICKET / SLA_BREACH (API-007).
 */
export const alertManagerTypeSchema = z.enum([
  "AGENT_INACTIVE",
  "AGENT_DISCONNECTED_WITH_TICKET",
  "SLA_BREACH",
  "QUEUE_CRITICAL",
  "KIOSK_SYSTEM_ERROR",
]);

/** Schéma du payload `alert:manager` (contrat `alertManagerEvent`). */
export const alertManagerSchema = z.object({
  type: alertManagerTypeSchema,
  payload: z.record(z.string(), z.unknown()),
});

/** Schéma du payload `counter:status` (contrat `counterStatusEvent`). */
export const counterStatusSchema = z.object({
  counterId: z.string().uuid(),
  status: counterStatusEnumSchema,
  agentId: z.string().uuid().optional(),
});

/** Schéma du payload `kiosk:printer-error` (contrat `kioskPrinterErrorEvent`). */
export const kioskPrinterErrorSchema = z.object({
  kioskId: z.string().uuid(),
  agencyId: z.string().uuid(),
  since: z.string().datetime(),
});

/**
 * Statut de supervision d'une borne — contrat `KioskStatus` (admin.yaml,
 * CONTRACT-013 / ADM-003). Énuméré fermé, transcrit du contrat.
 */
export const kioskSupervisionStatusSchema = z.enum([
  "ONLINE",
  "DEGRADED",
  "SILENT",
  "NEVER_SEEN",
]);

/**
 * Schéma commun des payloads de supervision borne (`kiosk:silent`,
 * `kiosk:recovered`, `kiosk:status`) — contrat CONTRACT-013 / ADM-003. PII-free :
 * identifiants + statut + horodatage uniquement. Ces trois événements partagent
 * exactement la même forme au contrat.
 */
const kioskSupervisionPayloadSchema = z.object({
  kioskId: z.string().uuid(),
  agencyId: z.string().uuid(),
  status: kioskSupervisionStatusSchema,
  since: z.string().datetime(),
});

/** Schéma du payload `kiosk:silent` (contrat `kioskSilentEvent`). */
export const kioskSilentSchema = kioskSupervisionPayloadSchema;

/** Schéma du payload `kiosk:recovered` (contrat `kioskRecoveredEvent`). */
export const kioskRecoveredSchema = kioskSupervisionPayloadSchema;

/** Schéma du payload `kiosk:status` (contrat `kioskStatusEvent`). */
export const kioskStatusSchema = kioskSupervisionPayloadSchema;

/** Association nom d'événement → schéma Zod du payload (forme CONTRAT). */
export const EVENT_SCHEMAS = {
  "ticket:created": ticketCreatedSchema,
  "ticket:called": ticketCalledSchema,
  "ticket:closed": ticketClosedSchema,
  "queue:updated": queueUpdatedSchema,
  "counter:status": counterStatusSchema,
  "alert:manager": alertManagerSchema,
  "kiosk:printer-error": kioskPrinterErrorSchema,
  // ── CONTRACT-013 / ADM-003 : supervision borne (STAFF, fail-closed) ────────
  // Absents de DISPLAY_EVENTS → diffusés vers `agency:{id}:staff` (jamais la room
  // publique DISPLAY). Cf. TV-hardening F-SEC-TV-01.
  "kiosk:silent": kioskSilentSchema,
  "kiosk:recovered": kioskRecoveredSchema,
  "kiosk:status": kioskStatusSchema,
} as const;

/** Noms d'événements supportés (les 7 événements serveur→client). */
export type EventName = keyof typeof EVENT_SCHEMAS;

/**
 * ALLOWLIST des événements d'AFFICHAGE (F-SEC-TV-01) — diffusés vers `agency:{id}`,
 * la room que rejoint aussi l'écran mural PUBLIC (token DISPLAY, CONTRACT-013).
 *
 * Ne contient QUE les signaux d'affichage sans sensibilité de supervision :
 *   - `ticket:called` : numéro appelé + libellé de guichet (l'écran mural du hall) ;
 *   - `queue:updated`  : longueur/estimation de file (bandeau d'attente).
 * `sync:state` (resync) n'est PAS un événement de bus : il est émis directement à
 * la socket demandeuse par `handleSyncRequest` (donc lisible par DISPLAY sans room).
 *
 * TOUT autre événement (`ticket:created`, `ticket:closed`, `counter:status`,
 * `alert:manager`, `kiosk:printer-error`, et tout événement FUTUR non listé ici)
 * est un signal STAFF : il est diffusé vers `agency:{id}:staff`, room que seules
 * les sockets authentifiées staff rejoignent et que DISPLAY ne rejoint JAMAIS.
 * Approche défensive : un nouvel événement est staff PAR DÉFAUT (fail-closed).
 */
export const DISPLAY_EVENTS = ["ticket:called", "queue:updated"] as const satisfies EventName[];

/** Ensemble des événements d'affichage (lookup O(1), fail-closed pour le reste). */
const DISPLAY_EVENT_SET = new Set<EventName>(DISPLAY_EVENTS);

/**
 * Indique si un événement est un signal d'AFFICHAGE (room publique `agency:{id}`)
 * ou un signal STAFF (room réservée `agency:{id}:staff`). Défensif : tout ce qui
 * n'est pas explicitement dans l'allowlist est traité comme STAFF (fail-closed).
 *
 * @param event - Nom de l'événement serveur→client
 * @returns `true` si l'événement peut être diffusé vers la room publique DISPLAY
 */
export function isDisplayEvent(event: EventName): boolean {
  return DISPLAY_EVENT_SET.has(event);
}

/**
 * Room d'affichage PUBLIC d'une agence (`agency:{id}`). Rejointe par TOUTES les
 * sockets de l'agence, y compris l'écran mural DISPLAY.
 *
 * @param agencyId - Identifiant de l'agence
 * @returns Nom de la room publique
 */
export function displayRoom(agencyId: string): string {
  return `agency:${agencyId}`;
}

/**
 * Room STAFF d'une agence (`agency:{id}:staff`). Rejointe UNIQUEMENT par les
 * sockets authentifiées staff (agent/manager/director/…). Le DISPLAY ne la
 * rejoint JAMAIS → il ne peut recevoir aucun signal de supervision (F-SEC-TV-01).
 *
 * @param agencyId - Identifiant de l'agence
 * @returns Nom de la room staff
 */
export function staffRoom(agencyId: string): string {
  return `agency:${agencyId}:staff`;
}

/** Type du payload pour un événement donné. */
export type EventPayload<E extends EventName> = z.infer<(typeof EVENT_SCHEMAS)[E]>;

/** Contrat d'un bus temps réel injectable. */
export interface RealtimeBus {
  /**
   * Émet un événement typé après validation Zod du payload (forme contrat).
   * @param event    - Nom de l'événement
   * @param agencyId - Agence cible (room `agency:{agencyId}`)
   * @param payload  - Payload conforme au schéma CONTRAT de l'événement
   */
  emit<E extends EventName>(event: E, agencyId: string, payload: EventPayload<E>): void;
}

/** Événement capturé (pour les tests). */
export interface CapturedEvent {
  event: EventName;
  agencyId: string;
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
 * Valide un payload contre le schéma (forme contrat) de son événement.
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
 * Crée un bus de capture pour les tests : chaque `emit` valide puis mémorise
 * `(event, agencyId, payload)`.
 * @returns Bus de capture avec la liste `events`
 */
export function createCaptureBus(): CaptureBus {
  const events: CapturedEvent[] = [];
  return {
    events,
    emit<E extends EventName>(event: E, agencyId: string, payload: EventPayload<E>): void {
      validateEvent(event, payload);
      events.push({ event, agencyId, payload, at: Date.now() });
    },
    ofType<E extends EventName>(event: E): CapturedEvent[] {
      return events.filter((e) => e.event === event);
    },
  };
}

/**
 * Crée un bus « no-op » validant (émissions silencieuses en production sans
 * adaptateur socket branché — `REALTIME_MODE=off`). Valide toujours le payload.
 * @returns Bus qui valide sans transporter
 */
export function createNoopBus(): RealtimeBus {
  return {
    emit<E extends EventName>(event: E, _agencyId: string, payload: EventPayload<E>): void {
      validateEvent(event, payload);
    },
  };
}
