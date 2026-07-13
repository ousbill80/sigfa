/**
 * Parcours d'onboarding agence chronométré — ADM-002a (CONTRACT-013).
 *
 * Rend le « onboarding < 2h » MESURABLE : un parcours matérialise **5 étapes**
 * horodatées, chacune complétable indépendamment, avec un `startedAt` global et un
 * `completedAt` posé dès que TOUTES les étapes sont terminées.
 *
 * Étapes (LA LOI, ordre stable) :
 *   1. `agency_created`   — l'agence clone est créée
 *   2. `services_cloned`  — services/SLA/seuils clonés depuis la source
 *   3. `counters_ready`   — guichets + liaisons clonés
 *   4. `agents_imported`  — import agents (réutilise API-009, hors périmètre ADM-002a → SKIPPED possible)
 *   5. `kiosk_provisioned`— borne provisionnée (jeton d'enrôlement émis)
 *
 * La SOMME des temps cibles des 5 étapes est < 120 min (objectif produit), et le
 * parcours expose la durée écoulée réelle pour comparaison. Ce module est PUR
 * (aucun I/O) : construction, transition d'étape, calcul d'état — testable hors-ligne.
 * La persistance (reprise du parcours) est déléguée à un `OnboardingStore`.
 *
 * @module
 */

/** Statut d'une étape (LA LOI OnboardingStepStatus). */
export type OnboardingStepStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "SKIPPED";

/** Clés des 5 étapes du parcours (ordre significatif). */
export const ONBOARDING_STEP_KEYS = [
  "agency_created",
  "services_cloned",
  "counters_ready",
  "agents_imported",
  "kiosk_provisioned",
] as const;

/** Clé d'étape typée. */
export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

/**
 * Temps cibles par étape en minutes — leur SOMME est l'objectif « < 2h ».
 * (10 + 30 + 20 + 40 + 15 = 115 min < 120.)
 */
export const STEP_TARGET_MINUTES: Readonly<Record<OnboardingStepKey, number>> = {
  agency_created: 10,
  services_cloned: 30,
  counters_ready: 20,
  agents_imported: 40,
  kiosk_provisioned: 15,
};

/** Objectif produit : durée totale d'onboarding, en minutes. */
export const ONBOARDING_TARGET_MINUTES = 120;

/** Une étape du parcours avec son horodatage de complétion. */
export interface OnboardingStep {
  /** Clé de l'étape. */
  readonly key: OnboardingStepKey;
  /** Statut courant. */
  status: OnboardingStepStatus;
  /** Horodatage de complétion (ISO), ou null si non terminée. */
  completedAt: string | null;
}

/** État sérialisable d'un parcours d'onboarding (persisté pour reprise). */
export interface OnboardingJourney {
  /** Identifiant du parcours. */
  readonly onboardingId: string;
  /** Agence clonée à laquelle le parcours est rattaché. */
  readonly agencyId: string;
  /** Banque propriétaire (garde tenant). */
  readonly bankId: string;
  /** Les 5 étapes horodatées. */
  steps: OnboardingStep[];
  /** Horodatage de démarrage (ISO). */
  readonly startedAt: string;
  /** Horodatage de fin (ISO) — posé quand toutes les étapes sont terminées. */
  completedAt: string | null;
}

/** Vérifie qu'une valeur est une clé d'étape connue. */
export function isOnboardingStepKey(key: string): key is OnboardingStepKey {
  return (ONBOARDING_STEP_KEYS as readonly string[]).includes(key);
}

/**
 * Crée un parcours neuf : 5 étapes `PENDING`, `startedAt` horodaté.
 *
 * @param params - onboardingId, agencyId, bankId, horloge injectable
 * @returns Parcours initial
 */
