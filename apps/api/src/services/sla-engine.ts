/**
 * sla-engine — machine à états STRICTE du ticket + calculs de durées.
 *
 * LA LOI (API-003) : 7 états, transitions légales exhaustives. Toute transition
 * illégale lève `ILLEGAL_TRANSITION`. Les durées wait/service sont calculées à
 * partir des horodatages (secondes entières, jamais négatives).
 *
 * Ce module est PUR : aucune I/O, testable avec des fake timers.
 *
 * @module
 */

import { SigfaError } from "src/lib/errors.js";

/** Les 7 états de la machine à états du ticket (LA LOI `TicketStatus`). */
export type TicketStatus =
  | "WAITING"
  | "CALLED"
  | "SERVING"
  | "DONE"
  | "NO_SHOW"
  | "ABANDONED"
  | "TRANSFERRED";

/** Actions déclenchant une transition d'état. */
export type TicketAction =
  | "call"
  | "serve"
  | "close"
  | "no-show"
  | "transfer"
  | "abandon";

/**
 * Table des transitions légales : état source → action → état cible.
 * Toute (état, action) absente est une transition illégale.
 */
const TRANSITIONS: Record<TicketStatus, Partial<Record<TicketAction, TicketStatus>>> = {
  WAITING: { call: "CALLED", abandon: "ABANDONED" },
  CALLED: {
    serve: "SERVING",
    "no-show": "NO_SHOW",
    transfer: "TRANSFERRED",
    abandon: "ABANDONED",
    call: "CALLED",
  },
  SERVING: { close: "DONE", transfer: "TRANSFERRED" },
  DONE: {},
  NO_SHOW: {},
  ABANDONED: {},
  TRANSFERRED: {},
};

/**
 * Résout l'état cible d'une transition, ou lève `ILLEGAL_TRANSITION` (409).
 *
 * @param from   - État courant du ticket
 * @param action - Action demandée
 * @returns État cible légal
 * @throws {SigfaError} 409 ILLEGAL_TRANSITION si la transition n'est pas permise
 */
export function nextStatus(from: TicketStatus, action: TicketAction): TicketStatus {
  const target = TRANSITIONS[from][action];
  if (target === undefined) {
    throw new SigfaError(
      "ILLEGAL_TRANSITION",
      `Transition illégale depuis l'état ${from}.`,
      409,
      { currentStatus: from, requestedTransition: action }
    );
  }
  return target;
}

/**
 * Indique si une transition (état, action) est légale sans lever d'erreur.
 *
 * @param from   - État courant
 * @param action - Action demandée
 */
export function canTransition(from: TicketStatus, action: TicketAction): boolean {
  return TRANSITIONS[from][action] !== undefined;
}

/** Différence en secondes entières bornée à ≥0 entre deux instants. */
function diffSeconds(from: Date, to: Date): number {
  const seconds = Math.round((to.getTime() - from.getTime()) / 1000);
  return seconds < 0 ? 0 : seconds;
}

/**
 * Calcule le temps d'attente : de l'émission (issuedAt) à l'appel (calledAt).
 *
 * @param issuedAt - Horodatage d'émission
 * @param calledAt - Horodatage d'appel
 * @returns Temps d'attente en secondes (≥0)
 */
export function computeWaitSeconds(issuedAt: Date, calledAt: Date): number {
  return diffSeconds(issuedAt, calledAt);
}

/**
 * Calcule le temps de service : du début de service (servedAt) à la clôture.
 *
 * @param servedAt - Horodatage de début de service
 * @param closedAt - Horodatage de clôture
 * @returns Temps de service en secondes (≥0)
 */
export function computeServiceSeconds(servedAt: Date, closedAt: Date): number {
  return diffSeconds(servedAt, closedAt);
}
