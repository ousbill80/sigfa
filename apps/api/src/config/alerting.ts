/**
 * config/alerting — intervalles des scans d'alertes manager (API-007).
 *
 * LA LOI (API-007 critère 8) : les intervalles de scan des jobs BullMQ
 * repeatable sont EXPORTÉS ici et INJECTABLES via variables d'environnement.
 *
 * - `AGENT_INACTIVE_SCAN_INTERVAL_S` : période du job `inactive-agent-scan`.
 * - `SLA_SCAN_INTERVAL_S`            : période du job `sla-scan`.
 * - `AGENT_DISCONNECT_GRACE_S`       : fenêtre anti-flap par agentId (défaut 30 s).
 *
 * Toute valeur absente ou non numérique retombe sur un défaut sûr.
 *
 * @module
 */

/** Intervalle par défaut du scan d'agents inactifs (secondes). */
export const DEFAULT_AGENT_INACTIVE_SCAN_INTERVAL_S = 60 as const;

/** Intervalle par défaut du scan SLA (secondes). */
export const DEFAULT_SLA_SCAN_INTERVAL_S = 60 as const;

/** Fenêtre de grâce anti-flap par défaut (secondes). */
export const DEFAULT_AGENT_DISCONNECT_GRACE_S = 30 as const;

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

/** Configuration résolue des intervalles d'alerting. */
export interface AlertingConfig {
  /** Intervalle du scan d'agents inactifs (secondes). */
  agentInactiveScanIntervalS: number;
  /** Intervalle du scan SLA (secondes). */
  slaScanIntervalS: number;
  /** Fenêtre de grâce anti-flap par agentId (secondes). */
  agentDisconnectGraceS: number;
}

/**
 * Résout la configuration d'alerting depuis l'environnement (injectable).
 * Recalculée à chaque appel pour permettre l'override en test.
 *
 * @returns Intervalles de scan et grâce anti-flap résolus
 */
export function getAlertingConfig(): AlertingConfig {
  return {
    agentInactiveScanIntervalS: readPositiveInt(
      "AGENT_INACTIVE_SCAN_INTERVAL_S",
      DEFAULT_AGENT_INACTIVE_SCAN_INTERVAL_S
    ),
    slaScanIntervalS: readPositiveInt(
      "SLA_SCAN_INTERVAL_S",
      DEFAULT_SLA_SCAN_INTERVAL_S
    ),
    agentDisconnectGraceS: readPositiveInt(
      "AGENT_DISCONNECT_GRACE_S",
      DEFAULT_AGENT_DISCONNECT_GRACE_S
    ),
  };
}
