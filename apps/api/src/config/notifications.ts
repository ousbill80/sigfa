/**
 * config/notifications — paramètres de l'infrastructure BullMQ de notification
 * (NOTIF-001). Toutes les valeurs sont INJECTABLES via l'environnement, avec des
 * défauts sûrs verrouillés par l'arbitrage F6 (décisions D3).
 *
 * LA LOI (NOTIF-001 + arbitrage D3) :
 *  - Backoff exponentiel plafonné + **full jitter borné** :
 *    `delay ∈ [0, min(cap, base·2^n)]` — base 5 s, facteur 2, plafond 5 min,
 *    max 5 tentatives.
 *  - Débit worker PAR CANAL (concurrency BullMQ) = paramètre config défaut
 *    verrouillé, pour ne pas se faire bannir par le fournisseur.
 *  - Prefix Redis PAR ENVIRONNEMENT pour isoler les files entre déploiements.
 *
 * @module
 */

/** Base du backoff exponentiel (ms) — 1re tentative après ~5 s (D3). */
export const DEFAULT_BACKOFF_BASE_MS = 5_000 as const;

/** Plafond du backoff (ms) — jamais plus de 5 min entre deux tentatives (D3). */
export const DEFAULT_BACKOFF_CAP_MS = 300_000 as const;

/** Nombre maximal de tentatives avant dead-letter (D3). */
export const DEFAULT_MAX_ATTEMPTS = 5 as const;

/** Débit (concurrency BullMQ) par canal — throttle fournisseur par défaut (D3). */
export const DEFAULT_CHANNEL_CONCURRENCY = 5 as const;

/** Prefix Redis par défaut (surchargé par environnement). */
export const DEFAULT_QUEUE_PREFIX = "sigfa" as const;

/**
 * Lit un entier strictement positif depuis l'environnement, sinon le défaut.
 *
 * @param name     - Nom de la variable d'environnement
 * @param fallback - Valeur par défaut (entier > 0)
 * @returns Entier positif configuré ou défaut
 */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

/**
 * Lit une chaîne non vide depuis l'environnement, sinon le défaut.
 *
 * @param name     - Nom de la variable d'environnement
 * @param fallback - Valeur par défaut
 * @returns Chaîne configurée ou défaut
 */
function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim();
}

/** Configuration résolue de l'infrastructure de notification. */
export interface NotificationConfig {
  /** Base du backoff exponentiel (ms). */
  backoffBaseMs: number;
  /** Plafond du backoff (ms). */
  backoffCapMs: number;
  /** Nombre maximal de tentatives avant DLQ. */
  maxAttempts: number;
  /** Débit (concurrency) du worker par canal. */
  channelConcurrency: number;
  /** Prefix Redis des files (isolation par environnement). */
  queuePrefix: string;
}

/**
 * Résout la configuration de notification depuis l'environnement (injectable).
 * Recalculée à chaque appel pour permettre l'override en test.
 *
 * @returns Config résolue (backoff, tentatives, concurrency, prefix)
 */
export function getNotificationConfig(): NotificationConfig {
  return {
    backoffBaseMs: readPositiveInt(
      "NOTIF_BACKOFF_BASE_MS",
      DEFAULT_BACKOFF_BASE_MS
    ),
    backoffCapMs: readPositiveInt("NOTIF_BACKOFF_CAP_MS", DEFAULT_BACKOFF_CAP_MS),
    maxAttempts: readPositiveInt("NOTIF_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS),
    channelConcurrency: readPositiveInt(
      "NOTIF_CHANNEL_CONCURRENCY",
      DEFAULT_CHANNEL_CONCURRENCY
    ),
    queuePrefix: readString("NOTIF_QUEUE_PREFIX", DEFAULT_QUEUE_PREFIX),
  };
}
