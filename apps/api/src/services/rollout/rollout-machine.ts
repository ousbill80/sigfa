/**
 * rollout-machine — NET-002 : machine d'état PURE de rollout borne (canary).
 *
 * Aucune I/O, aucune dépendance temps système : l'horloge est **injectée**
 * (`nowMs`) pour rendre les fenêtres de stabilité testables (fake-timers).
 *
 * Séquence de cohortes (D3) :
 *   canary ≤5% → 25% → 50% → 100%.
 *   - Progression MANUELLE jusqu'au palier 25% (gate humain ops).
 *   - Progression AUTOMATIQUE au-delà si **30 min verts** (fenêtre de stabilité).
 *   - HALT automatique si **>10% OFFLINE sur 15 min** dans la cohorte courante.
 *   - ROLLBACK (manuel ou déclenché par halt) → repointe vers la version stable
 *     précédente, toujours conservée et redéployable.
 *
 * Périmètre ops/CI, hors contrat client public : l'adoption réelle se lit via le
 * heartbeat `app_version` (API-011) — voir `rollout-adoption.ts`.
 *
 * @module
 */

/** Paliers de rollout, en pourcentage cumulé du parc (canary d'abord). */
export const ROLLOUT_STAGES = [5, 25, 50, 100] as const;

/** Un pourcentage de palier (5 | 25 | 50 | 100). */
export type RolloutStagePct = (typeof ROLLOUT_STAGES)[number];

/** Dernier palier atteignable en progression MANUELLE (au-delà = auto). */
export const MANUAL_UNTIL_PCT = 25;

/** Fenêtre verte requise pour progression automatique (30 min, D3). */
export const GREEN_WINDOW_MS = 30 * 60 * 1000;

/** Fenêtre d'observation du halt (15 min, D3). */
export const HALT_WINDOW_MS = 15 * 60 * 1000;

/** Seuil de halt : fraction OFFLINE/échec de la cohorte (>10%, D3). */
export const HALT_OFFLINE_FRACTION = 0.1;

/** Phase du rollout. */
export type RolloutPhase =
  | "PENDING" // publié, aucune cohorte encore déployée
  | "ROLLING" // au moins une cohorte déployée, pas encore 100%
  | "COMPLETED" // 100% adopté
  | "HALTED" // stoppé (seuil dépassé) — attend rollback ou décision
  | "ROLLED_BACK"; // repointé sur la version stable précédente

/** Santé instantanée d'une cohorte (dérivée du heartbeat + supervision ADM-003). */
export interface CohortHealth {
  /** Bornes de la cohorte ayant adopté la version cible (heartbeat app_version). */
  readonly adopted: number;
  /** Bornes de la cohorte en état OFFLINE / échec intégrité / crash. */
  readonly offlineOrFailed: number;
  /** Taille totale de la cohorte. */
  readonly total: number;
}

/** État PUR du rollout (sérialisable, sans I/O). */
export interface RolloutState {
  /** Version cible du déploiement. */
  readonly targetVersion: string;
  /** Version stable précédente (conservée, redéployable). */
  readonly stableVersion: string;
  /** Phase courante. */
  readonly phase: RolloutPhase;
  /** Palier courant (pct cumulé). `null` en PENDING. */
  readonly stagePct: RolloutStagePct | null;
  /**
   * Instant (ms) depuis lequel la cohorte courante est verte en continu.
   * `null` si jamais vert ou fenêtre rompue.
   */
  readonly greenSinceMs: number | null;
}

/** Publie un rollout (aucune cohorte déployée). */
export function initRollout(targetVersion: string, stableVersion: string): RolloutState {
  return {
    targetVersion,
    stableVersion,
    phase: "PENDING",
    stagePct: null,
    greenSinceMs: null,
  };
}

/** Palier suivant après `pct`, ou `null` si `pct` est le dernier (100%). */
export function nextStage(pct: RolloutStagePct): RolloutStagePct | null {
  const idx = ROLLOUT_STAGES.indexOf(pct);
  const next = ROLLOUT_STAGES[idx + 1];
  return next ?? null;
}

/** Dernier palier (couverture 100% du parc). */
export const FINAL_STAGE_PCT = ROLLOUT_STAGES[ROLLOUT_STAGES.length - 1]; // 100

/**
 * Applique une promotion vers `next` : si `next` est le palier final (100%),
 * le rollout est COMPLETED (parc entier ciblé, plus de palier ultérieur) ; sinon
 * on avance sur `next` avec une nouvelle fenêtre verte à observer.
 */
function landOnStage(state: RolloutState, next: RolloutStagePct): RolloutState {
  if (next === FINAL_STAGE_PCT) {
    return { ...state, phase: "COMPLETED", stagePct: next, greenSinceMs: null };
  }
  return { ...state, stagePct: next, greenSinceMs: null };
}

