/**
 * KIOSK-005b (audit F8) — Store mémoire du libellé d'opération choisi.
 *
 * Constat audit : l'OPÉRATION choisie n'était jamais montrée au client (ni sur
 * la confirmation, ni sur le Moment Ticket) — impossible de vérifier son choix
 * d'un coup d'œil. Ce store transporte le libellé PUBLIC (non-PII, ex.
 * « Retrait espèces ») d'OperationsScreen jusqu'à l'écran ticket, via une
 * simple variable de module (même patron éprouvé que `ticket-moment-store`) :
 *  - purge automatique après TTL (un parcours borne dure bien moins de 5 min) ;
 *  - purge explicite (départ de l'écran ticket, nouveau parcours) — le libellé
 *    d'un client n'est JAMAIS réaffiché au suivant ;
 *  - rechargement de page → store vide → dégradation propre (eyebrow neutre
 *    « Votre ticket »), jamais de crash.
 */

/**
 * Durée de rétention maximale du libellé (parcours borne complet : choix →
 * confirmation ≤ 30 s d'inactivité → Moment Ticket ≤ 20 s — 5 min couvre large).
 */
export const TICKET_OPERATION_TTL_MS = 300_000;

let currentLabel: string | null = null;
let purgeTimer: ReturnType<typeof setTimeout> | null = null;
let storedAt = 0;

/** Purge le libellé (explicite : départ d'écran, nouveau parcours, tests). */
export function purgeTicketOperationLabel(): void {
  currentLabel = null;
  storedAt = 0;
  if (purgeTimer !== null) {
    clearTimeout(purgeTimer);
    purgeTimer = null;
  }
}

/** Stocke le libellé d'opération choisi et arme la purge automatique. */
export function storeTicketOperationLabel(label: string): void {
  purgeTicketOperationLabel();
  currentLabel = label;
  storedAt = Date.now();
  purgeTimer = setTimeout(() => {
    purgeTicketOperationLabel();
  }, TICKET_OPERATION_TTL_MS);
}

/**
 * Relit le libellé d'opération (lecture non destructive : le rendu React peut
 * relire plusieurs fois). Null si absent ou TTL dépassé — rechargement de page
 * = dégradation propre (eyebrow neutre).
 */
export function readTicketOperationLabel(): string | null {
  if (currentLabel === null) return null;
  if (Date.now() - storedAt > TICKET_OPERATION_TTL_MS) {
    purgeTicketOperationLabel();
    return null;
  }
  return currentLabel;
}
