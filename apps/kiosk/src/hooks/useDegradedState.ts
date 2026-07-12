/**
 * KIOSK-007 — Dérivation pure des états dégradés borne.
 *
 * Regroupe la logique métier des critères EARS (indépendante du rendu) :
 *   - Imprimante dégradée (`PAPER_LOW | ERROR | OFFLINE`) → bascule transparente :
 *     affichage prolongé à 8 s + SMS fortement suggéré, AUCUNE mention de panne.
 *   - File longue (attente ≥ seuil configurable, défaut 30 min) → message
 *     affluence + mise en avant du champ téléphone.
 *   - Réseau coupé après 201 (avant confirmation imprimante) → traité comme une
 *     imprimante non confirmée : affichage 8 s + « Photographiez votre numéro ».
 *
 * @module hooks/useDegradedState
 */

/** Statut imprimante (aligné sur `PrinterStatus` du contrat public). */
export type PrinterStatus = "OK" | "PAPER_LOW" | "ERROR" | "OFFLINE";

/** Seuil « file longue » par défaut, en minutes (configurable). */
export const DEFAULT_LONG_QUEUE_THRESHOLD_MIN = 30 as const;

/** Durée d'affichage nominale du numéro (imprimante OK), en ms. */
export const NORMAL_DISPLAY_MS = 4000 as const;

/** Durée d'affichage prolongée (imprimante dégradée / réseau coupé), en ms. */
export const EXTENDED_DISPLAY_MS = 8000 as const;

/** Entrées de la dérivation d'état dégradé. */
export interface DegradedStateInput {
  /** Statut imprimante remonté par le heartbeat. Défaut : `OK`. */
  printerStatus?: PrinterStatus;
  /** Attente estimée en minutes (pour le seuil « file longue »). */
  estimatedWaitMinutes?: number;
  /** Seuil « file longue » en minutes. Défaut : {@link DEFAULT_LONG_QUEUE_THRESHOLD_MIN}. */
  longQueueThresholdMinutes?: number;
  /**
   * Vrai si le réseau a été coupé APRÈS le 201 mais AVANT confirmation
   * imprimante (extension réseau). Traité comme imprimante non confirmée.
   */
  networkLostBeforePrinterConfirm?: boolean;
}

/** Résultat de la dérivation d'état dégradé. */
export interface DegradedState {
  /** Vrai si l'imprimante est dégradée (statut != OK). */
  isPrinterDegraded: boolean;
  /** Vrai s'il faut basculer en affichage dégradé (imprimante OU réseau). */
  isDisplayDegraded: boolean;
  /** Durée d'affichage du numéro (8 s si dégradé, 4 s sinon), en ms. */
  displayDurationMs: number;
  /** Vrai si le SMS doit être fortement suggéré (bascule transparente). */
  smsStronglySuggested: boolean;
  /** Vrai si l'attente dépasse le seuil « file longue ». */
  isLongQueue: boolean;
}

/**
 * Dérive l'état dégradé à partir des entrées borne. Fonction PURE (aucun effet).
 *
 * @param input - {@link DegradedStateInput}.
 * @returns L'état dégradé dérivé.
 */
export function deriveDegradedState(input: DegradedStateInput): DegradedState {
  const printerStatus = input.printerStatus ?? "OK";
  const threshold = input.longQueueThresholdMinutes ?? DEFAULT_LONG_QUEUE_THRESHOLD_MIN;
  const networkLost = input.networkLostBeforePrinterConfirm ?? false;

  const isPrinterDegraded = printerStatus !== "OK";
  const isDisplayDegraded = isPrinterDegraded || networkLost;

  const isLongQueue =
    typeof input.estimatedWaitMinutes === "number" &&
    input.estimatedWaitMinutes >= threshold;

  return {
    isPrinterDegraded,
    isDisplayDegraded,
    displayDurationMs: isDisplayDegraded ? EXTENDED_DISPLAY_MS : NORMAL_DISPLAY_MS,
    smsStronglySuggested: isDisplayDegraded,
    isLongQueue,
  };
}

/**
 * Hook React fin autour de {@link deriveDegradedState}. Sans état interne ni
 * effet — retourne simplement l'état dérivé (mémoïsation inutile car pur et bon
 * marché). Existe pour un usage ergonomique côté composant.
 *
 * @param input - {@link DegradedStateInput}.
 * @returns L'état dégradé dérivé.
 */
export function useDegradedState(input: DegradedStateInput): DegradedState {
  return deriveDegradedState(input);
}
