/**
 * Tests for onboarding (WEB-006) — 5-step wizard state machine.
 * @module lib/onboarding.test
 */
import { describe, it, expect } from "vitest";
import {
  initialOnboardingState,
  onboardingReducer,
  currentStep,
  canAdvance,
  isOnboardingComplete,
  ONBOARDING_STEPS,
  ONBOARDING_STEP_COUNT,
} from "./onboarding";

describe("onboarding — machine à états", () => {
  it("WEB-006: parcours 5 étapes — création → template → services → guichets → agents → QR", () => {
    // Le wizard couvre bien 6 écrans (5 étapes de config + QR final).
    expect(ONBOARDING_STEPS).toEqual([
      "create",
      "template",
      "services",
      "counters",
      "agents",
      "qr",
    ]);
    expect(ONBOARDING_STEP_COUNT).toBe(6);

    let s = initialOnboardingState();
    expect(currentStep(s)).toBe("create");
    // Impossible d'avancer tant que l'étape n'est pas complétée.
    expect(canAdvance(s)).toBe(false);

    // Étape création : agence créée → complétée.
    s = onboardingReducer(s, { type: "AGENCY_CREATED", agencyId: "ag-1" });
    expect(s.agencyId).toBe("ag-1");
    expect(canAdvance(s)).toBe(true);
    s = onboardingReducer(s, { type: "NEXT" });
    expect(currentStep(s)).toBe("template");

    // Étapes suivantes : compléter puis avancer.
    for (const step of ["template", "services", "counters", "agents"] as const) {
      expect(currentStep(s)).toBe(step);
      expect(canAdvance(s)).toBe(false);
      s = onboardingReducer(s, { type: "COMPLETE_STEP", step });
      s = onboardingReducer(s, { type: "NEXT" });
    }

    // Dernière étape : QR.
    expect(currentStep(s)).toBe("qr");
    expect(isOnboardingComplete(s)).toBe(false);
    s = onboardingReducer(s, { type: "QR_GENERATED", qrCodeDataUrl: "data:image/png;base64,AAA" });
    expect(isOnboardingComplete(s)).toBe(true);
    // On ne peut pas avancer au-delà de la dernière étape.
    expect(canAdvance(s)).toBe(false);
  });

  it("WEB-006: BACK revient en arrière sans repasser sous 0", () => {
    let s = initialOnboardingState();
    s = onboardingReducer(s, { type: "AGENCY_CREATED", agencyId: "ag-1" });
    s = onboardingReducer(s, { type: "NEXT" });
    expect(currentStep(s)).toBe("template");
    s = onboardingReducer(s, { type: "BACK" });
    expect(currentStep(s)).toBe("create");
    s = onboardingReducer(s, { type: "BACK" });
    expect(currentStep(s)).toBe("create");
  });

  it("WEB-006: create sans agencyId ne permet pas d'avancer même si complété manuellement", () => {
    let s = initialOnboardingState();
    s = onboardingReducer(s, { type: "COMPLETE_STEP", step: "create" });
    // completed mais pas d'agencyId → bloqué.
    expect(canAdvance(s)).toBe(false);
    s = onboardingReducer(s, { type: "NEXT" });
    expect(currentStep(s)).toBe("create");
  });
});
