/**
 * rollout-adoption — NET-002 : assignation de cohortes déterministe + adoption
 * idempotente par borne (via heartbeat `app_version`, API-011).
 *
 * PUR, sans I/O. L'assignation de cohorte est déterministe et traçable (quelle
 * borne, quel palier) : un hash stable de l'`id` borne → rang [0,1) fige l'ordre
 * d'entrée dans les paliers, indépendamment de l'ordre de traitement.
 *
 * Idempotence (D3 EARS §25) : réappliquer la version cible à une borne déjà à
 * jour est sans effet ; une borne OFFLINE adopte la cible de SON palier à la
 * reconnexion, sans sauter de version.
 *
 * @module
 */

import { createHash } from "node:crypto";
import type { RolloutStagePct } from "src/services/rollout/rollout-machine.js";

/** Rang déterministe [0,1) d'une borne (hash stable de son id). */
export function kioskRank(kioskId: string): number {
  const hex = createHash("sha256").update(kioskId).digest("hex").slice(0, 8);
  return parseInt(hex, 16) / 0xffffffff;
}

/**
 * true si la borne appartient à la cohorte cible du palier `stagePct`.
 *
 * Déterministe : le rang [0,1) < stagePct/100 → dans la cohorte. Monotone : un
 * palier plus large inclut toutes les bornes des paliers plus étroits (jamais de
 * saut incohérent).
 */
export function isInCohort(kioskId: string, stagePct: RolloutStagePct): boolean {
  return kioskRank(kioskId) < stagePct / 100;
}

/** Décision d'adoption pour une borne à un heartbeat donné. */
export type AdoptionDecision =
  | { readonly action: "ADOPT"; readonly version: string } // doit basculer sur la cible
  | { readonly action: "NOOP"; readonly reason: "ALREADY_TARGET" | "NOT_IN_COHORT" | "QUARANTINED" };

/** Entrée : ce que la borne rapporte + son éligibilité. */
export interface AdoptionInput {
  readonly kioskId: string;
  /** Version actuellement rapportée par la borne (heartbeat app_version). */
  readonly reportedVersion: string;
  /** Version cible du palier courant. */
  readonly targetVersion: string;
  /** Palier courant du rollout. */
  readonly stagePct: RolloutStagePct;
  /** true si la borne est en quarantaine d'intégrité (reste sur stable). */
  readonly quarantined: boolean;
}

/**
 * Décide l'action d'adoption au heartbeat d'une borne.
 *
 * - quarantaine → NOOP (reste sur stable, pas de boucle de téléchargement).
 * - hors cohorte du palier → NOOP.
 * - déjà sur la cible → NOOP idempotent (réappliquer est sans effet).
 * - dans la cohorte, version ≠ cible → ADOPT (bascule à la reconnexion).
 */
export function decideAdoption(input: AdoptionInput): AdoptionDecision {
  if (input.quarantined) return { action: "NOOP", reason: "QUARANTINED" };
  if (!isInCohort(input.kioskId, input.stagePct)) {
    return { action: "NOOP", reason: "NOT_IN_COHORT" };
  }
  if (input.reportedVersion === input.targetVersion) {
    return { action: "NOOP", reason: "ALREADY_TARGET" };
  }
  return { action: "ADOPT", version: input.targetVersion };
}
