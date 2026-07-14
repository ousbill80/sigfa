/**
 * socket-bus — adaptateur `RealtimeBus` ↔ Socket.io (RT-001a).
 *
 * `createSocketBus(io)` implémente `RealtimeBus` :
 *   `emit(event, agencyId, payload)` →
 *     1. valide `payload` contre le `payloadSchema` du CONTRAT de l'événement
 *        (référencé DIRECTEMENT dans `EVENT_SCHEMAS`, `services/realtime.ts` :
 *        aucune transcription depuis l'unification zod v4 ; couvert par
 *        `socket-bus.test.ts`) ;
 *     2. payload invalide → NON diffusé + log d'erreur (JAMAIS de throw : une
 *        émission fautive ne casse ni la requête ni les émissions valides) ;
 *     3. payload valide → diffusion vers la room SÉGRÉGÉE PAR RÔLE (F-SEC-TV-01) :
 *        - événement d'AFFICHAGE (allowlist `isDisplayEvent`) → `agency:{id}`
 *          (room publique que rejoint aussi l'écran mural DISPLAY) ;
 *        - événement STAFF (tout le reste, fail-closed) → `agency:{id}:staff`
 *          (room réservée aux sockets authentifiées staff — DISPLAY exclu).
 *
 * Ce module ABSORBE l'ancien `emitTicketCalled` : c'est désormais le chemin
 * d'émission UNIQUE de `ticket:called` (fin de la double forme). Il couvre les
 * 7 événements serveur→client :
 *   ticket:created, ticket:called, ticket:closed, queue:updated, counter:status,
 *   alert:manager, kiosk:printer-error.
 *
 * @module
 */

import type { Server } from "socket.io";
import { logger } from "src/lib/logger.js";
import {
  EVENT_SCHEMAS,
  isDisplayEvent,
  displayRoom,
  staffRoom,
  type EventName,
  type EventPayload,
  type RealtimeBus,
} from "src/services/realtime.js";

/**
 * Crée un bus temps réel diffusant sur Socket.io après validation contrat.
 *
 * @param io - Instance Socket.io (serveur attaché à Hono)
 * @returns Bus conforme à `RealtimeBus`
 */
export function createSocketBus(io: Server): RealtimeBus {
  return {
    emit<E extends EventName>(
      event: E,
      agencyId: string,
      payload: EventPayload<E>
    ): void {
      const schema = EVENT_SCHEMAS[event];
      const result = schema.safeParse(payload);
      if (!result.success) {
        // Payload non conforme au contrat → bloqué + log (jamais de throw).
        logger.error(
          { event, agencyId, issues: result.error.issues },
          "socket-bus:emit:invalid-payload"
        );
        return;
      }
      // Ségrégation par rôle (F-SEC-TV-01) : les signaux d'affichage vont vers la
      // room publique `agency:{id}` (écran mural DISPLAY inclus) ; TOUT le reste
      // (staff/supervision, fail-closed) vers `agency:{id}:staff` (DISPLAY exclu).
      const room = isDisplayEvent(event) ? displayRoom(agencyId) : staffRoom(agencyId);
      io.to(room).emit(event, result.data);
    },
  };
}
