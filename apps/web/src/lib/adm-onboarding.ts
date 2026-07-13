/**
 * adm-onboarding.ts — chronometered, resumable 5-step agency onboarding model
 * (ADM-002b). Pure and network-free so the whole parcours is testable end to end.
 *
 * The parcours drives the NEW clone/provision/onboarding routes (ADM-002a):
 *  - step 1 `clone`    → POST /banks/{id}/agencies:clone (template XOR source)
 *  - step 2 `services` → verify/adjust cloned services & SLA (WEB-006 CRUD)
 *  - step 3 `counters` → verify cloned counters (WEB-006 CRUD)
 *  - step 4 `agents`   → import agents CSV (WEB-006 POST /agents/import, reused)
 *  - step 5 `kiosk`    → POST /agencies/{id}/kiosks:provision → installation QR
 *
 * Product objective (PRD §4): onboarding < 2h. Each step carries a target time;
 * the sum of targets is < 2h. The parcours records `startedAt`/`completedAt` and
 * exposes a global chronometer + a non-anxiety "< 2h" indicator (green while
 * under target). Leaving and coming back restores the current step from
 * `GET /agencies/{id}/onboarding/{onboardingId}` via {@link resumeFromStatus}.
 *
 * @module lib/adm-onboarding
 */

/** The ordered onboarding step keys (UI parcours). */
export const ADM_ONBOARDING_STEPS = [
  "clone",
  "services",
  "counters",
  "agents",
  "kiosk",
] as const;
export type AdmOnboardingStep = (typeof ADM_ONBOARDING_STEPS)[number];

/** Total number of steps (5 — Design System v2 §4). */
export const ADM_ONBOARDING_STEP_COUNT = ADM_ONBOARDING_STEPS.length;

/**
 * Target time per step, in seconds. The sum is the < 2h onboarding budget
 * (5 400 s = 90 min, comfortably under the 7 200 s / 2h product ceiling).
 */
export const ADM_STEP_TARGET_SECONDS: Record<AdmOnboardingStep, number> = {
  clone: 600, // 10 min — name + pick template/source, structural clone
  services: 1200, // 20 min — verify/adjust cloned services & SLA
  counters: 900, // 15 min — verify cloned counters
  agents: 1500, // 25 min — import agents CSV (reused WEB-006)
  kiosk: 1200, // 20 min — provision kiosk + print installation QR
};

/** The global onboarding budget in seconds (sum of step targets, < 2h). */
export const ADM_ONBOARDING_TARGET_SECONDS: number = ADM_ONBOARDING_STEPS.reduce(
  (sum, step) => sum + ADM_STEP_TARGET_SECONDS[step],
  0,
);

/** The hard product ceiling: 2 hours, in seconds. */
export const ADM_ONBOARDING_CEILING_SECONDS = 7200;

/**
 * The five canonical screen states (CLAUDE.md §8). `provisioning` is the
 * loading state while the kiosk provision request is in flight.
 */
export type AdmOnboardingViewState =
  | "nominal"
  | "loading"
  | "error"
  | "offline"
  | "provisioning";

/** Installation QR payload returned by POST /agencies/{id}/kiosks:provision. */
export interface KioskEnrollment {
  kioskId: string;
  /** URL encoded in the QR — never the raw token. */
  enrollmentQrUrl: string;
  /** ISO expiry of the single-use enrollment token. */
  expiresAt: string;
}

/** Parcours state (client-side, mirrors the server onboarding record). */
export interface AdmOnboardingState {
  /** Index into {@link ADM_ONBOARDING_STEPS}. */
  stepIndex: number;
  /** Server onboarding id (set once the clone succeeds). */
  onboardingId: string | null;
  /** The created agency id (set once the clone succeeds). */
  agencyId: string | null;
  /** Which steps are complete. */
  completed: Record<AdmOnboardingStep, boolean>;
  /** ISO timestamp the parcours started (clone step), null before. */
  startedAt: string | null;
  /** ISO timestamp the parcours finished (all steps done), null while running. */
  completedAt: string | null;
  /** Installation QR enrollment (set at the final step), null before. */
  enrollment: KioskEnrollment | null;
  /** Current view state (drives the five-states UI). */
  view: AdmOnboardingViewState;
  /** Human, translated error message (never a raw code), null when none. */
  error: string | null;
}

/** Initial state: step 0 (`clone`), nothing started yet. */
export function initialAdmOnboardingState(): AdmOnboardingState {
  return {
    stepIndex: 0,
    onboardingId: null,
    agencyId: null,
    completed: {
      clone: false,
      services: false,
      counters: false,
      agents: false,
      kiosk: false,
    },
    startedAt: null,
    completedAt: null,
    enrollment: null,
    view: "nominal",
    error: null,
  };
}

