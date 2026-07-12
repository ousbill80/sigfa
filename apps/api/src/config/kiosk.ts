/**
 * Constantes de supervision des bornes kiosques — API-011.
 *
 * `KIOSK_HEARTBEAT_INTERVAL_S` : cadence nominale d'émission du heartbeat borne
 * (LA LOI v1 = 60 s). Une borne est considérée SILENT si son dernier heartbeat
 * (`last_seen`) date de plus de 3× cet intervalle (seuil = 180 s), afin d'absorber
 * un heartbeat manqué sans fausse alerte.
 *
 * Ces valeurs sont des constantes de domaine (non injectables via l'environnement) :
 * elles sont documentées dans `.env.example` à titre indicatif mais ne dépendent
 * pas d'une variable d'env — elles sont figées par LA LOI.
 *
 * @module
 */

/** Cadence nominale du heartbeat borne, en secondes (LA LOI v1). */
export const KIOSK_HEARTBEAT_INTERVAL_S = 60;

/**
 * Seuil de silence : une borne est SILENT si `last_seen < NOW() - SILENT`.
 * Fixé à 3× l'intervalle nominal (180 s) — tolère un heartbeat manqué.
 */
export const KIOSK_SILENT_THRESHOLD_S = KIOSK_HEARTBEAT_INTERVAL_S * 3;
