/**
 * Boucle 2 F4 — S6 : PII du Moment Ticket EN MÉMOIRE, jamais dans l'URL.
 *
 * Constat panel : le téléphone complet + le consentement SMS transitaient par
 * la query string de `/ticket` → PII dans l'historique de navigation d'une
 * borne PARTAGÉE (UEMOA) et dans tout log d'URL.
 *
 * Ce store transporte la PII entre ConfirmationScreen et l'écran ticket via
 * une simple variable de module :
 *  - JAMAIS localStorage / sessionStorage / Dexie ;
 *  - purge automatique après TTL (l'écran ticket s'affiche 4 à 8 s) ;
 *  - purge explicite possible (départ de l'écran, nouveau parcours).
 *
 * Au rechargement de la page /ticket, le store est naturellement vide : l'écran
 * dégrade proprement (ticket sans ligne SMS), sans jamais crasher.
 */

/** PII du Moment Ticket — ne transite QUE par la mémoire. */
export interface TicketMomentPii {
  phoneNumber?: string;
  smsConsent?: boolean;
}

/**
 * Durée de rétention maximale de la PII (l'affichage du Moment Ticket dure
 * 4 s, 8 s en mode accessibilité/dégradé — 60 s couvre large).
 */
export const TICKET_MOMENT_PII_TTL_MS = 60_000;

let currentPii: TicketMomentPii | null = null;
let purgeTimer: ReturnType<typeof setTimeout> | null = null;
let storedAt = 0;

/** Purge la PII (explicite : départ d'écran, nouveau parcours, tests). */
export function purgeTicketMomentPii(): void {
  currentPii = null;
  storedAt = 0;
  if (purgeTimer !== null) {
    clearTimeout(purgeTimer);
    purgeTimer = null;
  }
}

/** Stocke la PII du Moment Ticket en mémoire et arme la purge automatique. */
export function storeTicketMomentPii(pii: TicketMomentPii): void {
  purgeTicketMomentPii();
  currentPii = { ...pii };
  storedAt = Date.now();
  purgeTimer = setTimeout(() => {
    purgeTicketMomentPii();
  }, TICKET_MOMENT_PII_TTL_MS);
}

/**
 * Relit la PII du Moment Ticket (lecture non destructive : le rendu React
 * peut relire plusieurs fois pendant l'affichage). Null si absente ou si le
 * TTL est dépassé — rechargement de page = dégradation propre.
 */
export function readTicketMomentPii(): TicketMomentPii | null {
  if (!currentPii) return null;
  if (Date.now() - storedAt > TICKET_MOMENT_PII_TTL_MS) {
    purgeTicketMomentPii();
    return null;
  }
  return { ...currentPii };
}