export function createJourney(params: {
  onboardingId: string;
  agencyId: string;
  bankId: string;
  now?: Date;
}): OnboardingJourney {
  const startedAt = (params.now ?? new Date()).toISOString();
  return {
    onboardingId: params.onboardingId,
    agencyId: params.agencyId,
    bankId: params.bankId,
    steps: ONBOARDING_STEP_KEYS.map((key) => ({
      key,
      status: "PENDING" as OnboardingStepStatus,
      completedAt: null,
    })),
    startedAt,
    completedAt: null,
  };
}

/**
 * Marque une étape avec un statut et horodate sa complétion (DONE/SKIPPED).
 * Recalcule `completedAt` du parcours : posé UNIQUEMENT si toutes les étapes sont
 * terminées (DONE ou SKIPPED). Retourne un NOUVEL objet (immutabilité).
 *
 * @param journey - Parcours courant
 * @param key     - Étape à transitionner
 * @param status  - Nouveau statut
 * @param now     - Horloge injectable (défaut `new Date()`)
 * @returns Parcours mis à jour
 */
export function markStep(
  journey: OnboardingJourney,
  key: OnboardingStepKey,
  status: OnboardingStepStatus,
  now: Date = new Date()
): OnboardingJourney {
  const iso = now.toISOString();
  const isTerminal = status === "DONE" || status === "SKIPPED";
  const steps = journey.steps.map((step) =>
    step.key === key
      ? { key: step.key, status, completedAt: isTerminal ? iso : null }
      : step
  );
  const allTerminal = steps.every(
    (s) => s.status === "DONE" || s.status === "SKIPPED"
  );
  return {
    ...journey,
    steps,
    completedAt: allTerminal ? (journey.completedAt ?? iso) : null,
  };
}

/**
 * Durée écoulée du parcours en minutes (démarrage → maintenant ou fin).
 *
 * @param journey - Parcours
 * @param now     - Horloge injectable (défaut `new Date()`)
 * @returns Minutes écoulées (float)
 */
export function elapsedMinutes(
  journey: OnboardingJourney,
  now: Date = new Date()
): number {
  const end = journey.completedAt ? new Date(journey.completedAt) : now;
  return (end.getTime() - new Date(journey.startedAt).getTime()) / 60_000;
}

/** Vrai si le parcours reste sous l'objectif produit `< 2h`. */
export function isUnderTarget(
  journey: OnboardingJourney,
  now: Date = new Date()
): boolean {
  return elapsedMinutes(journey, now) < ONBOARDING_TARGET_MINUTES;
}

/**
 * Projette le parcours vers la réponse LA LOI `OnboardingStatusResponse`.
 *
 * @param journey - Parcours
 * @returns Objet conforme au schéma contractuel
 */
export function toStatusResponse(journey: OnboardingJourney): {
  onboardingId: string;
  agencyId: string;
  steps: Array<{ key: string; status: OnboardingStepStatus; completedAt: string | null }>;
  startedAt: string;
  completedAt: string | null;
} {
  return {
    onboardingId: journey.onboardingId,
    agencyId: journey.agencyId,
    steps: journey.steps.map((s) => ({
      key: s.key,
      status: s.status,
      completedAt: s.completedAt,
    })),
    startedAt: journey.startedAt,
    completedAt: journey.completedAt,
  };
}

/**
 * Magasin de persistance des parcours d'onboarding (Redis en prod : clé scopée
 * tenant + TTL de sécurité). Permet la reprise du parcours (`GET .../onboarding/{id}`).
 */
export interface OnboardingStore {
  /**
   * Persiste (upsert) un parcours.
   *
   * @param journey - Parcours à enregistrer
   */
  save(journey: OnboardingJourney): Promise<void>;
  /**
   * Charge un parcours par tenant + identifiant.
   *
   * @param bankId       - Banque (garde tenant)
   * @param onboardingId - Identifiant du parcours
   * @returns Le parcours, ou null si absent/expiré
   */
  load(bankId: string, onboardingId: string): Promise<OnboardingJourney | null>;
}