/** true si la cohorte dépasse le seuil de halt (>10% OFFLINE/échec). */
export function isCohortUnhealthy(health: CohortHealth): boolean {
  if (health.total <= 0) return false;
  return health.offlineOrFailed / health.total > HALT_OFFLINE_FRACTION;
}

/** true si la cohorte est pleinement adoptée (toutes bornes sur la cible). */
export function isCohortFullyAdopted(health: CohortHealth): boolean {
  return health.total > 0 && health.adopted >= health.total;
}

/**
 * Démarre le canary (première cohorte ≤5%). Depuis PENDING uniquement.
 * Idempotent : re-démarrer un rollout déjà démarré est sans effet.
 *
 * L'instant de démarrage n'est pas nécessaire : la fenêtre verte de la cohorte
 * canary s'ouvre au premier relevé de santé (`observeHealth`).
 */
export function startCanary(state: RolloutState): RolloutState {
  if (state.phase !== "PENDING") return state;
  return {
    ...state,
    phase: "ROLLING",
    stagePct: ROLLOUT_STAGES[0], // 5%
    greenSinceMs: null,
  };
}

/**
 * Intègre un relevé de santé de la cohorte courante à l'instant `nowMs`.
 *
 * - cohorte malsaine (>10% OFFLINE) → HALT immédiat (pas d'attente de fenêtre) ;
 *   le palier ne progresse pas.
 * - cohorte saine → ouvre/maintient la fenêtre verte (`greenSinceMs`).
 * - relevé isolé malsain puis sain → la fenêtre verte redémarre (continuité
 *   requise sur 30 min).
 */
export function observeHealth(
  state: RolloutState,
  health: CohortHealth,
  nowMs: number,
): RolloutState {
  if (state.phase !== "ROLLING") return state;
  if (isCohortUnhealthy(health)) {
    return { ...state, phase: "HALTED", greenSinceMs: null };
  }
  // Cohorte saine : ouvre la fenêtre verte si pas déjà ouverte.
  return {
    ...state,
    greenSinceMs: state.greenSinceMs ?? nowMs,
  };
}

/** true si la cohorte courante est verte en continu depuis ≥ `GREEN_WINDOW_MS`. */
export function isGreenWindowElapsed(state: RolloutState, nowMs: number): boolean {
  if (state.greenSinceMs === null) return false;
  return nowMs - state.greenSinceMs >= GREEN_WINDOW_MS;
}

/** true si le palier courant requiert un gate MANUEL pour progresser. */
export function requiresManualPromotion(state: RolloutState): boolean {
  return state.stagePct !== null && state.stagePct <= MANUAL_UNTIL_PCT;
}

/**
 * Promotion MANUELLE au palier suivant (gate humain ops).
 *
 * N'avance que si ROLLING et cohorte non malsaine. Refusée si HALTED/COMPLETED.
 * Réinitialise la fenêtre verte pour la nouvelle cohorte.
 */
export function promoteManual(
  state: RolloutState,
  health: CohortHealth,
): RolloutState {
  if (state.phase !== "ROLLING" || state.stagePct === null) return state;
  if (isCohortUnhealthy(health)) {
    return { ...state, phase: "HALTED", greenSinceMs: null };
  }
  const next = nextStage(state.stagePct);
  if (next === null) {
    return { ...state, phase: "COMPLETED" };
  }
  return landOnStage(state, next);
}

/**
 * Tentative de promotion AUTOMATIQUE (au-delà de 25%, si 30 min verts).
 *
 * Ne s'applique QUE si le palier courant est éligible à l'auto (> 25%) ET que la
 * fenêtre verte est écoulée ET que la cohorte est saine. Sinon : état inchangé.
 */
export function tryPromoteAuto(
  state: RolloutState,
  health: CohortHealth,
  nowMs: number,
): RolloutState {
  if (state.phase !== "ROLLING" || state.stagePct === null) return state;
  if (requiresManualPromotion(state)) return state; // ≤25% = manuel obligatoire
  if (isCohortUnhealthy(health)) {
    return { ...state, phase: "HALTED", greenSinceMs: null };
  }
  if (!isGreenWindowElapsed(state, nowMs)) return state;
  const next = nextStage(state.stagePct);
  if (next === null) {
    return { ...state, phase: "COMPLETED" };
  }
  return landOnStage(state, next);
}

/**
 * Rollback (manuel ou déclenché par halt) → repointe vers la version stable.
 *
 * La version stable précédente est toujours conservée : `targetVersion` devient
 * la version stable et le rollout passe en ROLLED_BACK. Idempotent.
 */
export function rollback(state: RolloutState): RolloutState {
  if (state.phase === "ROLLED_BACK") return state;
  return {
    ...state,
    phase: "ROLLED_BACK",
    // La cible effective redevient la version stable connue-bonne.
    targetVersion: state.stableVersion,
    stagePct: null,
    greenSinceMs: null,
  };
}
