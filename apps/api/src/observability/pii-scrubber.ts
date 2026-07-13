/**
 * observability/pii-scrubber — scrubbing PII OBLIGATOIRE des traces Sentry (NET-003).
 *
 * LA LOI (NET-003, risque R6) : les téléphones / `trackingId` / et autres PII ne
 * sont JAMAIS envoyés à Sentry (breadcrumbs, tags, extra, request, exception).
 * Cette fonction est un `beforeSend`/`beforeBreadcrumb` PUR : elle prend un
 * événement d'erreur simulé et retourne une copie SANS PII, prouvable en test.
 *
 * Approche défense-en-profondeur :
 *  1. Redaction par CLÉ (liste dénominative : phone, trackingId, token, …) —
 *     récursive sur tout objet imbriqué.
 *  2. Redaction par VALEUR (motifs : numéros type téléphone, JWT) — au cas où
 *     une PII apparaîtrait dans un message libre sous une clé non listée.
 *
 * @module
 */

/** Marqueur de valeur expurgée (jamais transmis tel quel à Sentry). */
export const REDACTED = "[REDACTED]" as const;

/**
 * Clés dont la valeur est TOUJOURS expurgée (comparaison insensible à la casse
 * et aux séparateurs `_`/`-`). Couvre PII client + secrets.
 */
export const PII_KEYS: readonly string[] = [
  "phone",
  "phonenumber",
  "phonenumbermasked",
  "trackingid",
  "tracking",
  "clientname",
  "customername",
  "fullname",
  "firstname",
  "lastname",
  "email",
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "secret",
  "apikey",
  "pin",
];

/** Normalise une clé pour comparaison (minuscule, sans `_`/`-`/espaces). */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\-\s]/g, "");
}

/** Vrai si la clé désigne un champ PII à expurger. */
function isPiiKey(key: string): boolean {
  const n = normalizeKey(key);
  return PII_KEYS.some((p) => n === p || n.includes(p));
}

/**
 * Motifs de VALEUR à expurger même hors clé listée.
 * - JWT : trois segments base64url séparés par `.`.
 * - Tracking id : préfixe `TRK-` suivi d'un identifiant (UUID/hex).
 * - UUID v1..v5 (identifiant client potentiel).
 * - Numéro téléphone : 8+ chiffres, éventuellement `+` et séparateurs.
 *
 * Ordre : motifs les plus spécifiques d'abord (JWT/tracking/UUID) puis le
 * téléphone (le plus permissif) pour éviter un masquage partiel ambigu.
 */
const JWT_LIKE = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const TRACKING_LIKE = /\bTRK-[A-Za-z0-9-]+/gi;
const UUID_LIKE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PHONE_LIKE = /(?:\+?\d[\s.-]?){8,}/g;

/** Expurge les motifs PII d'une chaîne libre (message, valeur texte). */
export function scrubString(value: string): string {
  return value
    .replace(JWT_LIKE, REDACTED)
    .replace(TRACKING_LIKE, REDACTED)
    .replace(UUID_LIKE, REDACTED)
    .replace(PHONE_LIKE, REDACTED);
}

/**
 * Expurge récursivement une valeur inconnue (objet/array/primitive).
 * - Clé PII → `[REDACTED]` sans descendre.
 * - Chaîne → scrubbing par motif.
 * - Objet/array → récursion.
 *
 * @param value - Valeur arbitraire (branche d'événement Sentry)
 * @returns Copie expurgée (aucune mutation de l'entrée)
 */
export function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isPiiKey(k) ? REDACTED : scrubValue(v);
    }
    return out;
  }
  return value;
}

/**
 * Événement d'erreur (forme partielle Sentry) — champs susceptibles de PII.
 * Volontairement permissif : le scrubbing traverse toute la structure.
 */
export interface SentryLikeEvent {
  /** Message d'erreur libre. */
  message?: string;
  /** Tags indexés. */
  tags?: Record<string, unknown>;
  /** Contexte additionnel. */
  extra?: Record<string, unknown>;
  /** Détails requête HTTP. */
  request?: Record<string, unknown>;
  /** Fil d'ariane (breadcrumbs). */
  breadcrumbs?: Array<Record<string, unknown>>;
  /** Utilisateur associé (à ne jamais divulguer). */
  user?: Record<string, unknown>;
  /** Autres champs arbitraires. */
  [key: string]: unknown;
}

/**
 * `beforeSend` PUR : retourne une COPIE de l'événement Sentry sans PII.
 * Aucune mutation de l'entrée. Prouvé en test : aucun `phone`/`trackingId`/JWT
 * ne subsiste dans la sortie sérialisée.
 *
 * @param event - Événement d'erreur simulé (forme Sentry)
 * @returns Événement expurgé (transmissible à Sentry)
 */
export function scrubEvent(event: SentryLikeEvent): SentryLikeEvent {
  return scrubValue(event) as SentryLikeEvent;
}
