/**
 * realtime — bus d'événements typé et validé par Zod (injectable).
 *
 * RT-001a : les payloads émis vers le bus sont validés directement contre LE
 * CONTRAT (`packages/contracts/events/realtime.ts`, chaque `*.payloadSchema`).
 * `EVENT_SCHEMAS` RÉFÉRENCE ces schémas contractuels (aucune transcription :
 * le contrat est l'unique source de vérité, importé tel quel). Depuis
 * l'unification zod v4 (CHORE-ZOD-V4-UNIFY), api et contracts partagent la même
 * version de zod ; la duplication historique (et sa suite de parité) n'a plus
 * lieu d'être.
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

import type { z } from "zod";
import {
  ticketCreatedEvent,
  ticketCalledEvent,
  ticketClosedEvent,
  queueUpdatedEvent,
  counterStatusEvent,
  alertManagerEvent,
  kioskPrinterErrorEvent,
  kioskSilentEvent,
  kioskRecoveredEvent,
  kioskStatusEvent,
} from "@sigfa/contracts/events/realtime.js";
import { SigfaError } from "src/lib/errors.js";

// ─── Schémas de payload — LE CONTRAT (CONTRACT-002), sans transcription ───────

/**
 * Schéma du payload `queue:updated` (contrat `queueUpdatedEvent`). Réexporté
 * ici car consommé directement par la suite unitaire du bus (`realtime.test.ts`).
 */
export const queueUpdatedSchema = queueUpdatedEvent.payloadSchema;

/**
 * Schéma du payload `alert:manager` (contrat `alertManagerEvent`). Réexporté ici
 * car consommé directement par la suite unitaire du bus (`realtime.test.ts`).
 */
export const alertManagerSchema = alertManagerEvent.payloadSchema;

/**
 * Association nom d'événement → schéma Zod du payload. Chaque schéma provient
 * DIRECTEMENT du contrat (`*.payloadSchema`) : le contrat est LA LOI, référencée
 * sans copie.
 */
export const EVENT_SCHEMAS = {
  "ticket:created": ticketCreatedEvent.payloadSchema,
  "ticket:called": ticketCalledEvent.payloadSchema,
  "ticket:closed": ticketClosedEvent.payloadSchema,
  "queue:updated": queueUpdatedEvent.payloadSchema,
  "counter:status": counterStatusEvent.payloadSchema,
  "alert:manager": alertManagerEvent.payloadSchema,
  "kiosk:printer-error": kioskPrinterErrorEvent.payloadSchema,
  // ── CONTRACT-013 / ADM-003 : supervision borne (STAFF, fail-closed) ────────
  // Absents de DISPLAY_EVENTS → diffusés vers `agency:{id}:staff` (jamais la room
  // publique DISPLAY). Cf. TV-hardening F-SEC-TV-01.
  "kiosk:silent": kioskSilentEvent.payloadSchema,
  "kiosk:recovered": kioskRecoveredEvent.payloadSchema,
  "kiosk:status": kioskStatusEvent.payloadSchema,
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
