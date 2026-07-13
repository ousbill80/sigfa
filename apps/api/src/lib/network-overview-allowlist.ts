/**
 * Allow-list stricte de la vue réseau cross-tenant — NET-001 (CONTRACT-006/013).
 *
 * SURFACE LA PLUS SENSIBLE du produit : la seule lecture cross-tenant du SIGFA.
 * Ce module est la FRONTIÈRE D'ANONYMISATION. Il projette des lignes brutes issues
 * de TOUTES les banques vers une forme STRICTEMENT en allow-list (agrégats/compteurs
 * uniquement), conforme au schéma `NetworkOverviewResponse` / `NetworkBankAggregate`
 * (`additionalProperties: false`).
 *
 * INVARIANT DE SÉCURITÉ (LA LOI) : aucun champ hors de la liste blanche ne peut
 * apparaître dans la réponse. JAMAIS de PII client (phone, tracking_id, feedback,
 * display_number), JAMAIS de contenu métier d'une banque (ticket brut, nom d'agent,
 * template SMS, config service). Un `bankId` opaque + un `bankLabel` commercial +
 * des compteurs : rien d'autre.
 *
 * La construction est ADDITIVE : on part d'un objet vide et on n'écrit QUE les clés
 * autorisées, à partir de valeurs typées et bornées. Aucune propagation d'une ligne
 * brute (`{ ...row }`) : impossible de fuiter une colonne par oubli.
 *
 * @module
 */

/** Feux de santé agrégée du parc borne d'une banque. */
export type NetworkHealth = "VERT" | "ORANGE" | "ROUGE";

/**
 * Compteurs bruts d'agrégation par banque, tels que dérivés en SQL. AUCUN de ces
 * champs n'est une PII : ce sont des comptages/moyennes. `bankLabel` est le libellé
 * commercial (connu de la plateforme par contrat), jamais une donnée client.
 */
export interface RawBankAggregate {
  /** Identifiant opaque de la banque (UUID). */
  bankId: string;
  /** Libellé commercial de la banque (autorisé — pas une PII). */
  bankLabel: string;
  /** Nombre d'agences de la banque (compteur). */
  agencyCount: number;
  /** Nombre de bornes ONLINE (compteur dérivé du heartbeat). */
  kiosksOnline: number;
  /** Nombre de bornes OFFLINE (compteur dérivé du heartbeat). */
  kiosksOffline: number;
  /** Volume de tickets agrégé sur la période (compteur), optionnel. */
  totalTickets?: number | null;
}

/** Compteurs bruts d'agrégation réseau global (schéma AnonymizedNetworkAggregate). */
export interface RawNetworkAggregate {
  /** Nombre total de tickets réseau sur la période. */
  totalTickets: number;
  /** Temps Moyen d'Attente réseau (minutes). */
  avgTma: number;
  /** Temps Moyen de Traitement réseau (minutes). */
  avgTmt: number;
  /** Temps Total de Service réseau (minutes). */
  avgTts: number;
  /** Taux d'abandon réseau moyen (%). */
  avgTauxAbandon: number;
  /** Taux SLA réseau moyen (%). */
  avgTauxSLA: number;
  /** Taux d'occupation moyen des guichets (%). */
  avgOccupation: number;
  /** Nombre d'agences contribuant à l'agrégat (sans identifiants). */
  agencyCount: number;
  /** Nombre de banques contribuant à l'agrégat (sans identifiants). */
  bankCount: number;
}

/**
 * Clés EXHAUSTIVES autorisées dans un agrégat par banque. Sert de garde d'assertion
 * (les tests vérifient que la sérialisation ne produit AUCUNE autre clé).
 */
export const BANK_AGGREGATE_ALLOWED_KEYS: readonly string[] = [
  "bankId",
  "bankLabel",
  "agencyCount",
  "kiosksOnline",
  "kiosksOffline",
  "totalTickets",
  "uptimePercent",
  "health",
];

/**
 * Clés EXHAUSTIVES autorisées au niveau de la réponse réseau (top-level).
 */
export const NETWORK_OVERVIEW_ALLOWED_KEYS: readonly string[] = [
  "period",
  "generatedAt",
  "aggregate",
  "banks",
];

/**
 * Noms de champs PII / métier INTERDITS. Toute clé (à quelque profondeur que ce soit)
 * dont le nom contient l'un de ces motifs est une VIOLATION de la frontière
 * d'anonymisation — les tests l'assertent sur la réponse sérialisée. Défense en
 * profondeur : la sérialisation additive rend leur apparition déjà impossible.
 */
