/**
 * Supervision borne — machine d'état + alerte « muette » débouncée (ADM-003a).
 *
 * CONTRACT-013 fige l'enum `KioskStatus` (ONLINE/DEGRADED/SILENT/NEVER_SEEN),
 * la config par agence (`heartbeatIntervalSec`/`silentThresholdSec`, défauts
 * 30/90 s) et les événements temps réel `kiosk:silent`/`kiosk:recovered`.
 *
 * DEUX responsabilités, toutes deux PURES (aucun accès DB — l'horloge et les
 * lignes sont injectées, donc testables sans horloge réelle) :
 *
 *  1. `deriveKioskStatus(row, now, config?)` — dérive l'état d'une borne À LA
 *     LECTURE depuis `lastSeen` et l'horloge serveur (jamais un état figé) :
 *       - `NEVER_SEEN` : `lastSeen` nul (borne provisionnée jamais vue) ;
 *       - `SILENT`     : silence ≥ `silentThresholdSec` (3 heartbeats manqués) ;
 *       - `DEGRADED`   : silence ∈ [2×H, seuil) OU imprimante KO (anomalie) ;
 *       - `ONLINE`     : heartbeat récent (< 2×H) et aucune anomalie.
 *     Priorité : silence l'emporte sur l'imprimante (une borne muette est SILENT).
 *
 *  2. `KioskSilenceTracker` — émet l'alerte « borne muette » DÉBOUNCÉE : une seule
 *     `kiosk:silent` par ÉPISODE de silence (anti-tempête : une coupure agence de N
 *     bornes = N alertes uniques agrégées par agence, jamais de multiplication ni de
 *     ré-émission tant que la borne reste muette). Le retour d'un heartbeat ferme
 *     l'épisode et émet `kiosk:recovered` UNE fois. Le bus route ces événements STAFF
 *     vers `agency:{id}:staff` (jamais la room publique DISPLAY — F-SEC-TV-01).
 *
 * @module
 */

import type { RealtimeBus } from "src/services/realtime.js";
import {
  SUPERVISION_HEARTBEAT_INTERVAL_S,
  SUPERVISION_SILENT_THRESHOLD_S,
} from "src/config/kiosk.js";

/** Statut de supervision d'une borne (contrat `KioskStatus`). */
export type KioskStatus = "ONLINE" | "DEGRADED" | "SILENT" | "NEVER_SEEN";

/**
 * Configuration de supervision par agence (contrat `KioskSupervisionConfig`).
 * Défauts globaux surchargeables par agence.
 */
export interface KioskSupervisionConfig {
  /** Intervalle attendu entre deux heartbeats (secondes, défaut 30). */
  readonly heartbeatIntervalSec: number;
  /** Délai sans heartbeat au-delà duquel la borne est SILENT (secondes, défaut 90). */
  readonly silentThresholdSec: number;
}

/** Config par défaut (CONTRACT-013 : H = 30 s, seuil muette = 90 s). */
export const DEFAULT_SUPERVISION_CONFIG: KioskSupervisionConfig = {
  heartbeatIntervalSec: SUPERVISION_HEARTBEAT_INTERVAL_S,
  silentThresholdSec: SUPERVISION_SILENT_THRESHOLD_S,
};

/**
 * Ligne minimale de supervision d'une borne (projection DB). `lastSeen` est
 * l'horodatage serveur du dernier heartbeat (jamais l'horloge borne) ; `printerOk`
 * porte la dernière anomalie imprimante connue.
 */
export interface KioskSupervisionRow {
  /** Identifiant UUID de la borne. */
  readonly kioskId: string;
  /** Identifiant UUID de l'agence hébergeant la borne. */
  readonly agencyId: string;
  /** Dernier heartbeat reçu (horloge serveur), ou null si jamais vue. */
  readonly lastSeen: Date | null;
  /** Imprimante opérationnelle au dernier heartbeat (true si inconnue/saine). */
  readonly printerOk: boolean;
  /** Horodatage de provisionnement de la borne (création). */
  readonly createdAt: Date;
}

/**
 * Dérive l'état de supervision d'une borne À LA LECTURE, depuis `lastSeen` et
 * l'horloge injectée `now`. Déterministe et sans effet de bord.
 *
 * @param row    - Ligne de supervision (lastSeen/printerOk)
 * @param now    - Horloge serveur (injectée)
 * @param config - Config d'agence (défauts 30/90 s si omis)
 * @returns Le statut dérivé (ONLINE/DEGRADED/SILENT/NEVER_SEEN)
 */
