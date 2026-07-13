/**
 * config/observability — seuils & destinataires du plan d'observabilité (NET-003).
 *
 * LA LOI (NET-003) : les seuils d'alerte infra sont as-code, EXPORTÉS ici et
 * INJECTABLES via variables d'environnement. Défauts (fenêtre 5 min ;
 * CPU>80% ; mem>85% ; err>1% ; RT p95≥500ms ; dédup 10 min) — calibrage réel
 * GATED sur le run de charge SEC-004 (cf. `_arbitrage-f6-f11.md` D11).
 *
 * Les DESTINATAIRES (canaux ops / astreinte on-call) sont des PLACEHOLDERS :
 * les adresses/canaux réels sont fournis par le PO/ops AVANT activation
 * (cf. `_notes.md` §7 Q4). Aucune valeur réelle n'est committée.
 *
 * @module
 */

/** Seuil CPU par défaut (fraction, 0..1) — 80%. */
export const DEFAULT_CPU_THRESHOLD = 0.8 as const;

/** Seuil mémoire par défaut (fraction, 0..1) — 85%. */
export const DEFAULT_MEM_THRESHOLD = 0.85 as const;

/** Seuil taux d'erreur applicatif par défaut (fraction, 0..1) — 1%. */
export const DEFAULT_ERROR_RATE_THRESHOLD = 0.01 as const;

/** SLA latence de livraison temps réel `ticket:called` par défaut (ms) — p95. */
export const DEFAULT_RT_P95_SLA_MS = 500 as const;

/** Fenêtre d'évaluation soutenue par défaut (secondes) — 5 min. */
export const DEFAULT_WINDOW_S = 300 as const;

/** Fenêtre de dédup / regroupement d'alertes par défaut (secondes) — 10 min. */
export const DEFAULT_DEDUP_WINDOW_S = 600 as const;

/**
 * Lit un flottant strictement positif depuis l'environnement, sinon le défaut.
 *
 * @param name     - Nom de la variable d'environnement
 * @param fallback - Valeur par défaut (> 0)
 * @returns Flottant positif configuré ou défaut (fail-safe)
 */
function readPositiveFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

/**
 * Lit un entier strictement positif depuis l'environnement, sinon le défaut.
 *
 * @param name     - Nom de la variable d'environnement
 * @param fallback - Valeur par défaut (entier > 0)
 * @returns Entier positif configuré ou défaut (fail-safe)
 */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

/**
 * Lit un destinataire depuis l'environnement, sinon le placeholder fourni.
 * Une chaîne vide retombe sur le placeholder (fail-safe : jamais de canal vide).
 *
 * @param name        - Nom de la variable d'environnement
 * @param placeholder - Placeholder documenté (valeur réelle fournie plus tard)
 * @returns Destinataire configuré ou placeholder
 */
function readRecipient(name: string, placeholder: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return placeholder;
  return raw.trim();
}

/** Seuils d'alerte infra résolus (fractions & millisecondes). */
export interface ObservabilityThresholds {
  /** Seuil CPU (fraction 0..1). */
  cpuThreshold: number;
  /** Seuil mémoire (fraction 0..1). */
  memThreshold: number;
  /** Seuil taux d'erreur (fraction 0..1). */
  errorRateThreshold: number;
  /** SLA latence RT p95 (ms). */
  rtP95SlaMs: number;
  /** Fenêtre d'évaluation soutenue (secondes). */
  windowS: number;
  /** Fenêtre de dédup / regroupement (secondes). */
  dedupWindowS: number;
}

/**
 * Destinataires d'alerte (PLACEHOLDERS — valeurs réelles fournies par le PO/ops).
 * `ops` reçoit les WARNING ; `onCall` reçoit les CRITICAL (astreinte).
 */
export interface ObservabilityRecipients {
  /** Canal ops (WARNING) — placeholder. */
  ops: string;
  /** Canal astreinte on-call (CRITICAL) — placeholder. */
  onCall: string;
}

/** Configuration d'observabilité résolue (seuils + destinataires). */
export interface ObservabilityConfig {
  /** Seuils d'alerte infra. */
  thresholds: ObservabilityThresholds;
  /** Destinataires par sévérité (placeholders). */
  recipients: ObservabilityRecipients;
}

/** Placeholder du canal ops (WARNING) — remplacé par le PO/ops. */
export const OPS_RECIPIENT_PLACEHOLDER = "ops-team@example.invalid" as const;

/** Placeholder du canal astreinte (CRITICAL) — remplacé par le PO/ops. */
export const ONCALL_RECIPIENT_PLACEHOLDER = "on-call@example.invalid" as const;

/**
 * Résout la configuration d'observabilité depuis l'environnement (injectable).
 * Recalculée à chaque appel pour permettre l'override en test.
 *
 * @returns Seuils et destinataires résolus (fail-safe sur défauts/placeholders)
 */
export function getObservabilityConfig(): ObservabilityConfig {
  return {
    thresholds: {
      cpuThreshold: readPositiveFloat("OBS_CPU_THRESHOLD", DEFAULT_CPU_THRESHOLD),
      memThreshold: readPositiveFloat("OBS_MEM_THRESHOLD", DEFAULT_MEM_THRESHOLD),
      errorRateThreshold: readPositiveFloat(
        "OBS_ERROR_RATE_THRESHOLD",
        DEFAULT_ERROR_RATE_THRESHOLD
      ),
      rtP95SlaMs: readPositiveInt("OBS_RT_P95_SLA_MS", DEFAULT_RT_P95_SLA_MS),
      windowS: readPositiveInt("OBS_WINDOW_S", DEFAULT_WINDOW_S),
      dedupWindowS: readPositiveInt("OBS_DEDUP_WINDOW_S", DEFAULT_DEDUP_WINDOW_S),
    },
    recipients: {
      ops: readRecipient("OBS_OPS_RECIPIENT", OPS_RECIPIENT_PLACEHOLDER),
      onCall: readRecipient("OBS_ONCALL_RECIPIENT", ONCALL_RECIPIENT_PLACEHOLDER),
    },
  };
}
