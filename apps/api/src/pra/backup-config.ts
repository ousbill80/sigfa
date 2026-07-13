/**
 * backup-config — politique de rétention/rotation des backups PRA (SEC-003).
 *
 * Chiffres verrouillés par la story (ajustables via env, versionné) :
 *  - **RPO ≤ 60 min** → cadence de backup HORAIRE.
 *  - **RTO ≤ 15 min** → cible de temps de restauration (asserté par le game day).
 *  - **Rétention horaire ≥ 48 h glissantes** + **1 point quotidien ≥ 30 j**.
 *
 * Toute valeur absente/invalide retombe sur un défaut sûr (pattern identique à
 * `config/alerting.ts`).
 *
 * @module
 */

/** Rétention par défaut des backups horaires (heures glissantes). */
export const DEFAULT_HOURLY_RETENTION_HOURS = 48 as const;
/** Rétention par défaut des points quotidiens (jours glissants). */
export const DEFAULT_DAILY_RETENTION_DAYS = 30 as const;
/** RPO cible verrouillé (minutes) — cadence horaire. */
export const RPO_TARGET_MINUTES = 60 as const;
/** RTO cible verrouillé (minutes) — restauration prête aux requêtes. */
export const RTO_TARGET_MINUTES = 15 as const;
/** Tolérance de dérive du planificateur horaire (minutes). */
export const SCHEDULER_DRIFT_TOLERANCE_MINUTES = 5 as const;

/** Cadence des backups (préfixes de classement + fréquence). */
export type BackupCadence = "hourly" | "daily";

/** Politique de rétention résolue. */
export interface RetentionPolicy {
  /** Rétention des backups horaires (heures glissantes). */
  hourlyRetentionHours: number;
  /** Rétention des points quotidiens (jours glissants). */
  dailyRetentionDays: number;
}

/**
 * Lit un entier strictement positif depuis l'environnement, sinon le défaut.
 *
 * @param name     - Nom de la variable d'environnement
 * @param fallback - Valeur par défaut (entier > 0)
 * @param env      - Table d'environnement (défaut `process.env`)
 * @returns Entier positif configuré ou défaut
 */
function readPositiveInt(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv
): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

/**
 * Résout la politique de rétention depuis l'environnement (injectable).
 * Recalculée à chaque appel pour permettre l'override en test.
 *
 * @param env - Table d'environnement (défaut `process.env`)
 * @returns Politique de rétention résolue
 */
export function getRetentionPolicy(
  env: NodeJS.ProcessEnv = process.env
): RetentionPolicy {
  return {
    hourlyRetentionHours: readPositiveInt(
      "BACKUP_HOURLY_RETENTION_HOURS",
      DEFAULT_HOURLY_RETENTION_HOURS,
      env
    ),
    dailyRetentionDays: readPositiveInt(
      "BACKUP_DAILY_RETENTION_DAYS",
      DEFAULT_DAILY_RETENTION_DAYS,
      env
    ),
  };
}

/** Préfixe de rangement d'une cadence dans le bucket. */
export function cadencePrefix(cadence: BackupCadence): string {
  return `backups/${cadence}/`;
}
