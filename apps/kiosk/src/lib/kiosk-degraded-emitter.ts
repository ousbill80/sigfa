/**
 * KIOSK-007 — Émetteur SIMULÉ des événements dégradés borne (convention F4).
 *
 * FRONTIÈRE TEMPS RÉEL (à lire attentivement) :
 * ------------------------------------------------------------------
 * Dans le CONTRAT (CONTRACT-002), `kiosk:printer-error` et
 * `alert:manager KIOSK_SYSTEM_ERROR` ont pour émetteur « borne **via serveur
 * API** ». La borne ne fait donc AUCUNE émission socket directe en production :
 *   - `kiosk:printer-error` est émis par le SERVEUR lorsqu'il reçoit un
 *     heartbeat (`POST /kiosks/{kioskId}/heartbeat`) avec `printerStatus != OK`
 *     (cf. entête OpenAPI du endpoint). La borne se contente de SIGNALER via le
 *     heartbeat — chemin réel = {@link useKioskHeartbeat}.
 *   - `alert:manager KIOSK_SYSTEM_ERROR` est émis par le SERVEUR quand la
 *     création de ticket échoue de façon irrécupérable.
 *
 * En F4, on TESTE seulement l'INTENTION d'émission via ce module « simulé »
 * (comme les autres stories F4 : sockets simulés / mock). Ce module N'OUVRE
 * AUCUNE connexion socket réelle : il valide le payload contre le schéma du
 * contrat (`@sigfa/contracts`) puis délègue à un `sink` injectable (spié en
 * test). Le POST direct `POST /kiosk/alert` a été REJETÉ à l'arbitrage — ce
 * n'est donc pas un chemin réseau, juste une preuve d'intention testable.
 *
 * @module lib/kiosk-degraded-emitter
 */
import {
  kioskPrinterErrorEvent,
  alertManagerEvent,
  type KioskPrinterErrorPayload,
  type AlertManagerPayload,
} from "@/lib/contracts-realtime";

/**
 * Destination d'un événement dégradé simulé. En production, l'émission réelle
 * est faite par le serveur (voir entête du module) ; ici le `sink` est une
 * abstraction testable qui ne touche PAS le réseau.
 */
export interface DegradedEventSink {
  /** Nom de l'événement du contrat (ex. `kiosk:printer-error`). */
  emit: (eventName: string, payload: unknown) => void;
}

/**
 * Sink par défaut : NO-OP côté borne (l'émission réelle appartient au serveur).
 * Il journalise l'intention en dev pour faciliter le débogage, sans réseau.
 */
export const noopDegradedSink: DegradedEventSink = {
  emit: (eventName: string): void => {
    // Aucune émission réseau : la borne délègue au serveur (frontière RT).
    void eventName;
  },
};

/**
 * Signale (intention F4, simulée) une erreur imprimante borne.
 *
 * Chemin RÉEL : le serveur émet `kiosk:printer-error` en réponse au heartbeat.
 * Ici on valide le payload contre le contrat puis on délègue au `sink`.
 *
 * @param payload - Payload conforme au schéma `kiosk:printer-error`.
 * @param sink - Destination injectable (défaut : {@link noopDegradedSink}).
 * @returns `true` si le payload est valide et a été transmis au sink.
 */
export function signalPrinterError(
  payload: KioskPrinterErrorPayload,
  sink: DegradedEventSink = noopDegradedSink
): boolean {
  const parsed = kioskPrinterErrorEvent.payloadSchema.safeParse(payload);
  if (!parsed.success) return false;
  sink.emit(kioskPrinterErrorEvent.name, parsed.data);
  return true;
}

/**
 * Signale (intention F4, simulée) une erreur système borne au dashboard manager.
 *
 * Le type est FIGÉ à `KIOSK_SYSTEM_ERROR` (CONTRACT-012) — JAMAIS `SLA_BREACH`
 * (arbitrage 19). Chemin RÉEL : émission serveur.
 *
 * @param context - Contexte libre (kioskId, agencyId, serviceId…).
 * @param sink - Destination injectable (défaut : {@link noopDegradedSink}).
 * @returns `true` si l'alerte a été transmise au sink.
 */
export function signalKioskSystemError(
  context: Record<string, unknown>,
  sink: DegradedEventSink = noopDegradedSink
): boolean {
  const payload: AlertManagerPayload = {
    type: "KIOSK_SYSTEM_ERROR",
    payload: context,
  };
  const parsed = alertManagerEvent.payloadSchema.safeParse(payload);
  if (!parsed.success) return false;
  sink.emit(alertManagerEvent.name, parsed.data);
  return true;
}