/** The step at the current index. */
export function admCurrentStep(state: AdmOnboardingState): AdmOnboardingStep {
  return ADM_ONBOARDING_STEPS[state.stepIndex]!;
}

/**
 * Whether the parcours can advance from the current step.
 * The current step must be complete; the `clone` step additionally requires the
 * agency + onboarding ids (later steps and the QR need the agency to exist).
 * @param state - Current parcours state.
 * @returns true if NEXT is allowed.
 */
export function admCanAdvance(state: AdmOnboardingState): boolean {
  const step = admCurrentStep(state);
  if (state.stepIndex >= ADM_ONBOARDING_STEP_COUNT - 1) return false;
  if (!state.completed[step]) return false;
  if (step === "clone" && (state.agencyId === null || state.onboardingId === null)) {
    return false;
  }
  return true;
}

/**
 * Whether the whole onboarding is finished. Requires the final `kiosk` step
 * complete AND a valid enrollment QR — an apparently-finished step 5 without a
 * QR is never "complete" (PRD Anormal branch).
 * @param state - Current parcours state.
 * @returns true when the agency is operational.
 */
export function isAdmOnboardingComplete(state: AdmOnboardingState): boolean {
  return state.completed.kiosk && state.enrollment !== null;
}

/** Parcours actions. */
export type AdmOnboardingAction =
  | { type: "START_CLONE" }
  | { type: "CLONE_DONE"; agencyId: string; onboardingId: string; startedAt: string }
  | { type: "COMPLETE_STEP"; step: AdmOnboardingStep }
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "START_PROVISION" }
  | { type: "PROVISION_DONE"; enrollment: KioskEnrollment; completedAt: string }
  | { type: "SET_ERROR"; message: string }
  | { type: "SET_OFFLINE" }
  | { type: "CLEAR_STATUS" }
  | { type: "RESUME"; snapshot: ResumeSnapshot };

/**
 * A resume snapshot derived from the server onboarding status. Restores enough
 * to re-enter the parcours at the right step without re-running side effects.
 */
export interface ResumeSnapshot {
  onboardingId: string;
  agencyId: string;
  startedAt: string;
  completedAt: string | null;
  /** Steps the server reports DONE (mapped onto UI step keys). */
  doneSteps: AdmOnboardingStep[];
  /** Enrollment QR if the kiosk was already provisioned (else null). */
  enrollment: KioskEnrollment | null;
}

/** The step to land on given the set of done steps: first not-done, else last. */
export function nextIncompleteStepIndex(doneSteps: readonly AdmOnboardingStep[]): number {
  const done = new Set(doneSteps);
  for (let i = 0; i < ADM_ONBOARDING_STEP_COUNT; i += 1) {
    if (!done.has(ADM_ONBOARDING_STEPS[i]!)) return i;
  }
  return ADM_ONBOARDING_STEP_COUNT - 1;
}

/**
 * Pure reducer for the onboarding parcours.
 * @param state - Current state.
 * @param action - The action.
 * @returns The next state.
 */
export function admOnboardingReducer(
  state: AdmOnboardingState,
  action: AdmOnboardingAction,
): AdmOnboardingState {
  switch (action.type) {
    case "START_CLONE":
      return { ...state, view: "loading", error: null };
    case "CLONE_DONE":
      return {
        ...state,
        agencyId: action.agencyId,
        onboardingId: action.onboardingId,
        startedAt: state.startedAt ?? action.startedAt,
        completed: { ...state.completed, clone: true },
        view: "nominal",
        error: null,
      };
    case "COMPLETE_STEP":
      return {
        ...state,
        completed: { ...state.completed, [action.step]: true },
        view: "nominal",
        error: null,
      };
    case "NEXT":
      return admCanAdvance(state)
        ? { ...state, stepIndex: state.stepIndex + 1, error: null }
        : state;
    case "BACK":
      return state.stepIndex > 0
        ? { ...state, stepIndex: state.stepIndex - 1, error: null }
        : state;
    case "START_PROVISION":
      return { ...state, view: "provisioning", error: null };
    case "PROVISION_DONE":
      return {
        ...state,
        enrollment: action.enrollment,
        completed: { ...state.completed, kiosk: true },
        completedAt: state.completedAt ?? action.completedAt,
        view: "nominal",
        error: null,
      };
    case "SET_ERROR":
      return { ...state, view: "error", error: action.message };
    case "SET_OFFLINE":
      return { ...state, view: "offline" };
    case "CLEAR_STATUS":
      return { ...state, view: "nominal", error: null };
    case "RESUME": {
      const { snapshot } = action;
      const stepIndex = snapshot.completedAt
        ? ADM_ONBOARDING_STEP_COUNT - 1
        : nextIncompleteStepIndex(snapshot.doneSteps);
      const completed: Record<AdmOnboardingStep, boolean> = {
        clone: false,
        services: false,
        counters: false,
        agents: false,
        kiosk: false,
      };
      for (const step of snapshot.doneSteps) completed[step] = true;
      // A restored parcours has at least cloned (it has an onboarding id).
      completed.clone = true;
      if (snapshot.enrollment !== null) completed.kiosk = true;
      return {
        stepIndex,
        onboardingId: snapshot.onboardingId,
        agencyId: snapshot.agencyId,
        completed,
        startedAt: snapshot.startedAt,
        completedAt: snapshot.completedAt,
        enrollment: snapshot.enrollment,
        view: "nominal",
        error: null,
      };
    }
    default:
      return state;
  }
}