export const FORBIDDEN_PII_KEY_PATTERNS: readonly string[] = [
  "phone",
  "tracking",
  "feedback",
  "display_number",
  "displaynumber",
  "agent",
  "conseiller",
  "advisor",
  "email",
  "secret",
  "password",
  "ticketid",
  "ticket_id",
];

/**
 * Calcule le feu de santé agrégé d'une banque à partir du taux de bornes muettes.
 * Seuils réseau (dérivés, non métier) : ≤2 % muettes → VERT, ≤10 % → ORANGE, sinon ROUGE.
 * Aucune borne (parc vide) → VERT (rien à surveiller).
 *
 * @param online  - Nombre de bornes en ligne
 * @param offline - Nombre de bornes hors ligne
 * @returns Feu de santé agrégé
 */
export function deriveHealth(online: number, offline: number): NetworkHealth {
  const total = online + offline;
  if (total === 0) return "VERT";
  const muteRatio = offline / total;
  if (muteRatio <= 0.02) return "VERT";
  if (muteRatio <= 0.1) return "ORANGE";
  return "ROUGE";
}

/**
 * Calcule la disponibilité agrégée (%) du parc borne d'une banque.
 * `uptime = online / (online + offline)`. Parc vide → 100 % (rien d'indisponible).
 *
 * @param online  - Nombre de bornes en ligne
 * @param offline - Nombre de bornes hors ligne
 * @returns Disponibilité en pourcentage, arrondie à 0,1
 */
export function deriveUptimePercent(online: number, offline: number): number {
  const total = online + offline;
  if (total === 0) return 100;
  return Math.round((online / total) * 1000) / 10;
}

/**
 * Projette un agrégat brut de banque vers l'item `NetworkBankAggregate` de LA LOI,
 * en construction ADDITIVE (allow-list stricte). `uptimePercent` et `health` sont
 * DÉRIVÉS des compteurs de bornes, jamais lus d'une ligne métier.
 *
 * @param raw - Compteurs bruts de la banque (jamais de PII)
 * @returns Item conforme `NetworkBankAggregate` — clés en allow-list uniquement
 */
export function toBankAggregate(raw: RawBankAggregate): Record<string, unknown> {
  const online = clampCount(raw.kiosksOnline);
  const offline = clampCount(raw.kiosksOffline);
  return {
    bankId: raw.bankId,
    bankLabel: raw.bankLabel,
    agencyCount: clampCount(raw.agencyCount),
    kiosksOnline: online,
    kiosksOffline: offline,
    totalTickets: clampCount(raw.totalTickets ?? 0),
    uptimePercent: deriveUptimePercent(online, offline),
    health: deriveHealth(online, offline),
  };
}

/**
 * Projette l'agrégat réseau global vers `AnonymizedNetworkAggregate` (allow-list).
 * Construction additive : seuls les compteurs/moyennes autorisés sont écrits.
 *
 * @param raw - Compteurs bruts réseau
 * @returns Agrégat conforme, clés en allow-list uniquement
 */
export function toNetworkAggregate(
  raw: RawNetworkAggregate
): Record<string, unknown> {
  return {
    totalTickets: clampCount(raw.totalTickets),
    avgTma: clampNumber(raw.avgTma),
    avgTmt: clampNumber(raw.avgTmt),
    avgTts: clampNumber(raw.avgTts),
    avgTauxAbandon: clampPercent(raw.avgTauxAbandon),
    avgTauxSLA: clampPercent(raw.avgTauxSLA),
    avgOccupation: clampPercent(raw.avgOccupation),
    agencyCount: clampCount(raw.agencyCount),
    bankCount: clampCount(raw.bankCount),
  };
}

/**
 * Assemble la réponse `NetworkOverviewResponse` complète (allow-list stricte).
 *
 * @param period    - Période analysée (YYYY-MM)
 * @param aggregate - Agrégat réseau global
 * @param banks     - Agrégats par banque (déjà projetés, allow-list)
 * @param now       - Horloge serveur (ISO), injectable pour les tests
 * @returns Réponse conforme — top-level en allow-list uniquement
 */
export function toNetworkOverview(
  period: string,
  aggregate: Record<string, unknown>,
  banks: Record<string, unknown>[],
  now: Date
): Record<string, unknown> {
  return {
    period,
    generatedAt: now.toISOString(),
    aggregate,
    banks,
  };
}

/** Borne un compteur entier ≥0 (jamais négatif, jamais fractionnaire). */
function clampCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}

/** Borne un nombre ≥0, arrondi à 0,1. */
function clampNumber(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 10) / 10;
}

/** Borne un pourcentage dans [0, 100], arrondi à 0,1. */
function clampPercent(value: number): number {
  const n = clampNumber(value);
  return n > 100 ? 100 : n;
}