export function deriveKioskStatus(
  row: KioskSupervisionRow,
  now: Date,
  config: KioskSupervisionConfig = DEFAULT_SUPERVISION_CONFIG
): KioskStatus {
  if (row.lastSeen === null) return "NEVER_SEEN";

  const silentForSec = (now.getTime() - row.lastSeen.getTime()) / 1000;
  // Silence ≥ seuil muette (3 heartbeats manqués) → SILENT, prime sur tout le reste.
  if (silentForSec >= config.silentThresholdSec) return "SILENT";

  // Retard intermittent (≥ 2×H) OU anomalie imprimante → DEGRADED.
  const degradedFloor = 2 * config.heartbeatIntervalSec;
  if (silentForSec >= degradedFloor || !row.printerOk) return "DEGRADED";

  return "ONLINE";
}

/** Vrai si le statut est un état de reprise (borne active, épisode clos). */
function isRecoveredStatus(status: KioskStatus): status is "ONLINE" | "DEGRADED" {
  return status === "ONLINE" || status === "DEGRADED";
}

/**
 * Traqueur d'épisodes de silence — alerte « borne muette » DÉBOUNCÉE.
 *
 * Maintient en mémoire l'ensemble des bornes ACTUELLEMENT en épisode de silence
 * (déjà alertées). À chaque `reconcile(rows, now)` :
 *   - une borne qui PASSE à SILENT et n'a pas d'épisode ouvert → `kiosk:silent`
 *     (ouverture d'épisode) ;
 *   - une borne SILENT dont l'épisode est déjà ouvert → RIEN (débounce) ;
 *   - une borne qui REDEVIENT active (ONLINE/DEGRADED) avec un épisode ouvert →
 *     `kiosk:recovered` (fermeture d'épisode) ;
 *   - NEVER_SEEN → jamais d'alerte (une borne jamais vue n'est pas « muette »).
 *
 * L'état par borne est indépendant → une coupure agence (N bornes muettes d'un
 * coup) produit N alertes UNIQUES, agrégées par agence côté écran, sans tempête de
 * ré-émissions.
 */
export class KioskSilenceTracker {
  /** Bornes en épisode de silence ouvert (kioskId). */
  private readonly silentEpisodes = new Set<string>();

  /**
   * @param bus    - Bus temps réel (route les événements STAFF vers la room :staff)
   * @param config - Config de supervision (défauts 30/90 s si omis)
   */
  constructor(
    private readonly bus: RealtimeBus,
    private readonly config: KioskSupervisionConfig = DEFAULT_SUPERVISION_CONFIG
  ) {}

  /**
   * Réconcilie l'état d'un lot de bornes avec les épisodes ouverts, émet les
   * transitions (silent/recovered) débouncées.
   *
   * @param rows - Lignes de supervision du périmètre (agence ou réseau)
   * @param now  - Horloge serveur (injectée)
   */
  reconcile(rows: readonly KioskSupervisionRow[], now: Date): void {
    for (const row of rows) {
      const status = deriveKioskStatus(row, now, this.config);
      const hasEpisode = this.silentEpisodes.has(row.kioskId);

      if (status === "SILENT" && !hasEpisode) {
        this.silentEpisodes.add(row.kioskId);
        this.emit("kiosk:silent", row, "SILENT", sinceOf(row));
      } else if (isRecoveredStatus(status) && hasEpisode) {
        this.silentEpisodes.delete(row.kioskId);
        this.emit("kiosk:recovered", row, status, now.toISOString());
      }
      // SILENT + épisode ouvert → débounce (rien). NEVER_SEEN → jamais d'alerte.
    }
  }

  /** Émet un événement de supervision (payload PII-free). */
  private emit(
    event: "kiosk:silent" | "kiosk:recovered",
    row: KioskSupervisionRow,
    status: KioskStatus,
    since: string
  ): void {
    this.bus.emit(event, row.agencyId, {
      kioskId: row.kioskId,
      agencyId: row.agencyId,
      status,
      since,
    });
  }
}

/**
 * Horodatage de début de silence (dernier heartbeat connu). Une borne SILENT a
 * toujours un `lastSeen` non nul (NEVER_SEEN n'alerte pas) ; fallback horloge de
 * création par défense (jamais atteint sur le chemin SILENT).
 *
 * @param row - Ligne de supervision
 * @returns Horodatage ISO 8601 du dernier heartbeat
 */
function sinceOf(row: KioskSupervisionRow): string {
  return (row.lastSeen ?? row.createdAt).toISOString();
}
