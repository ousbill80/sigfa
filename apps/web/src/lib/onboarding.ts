/**
 * onboarding.ts — 5-step agency onboarding wizard state machine (WEB-006).
 *
 * Steps (in order): create → template → services → counters → agents → qr.
 * Each transition is guarded (cannot advance past a step until it is complete),
 * and the final QR step calls POST /agencies/{id}/kiosk-access. The machine is
 * pure so it can be tested end-to-end in Testing Library without a network.
 * @module lib/onboarding
 */

/** The ordered onboarding steps. */
export const ONBOARDING_STEPS = [
  "create",
  "template",
  "services",
  "counters",
  "agents",
  "qr",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Total number of steps in the wizard. */
export const ONBOARDING_STEP_COUNT = ONBOARDING_STEPS.length;

/** Wizard state. */
export interface OnboardingState {
  /** Index into {@link ONBOARDING_STEPS}. */
  stepIndex: number;
  /** The created agency id (set after the "create" step succeeds). */
  agencyId: string | null;
  /** Which steps have been marked complete. */
  completed: Record<OnboardingStep, boolean>;
  /** QR data URL from POST /agencies/{id}/kiosk-access (set at the final step). */
  qrCodeDataUrl: string | null;
}

/** Initial wizard state (step 0 = "create"). */
export function initialOnboardingState(): OnboardingState {
  return {
    stepIndex: 0,
    agencyId: null,
    completed: {
      create: false,
      template: false,
      services: false,
      counters: false,
      agents: false,
      qr: false,
    },
    qrCodeDataUrl: null,
  };
}

/** Wizard actions. */
export type OnboardingAction =
  | { type: "AGENCY_CREATED"; agencyId: string }
  | { type: "COMPLETE_STEP"; step: OnboardingStep }
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "QR_GENERATED"; qrCodeDataUrl: string };

/** The step at the current index. */
export function currentStep(state: OnboardingState): OnboardingStep {
  return ONBOARDING_STEPS[state.stepIndex]!;
}

/**
 * Whether the wizard can advance from the current step.
 * The current step must be completed first; "create" additionally requires an
 * agency id (the QR step needs the agency to exist to fetch kiosk-access).
 * @param state - Current wizard state.
 * @returns true if NEXT is allowed.
 */
export function canAdvance(state: OnboardingState): boolean {
  const step = currentStep(state);
  if (state.stepIndex >= ONBOARDING_STEP_COUNT - 1) return false;
  if (!state.completed[step]) return false;
  if (step === "create" && state.agencyId === null) return false;
  return true;
}

/**
 * Pure reducer for the onboarding wizard.
 * @param state - Current state.
 * @param action - The action.
 * @returns The next state.
 */
export function onboardingReducer(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState {
  switch (action.type) {
    case "AGENCY_CREATED":
      return {
        ...state,
        agencyId: action.agencyId,
        completed: { ...state.completed, create: true },
      };
    case "COMPLETE_STEP":
      return { ...state, completed: { ...state.completed, [action.step]: true } };
    case "NEXT":
      return canAdvance(state) ? { ...state, stepIndex: state.stepIndex + 1 } : state;
    case "BACK":
      return state.stepIndex > 0 ? { ...state, stepIndex: state.stepIndex - 1 } : state;
    case "QR_GENERATED":
      return {
        ...state,
        qrCodeDataUrl: action.qrCodeDataUrl,
        completed: { ...state.completed, qr: true },
      };
    default:
      return state;
  }
}

/** Whether the whole onboarding is finished (QR generated at the last step). */
export function isOnboardingComplete(state: OnboardingState): boolean {
  return state.completed.qr && state.qrCodeDataUrl !== null;
}
