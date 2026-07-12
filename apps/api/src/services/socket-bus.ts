/**
 * socket-bus — adaptateur `RealtimeBus` ↔ Socket.io (RT-001a).
 *
 * `createSocketBus(io)` implémente `RealtimeBus` :
 *   `emit(event, agencyId, payload)` →
 *     1. valide `payload` contre le `payloadSchema` du CONTRAT de l'événement
 *        (transcrit dans `EVENT_SCHEMAS`, `services/realtime.ts` ; parité prouvée
 *        par `socket-bus.test.ts` / `contract-parity.test.ts`) ;
 *     2. payload invalide → NON diffusé + log d'erreur (JAMAIS de throw : une
 *        émission fautive ne casse ni la requête ni les émissions valides) ;
 *     3. payload valide → `io.to('agency:'+agencyId).emit(event, payload)`.
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
      io.to(`agency:${agencyId}`).emit(event, result.data);
    },
  };
}
