/**
 * sms-position-triggers — décision d'enfilement des SMS de progression (NOTIF-002).
 *
 * Écoute les changements de position (`queue:updated`, API-003) et décide quel(s)
 * SMS enfiler selon LA LOI :
 *  - `POSITION_NEAR` (« vous êtes 3e ») déclenché quand la position ATTEINT le seuil
 *    `smsNearThreshold` (défaut 3, configurable banque). Un seul par ticket À VIE.
 *  - `POSITION_NEXT` (« vous êtes le suivant ») déclenché quand la position vaut 1.
 *    Un seul par ticket À VIE.
 *  - **Suppression de `POSITION_NEAR` si `POSITION_NEXT` est attendu < 60 s** (D3) :
 *    inutile d'envoyer 2 SMS coûteux à quelques secondes d'écart.
 *  - Idempotence « une fois par (ticket, type) à vie » : les envois déjà réalisés
 *    (SENT/DELIVERED) ou déjà enfilés (QUEUED) sont fournis par l'appelant et
 *    court-circuitent la décision — jamais de renvoi même sur re-franchissement.
 *
 * Cette fonction est PURE (aucune I/O) : elle décide, l'appelant enfile.
 *
 * @module
 */

/** Seuil « proche » par défaut déclenchant POSITION_NEAR (D3 / CONTRACT-005). */
export const DEFAULT_SMS_NEAR_THRESHOLD = 3;

/** Fenêtre (ms) sous laquelle POSITION_NEAR est supprimé si POSITION_NEXT suit (D3). */
export const NEAR_SUPPRESSION_WINDOW_MS = 60_000;

/** Type de SMS de progression décidé. */
export type PositionSmsType = "POSITION_NEAR" | "POSITION_NEXT";

/** Événement de mise à jour de position d'un ticket (dérivé de `queue:updated`). */
export interface PositionEvent {
  /** Ticket concerné. */
  ticketId: string;
  /** Position courante (1 = en tête / prochain). */
  position: number;
  /**
   * Estimation (ms) avant que le ticket devienne le suivant (position 1).
   * Utilisée pour la suppression de POSITION_NEAR si POSITION_NEXT < 60 s.
   * `undefined` si inconnue (aucune suppression appliquée).
   */
  estimatedMsToNext?: number;
}

/** Contexte de décision : seuil banque + envois déjà réalisés/enfilés (idempotence). */
export interface TriggerContext {
  /** Seuil « proche » de la banque (défaut 3). */
  nearThreshold: number;
  /** Types déjà envoyés OU enfilés pour ce ticket (une fois par (ticket,type) à vie). */
  alreadyHandled: ReadonlySet<PositionSmsType>;
  /** Fenêtre de suppression NEAR (défaut 60 s). */
  suppressionWindowMs?: number;
}

/**
 * Décide les SMS de progression à enfiler pour un événement de position.
 *
 * Règles (LA LOI) :
 *  - `position <= 1` ⇒ POSITION_NEXT (si pas déjà géré).
 *  - `position <= nearThreshold` (et `> 1`) ⇒ POSITION_NEAR (si pas déjà géré), SAUF
 *    si POSITION_NEXT est attendu < 60 s (`estimatedMsToNext`) → suppression NEAR.
 *  - Un type déjà présent dans `alreadyHandled` n'est JAMAIS ré-enfilé.
 *
 * @param event - Événement de position
 * @param ctx   - Seuil banque + déjà-géré + fenêtre de suppression
 * @returns Liste (0..1) des types à enfiler
 */
export function decidePositionSms(
  event: PositionEvent,
  ctx: TriggerContext
): PositionSmsType[] {
  const window = ctx.suppressionWindowMs ?? NEAR_SUPPRESSION_WINDOW_MS;

  // Le ticket est (ou est devenu) le suivant : POSITION_NEXT prime.
  if (event.position <= 1) {
    return ctx.alreadyHandled.has("POSITION_NEXT") ? [] : ["POSITION_NEXT"];
  }

  // Zone « proche » : position atteint le seuil sans être encore en tête.
  if (event.position <= ctx.nearThreshold) {
    if (ctx.alreadyHandled.has("POSITION_NEAR")) return [];
    // Suppression NEAR si POSITION_NEXT est imminent (< 60 s) et pas déjà géré.
    const nextImminent =
      event.estimatedMsToNext !== undefined &&
      event.estimatedMsToNext < window &&
      !ctx.alreadyHandled.has("POSITION_NEXT");
    if (nextImminent) return [];
    return ["POSITION_NEAR"];
  }

  // Hors zone « proche » : rien à enfiler.
  return [];
}
