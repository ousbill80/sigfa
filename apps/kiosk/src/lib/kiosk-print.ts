/**
 * KIOSK-BORNE — kiosk-print.ts
 * Déclenchement de l'impression du ticket côté renderer.
 *
 * Deux chemins, un seul appel :
 *   - environnement Electron : le preload expose `window.kioskPrint` →
 *     impression SILENCIEUSE via IPC `kiosk:print-ticket` (webContents.print,
 *     imprimante `SIGFA_KIOSK_PRINTER` côté main process) ;
 *   - navigateur nu (dev/démo) : repli `window.print()` natif (le layout
 *     thermique 80 mm est porté par le composant `PrintTicket` en @media print).
 *
 * La DÉCISION d'imprimer est une fonction PURE (`shouldAutoPrintTicket`) :
 * impression UNIQUEMENT si l'imprimante est confirmée OK, jamais en mode
 * dégradé (PAPER_LOW / ERROR / OFFLINE / réseau coupé avant confirmation) —
 * le comportement dégradé KIOSK-007 (« Photographiez votre numéro ») reste
 * strictement intact.
 */
import {
  deriveDegradedState,
  type PrinterStatus,
} from "@/hooks/useDegradedState";

/** Pont d'impression exposé par le preload Electron (contextBridge). */
export interface KioskPrintBridge {
  /** Demande une impression silencieuse au main process. */
  printTicket: () => Promise<boolean>;
}

declare global {
  interface Window {
    kioskPrint?: KioskPrintBridge;
  }
}

/** Entrées de la décision d'impression automatique. */
export interface AutoPrintInput {
  /** Statut imprimante remonté par le heartbeat (URL param). */
  printerStatus?: PrinterStatus;
  /** KIOSK-007 : réseau coupé après le 201, avant confirmation imprimante. */
  networkLostBeforePrinterConfirm?: boolean;
  /** État réseau du navigateur (navigator.onLine) au moment du rendu. */
  isBrowserOnline?: boolean;
}

/**
 * Décide si le ticket doit s'imprimer automatiquement. PURE (aucun effet).
 *
 * Règle : imprime UNIQUEMENT si `printerStatus === "OK"` ET aucun état
 * dégradé (KIOSK-007) ET le navigateur n'est pas hors ligne. Un statut
 * imprimante ABSENT (undefined) n'imprime PAS : l'impression exige une
 * confirmation positive de l'imprimante.
 *
 * @param input - {@link AutoPrintInput}.
 * @returns true si l'impression automatique doit être déclenchée.
 */
export function shouldAutoPrintTicket(input: AutoPrintInput): boolean {
  if (input.printerStatus !== "OK") return false;
  if (input.isBrowserOnline === false) return false;
  const degraded = deriveDegradedState({
    printerStatus: input.printerStatus,
    networkLostBeforePrinterConfirm: input.networkLostBeforePrinterConfirm,
  });
  return !degraded.isDisplayDegraded;
}

/**
 * Déclenche l'impression du ticket : pont Electron si présent (silencieux),
 * sinon `window.print()` natif. Ne lève jamais (borne sans surveillance).
 *
 * @param win - Fenêtre cible (injectable pour les tests).
 */
export function triggerTicketPrint(win: Window = window): void {
  try {
    if (win.kioskPrint && typeof win.kioskPrint.printTicket === "function") {
      void win.kioskPrint.printTicket();
      return;
    }
    win.print();
  } catch {
    // Impression best-effort : aucun crash côté usager (bascule KIOSK-007
    // déjà gérée en amont par printerStatus).
  }
}