/**
 * Elapsed seconds since the parcours started (or 0 before it starts). If the
 * parcours is finished, elapsed is frozen at `completedAt - startedAt`.
 * @param state - Current parcours state.
 * @param now - Current epoch ms (injected for deterministic tests).
 * @returns Elapsed whole seconds (never negative).
 */
export function elapsedSeconds(state: AdmOnboardingState, now: number): number {
  if (state.startedAt === null) return 0;
  const started = Date.parse(state.startedAt);
  if (Number.isNaN(started)) return 0;
  const end = state.completedAt !== null ? Date.parse(state.completedAt) : now;
  const ms = (Number.isNaN(end) ? now : end) - started;
  return ms > 0 ? Math.floor(ms / 1000) : 0;
}

/**
 * Whether the parcours is still under the < 2h target (drives the green
 * indicator). Deliberately measured against the comfortable budget, not the
 * hard ceiling, so the chronometer is guiding, not anxiety-inducing.
 * @param state - Current parcours state.
 * @param now - Current epoch ms.
 * @returns true while elapsed ≤ the onboarding target.
 */
export function isUnderTarget(state: AdmOnboardingState, now: number): boolean {
  return elapsedSeconds(state, now) <= ADM_ONBOARDING_TARGET_SECONDS;
}

/**
 * Formats a duration in seconds as `H:MM:SS` (or `MM:SS` under an hour). Used by
 * the global chronometer and the final recap "measured total duration".
 * @param totalSeconds - Duration in whole seconds.
 * @returns The formatted clock string.
 */
export function formatDuration(totalSeconds: number): string {
  const safe = totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Maps the server onboarding step keys onto the UI parcours steps. The server
 * uses keys like `clone`, `kiosk-provision`; the UI uses `clone` … `kiosk`.
 * Unknown server keys are ignored (forward-compatible).
 * @param serverKey - The `key` field of a server OnboardingStep.
 * @returns The UI step, or null if it does not map.
 */
export function mapServerStepKey(serverKey: string): AdmOnboardingStep | null {
  switch (serverKey) {
    case "clone":
    case "agency_created":
    case "services_cloned":
      return "clone";
    case "services":
      return "services";
    case "counters":
    case "counters_ready":
      return "counters";
    case "agents":
    case "agents_imported":
      return "agents";
    case "kiosk":
    case "kiosk-provision":
    case "kiosk_provisioned":
      return "kiosk";
    default:
      return null;
  }
}

/** Minimal shape of a server onboarding step (subset we consume). */
export interface ServerOnboardingStep {
  key: string;
  status: string;
  completedAt?: string | null;
}

/** Minimal shape of the server onboarding status (subset we consume). */
export interface ServerOnboardingStatus {
  onboardingId: string;
  agencyId: string;
  steps: ServerOnboardingStep[];
  startedAt: string;
  completedAt?: string | null;
}

/**
 * Builds a {@link ResumeSnapshot} from a server onboarding status so the
 * parcours can be resumed at the correct step. Only DONE steps count as done.
 * @param status - The GET onboarding response body.
 * @param enrollment - A previously provisioned enrollment QR, if any.
 * @returns The resume snapshot.
 */
export function resumeFromStatus(
  status: ServerOnboardingStatus,
  enrollment: KioskEnrollment | null = null,
): ResumeSnapshot {
  const doneSteps: AdmOnboardingStep[] = [];
  for (const step of status.steps) {
    if (step.status !== "DONE") continue;
    const ui = mapServerStepKey(step.key);
    if (ui !== null && !doneSteps.includes(ui)) doneSteps.push(ui);
  }
  return {
    onboardingId: status.onboardingId,
    agencyId: status.agencyId,
    startedAt: status.startedAt,
    completedAt: status.completedAt ?? null,
    doneSteps,
    enrollment,
  };
}
