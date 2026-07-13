/**
 * Tests for the ADM-002b onboarding parcours model.
 *
 * Covers: 5-step order + targets summing under 2h, chronometer/elapsed +
 * under-target indicator, blocked advancement, QR-required completion guard,
 * resume-from-server-status, and the server→UI step-key mapping.
 * @module lib/adm-onboarding.test
 */
import { describe, it, expect } from "vitest";
import {
  ADM_ONBOARDING_STEPS,
  ADM_ONBOARDING_STEP_COUNT,
  ADM_STEP_TARGET_SECONDS,
  ADM_ONBOARDING_TARGET_SECONDS,
  ADM_ONBOARDING_CEILING_SECONDS,
  initialAdmOnboardingState,
  admCurrentStep,
  admCanAdvance,
  isAdmOnboardingComplete,
  admOnboardingReducer,
  elapsedSeconds,
  isUnderTarget,
  formatDuration,
  mapServerStepKey,
  nextIncompleteStepIndex,
  resumeFromStatus,
  type AdmOnboardingState,
  type KioskEnrollment,
  type ServerOnboardingStatus,
} from "./adm-onboarding";

const ENROLL: KioskEnrollment = {
  kioskId: "14141414-1414-4141-a141-141414141414",
  enrollmentQrUrl: "https://app.sigfa.ci/enroll/14141414-1414-4141-a141-141414141414",
  expiresAt: "2026-07-12T10:30:00Z",
};

/** Drives the parcours through the clone step to a running state. */
function cloned(): AdmOnboardingState {
  let s = initialAdmOnboardingState();
  s = admOnboardingReducer(s, { type: "START_CLONE" });
  s = admOnboardingReducer(s, {
    type: "CLONE_DONE",
    agencyId: "ag-1",
    onboardingId: "ob-1",
    startedAt: "2026-07-12T10:00:00Z",
  });
  return s;
}

describe("ADM-002b: 5-step parcours + target times", () => {
  it("ADM-002b: Stepper a exactement 5 étapes dans l'ordre clone→kiosk", () => {
    expect(ADM_ONBOARDING_STEP_COUNT).toBe(5);
    expect(ADM_ONBOARDING_STEPS).toEqual([
      "clone",
      "services",
      "counters",
      "agents",
      "kiosk",
    ]);
  });

  it("ADM-002b: chaque étape a un temps cible et leur somme est < 2h", () => {
    for (const step of ADM_ONBOARDING_STEPS) {
      expect(ADM_STEP_TARGET_SECONDS[step]).toBeGreaterThan(0);
    }
    const sum = ADM_ONBOARDING_STEPS.reduce((a, s) => a + ADM_STEP_TARGET_SECONDS[s], 0);
    expect(ADM_ONBOARDING_TARGET_SECONDS).toBe(sum);
    expect(ADM_ONBOARDING_TARGET_SECONDS).toBeLessThan(ADM_ONBOARDING_CEILING_SECONDS);
  });
});

describe("ADM-002b: avancement bloqué / conservé", () => {
  it("ADM-002b: étape non complétée → avancement bloqué, progression conservée", () => {
    const s = cloned();
    expect(admCurrentStep(s)).toBe("clone");
    // clone is done (CLONE_DONE) → can advance
    expect(admCanAdvance(s)).toBe(true);
    const s2 = admOnboardingReducer(s, { type: "NEXT" });
    expect(admCurrentStep(s2)).toBe("services");
    // services not completed yet → cannot advance
    expect(admCanAdvance(s2)).toBe(false);
    const blocked = admOnboardingReducer(s2, { type: "NEXT" });
    expect(admCurrentStep(blocked)).toBe("services");
    // completing unblocks, and previous progress is preserved
    const s3 = admOnboardingReducer(s2, { type: "COMPLETE_STEP", step: "services" });
    expect(s3.completed.clone).toBe(true);
    expect(admCanAdvance(s3)).toBe(true);
  });

  it("ADM-002b: clone sans agencyId/onboardingId ne peut pas avancer", () => {
    let s = initialAdmOnboardingState();
    s = admOnboardingReducer(s, { type: "COMPLETE_STEP", step: "clone" });
    // marked complete but no ids → still blocked
    expect(admCanAdvance(s)).toBe(false);
  });

  it("ADM-002b: BACK conserve la progression sans repasser sous zéro", () => {
    let s = cloned();
    s = admOnboardingReducer(s, { type: "NEXT" });
    const back = admOnboardingReducer(s, { type: "BACK" });
    expect(admCurrentStep(back)).toBe("clone");
    const stay = admOnboardingReducer(back, { type: "BACK" });
    expect(stay.stepIndex).toBe(0);
  });
});

describe("ADM-002b: étape QR + complétion", () => {
  it("ADM-002b: onboarding complet exige l'étape kiosk ET un QR valide", () => {
    const s = cloned();
    // mark kiosk complete WITHOUT an enrollment → not complete
    const noQr = admOnboardingReducer(s, { type: "COMPLETE_STEP", step: "kiosk" });
    expect(isAdmOnboardingComplete(noQr)).toBe(false);
    // provision done sets enrollment + completedAt + kiosk done → complete
    const done = admOnboardingReducer(s, {
      type: "PROVISION_DONE",
      enrollment: ENROLL,
      completedAt: "2026-07-12T11:00:00Z",
    });
    expect(done.enrollment).toEqual(ENROLL);
    expect(isAdmOnboardingComplete(done)).toBe(true);
  });

  it("ADM-002b: START_PROVISION passe en état provisioning puis nominal", () => {
    const s = cloned();
    const prov = admOnboardingReducer(s, { type: "START_PROVISION" });
    expect(prov.view).toBe("provisioning");
    const done = admOnboardingReducer(prov, {
      type: "PROVISION_DONE",
      enrollment: ENROLL,
      completedAt: "2026-07-12T11:00:00Z",
    });
    expect(done.view).toBe("nominal");
  });
});

describe("ADM-002b: états error / offline", () => {
  it("ADM-002b: SET_ERROR/SET_OFFLINE/CLEAR_STATUS pilotent les 5 états", () => {
    const s = cloned();
    const err = admOnboardingReducer(s, { type: "SET_ERROR", message: "Échec du clonage" });
    expect(err.view).toBe("error");
    expect(err.error).toBe("Échec du clonage");
    const off = admOnboardingReducer(s, { type: "SET_OFFLINE" });
    expect(off.view).toBe("offline");
    const cleared = admOnboardingReducer(err, { type: "CLEAR_STATUS" });
    expect(cleared.view).toBe("nominal");
    expect(cleared.error).toBeNull();
  });
});

describe("ADM-002b: chronomètre global + indicateur < 2h", () => {
  it("ADM-002b: elapsed = now - startedAt, gelé après completedAt", () => {
    const s = cloned();
    const now = Date.parse("2026-07-12T10:20:00Z");
    expect(elapsedSeconds(s, now)).toBe(1200);
    const finished = admOnboardingReducer(s, {
      type: "PROVISION_DONE",
      enrollment: ENROLL,
      completedAt: "2026-07-12T11:00:00Z",
    });
    // frozen at completedAt - startedAt = 3600, regardless of `now`
    expect(elapsedSeconds(finished, Date.parse("2026-07-12T15:00:00Z"))).toBe(3600);
  });

  it("ADM-002b: indicateur vert tant que sous la cible", () => {
    const s = cloned();
    const underNow = Date.parse("2026-07-12T11:00:00Z"); // 3600s < target
    expect(isUnderTarget(s, underNow)).toBe(true);
    const overNow = Date.parse("2026-07-12T14:00:00Z"); // 14400s > target
    expect(isUnderTarget(s, overNow)).toBe(false);
  });

  it("ADM-002b: elapsed 0 avant démarrage", () => {
    const s = initialAdmOnboardingState();
    expect(elapsedSeconds(s, Date.now())).toBe(0);
  });

  it("ADM-002b: formatDuration rend MM:SS et H:MM:SS", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(65)).toBe("01:05");
    expect(formatDuration(3661)).toBe("1:01:01");
    expect(formatDuration(-5)).toBe("00:00");
  });
});

describe("ADM-002b: reprise de parcours depuis onboarding/{id}", () => {
  it("ADM-002b: resumeFromStatus mappe les étapes DONE et calcule le step courant", () => {
    const status: ServerOnboardingStatus = {
      onboardingId: "ob-1",
      agencyId: "ag-1",
      startedAt: "2026-07-12T10:00:00Z",
      completedAt: null,
      steps: [
        { key: "clone", status: "DONE", completedAt: "2026-07-12T10:01:00Z" },
        { key: "services", status: "DONE", completedAt: "2026-07-12T10:10:00Z" },
        { key: "kiosk-provision", status: "IN_PROGRESS", completedAt: null },
      ],
    };
    const snap = resumeFromStatus(status);
    expect(snap.doneSteps).toEqual(["clone", "services"]);
    const resumed = admOnboardingReducer(initialAdmOnboardingState(), {
      type: "RESUME",
      snapshot: snap,
    });
    expect(resumed.onboardingId).toBe("ob-1");
    expect(resumed.agencyId).toBe("ag-1");
    expect(resumed.startedAt).toBe("2026-07-12T10:00:00Z");
    // first not-done step is "counters" (index 2)
    expect(admCurrentStep(resumed)).toBe("counters");
    expect(resumed.completed.clone).toBe(true);
    expect(resumed.completed.services).toBe(true);
  });

  it("ADM-002b: reprise d'un onboarding terminé restaure le récap (dernière étape)", () => {
    const status: ServerOnboardingStatus = {
      onboardingId: "ob-1",
      agencyId: "ag-1",
      startedAt: "2026-07-12T10:00:00Z",
      completedAt: "2026-07-12T11:00:00Z",
      steps: [{ key: "kiosk-provision", status: "DONE", completedAt: "2026-07-12T11:00:00Z" }],
    };
    const resumed = admOnboardingReducer(initialAdmOnboardingState(), {
      type: "RESUME",
      snapshot: resumeFromStatus(status, ENROLL),
    });
    expect(resumed.stepIndex).toBe(ADM_ONBOARDING_STEP_COUNT - 1);
    expect(resumed.enrollment).toEqual(ENROLL);
    expect(isAdmOnboardingComplete(resumed)).toBe(true);
  });

  it("ADM-002b: nextIncompleteStepIndex renvoie la 1re étape non-faite, sinon la dernière", () => {
    expect(nextIncompleteStepIndex([])).toBe(0);
    expect(nextIncompleteStepIndex(["clone"])).toBe(1);
    expect(nextIncompleteStepIndex(["clone", "services", "counters", "agents"])).toBe(4);
    expect(
      nextIncompleteStepIndex(["clone", "services", "counters", "agents", "kiosk"]),
    ).toBe(ADM_ONBOARDING_STEP_COUNT - 1);
  });
});

describe("ADM-002b: mapping clés serveur → étapes UI", () => {
  it("ADM-002b: mapServerStepKey normalise les alias serveur", () => {
    expect(mapServerStepKey("clone")).toBe("clone");
    expect(mapServerStepKey("agency_created")).toBe("clone");
    expect(mapServerStepKey("counters_ready")).toBe("counters");
    expect(mapServerStepKey("agents_imported")).toBe("agents");
    expect(mapServerStepKey("kiosk_provisioned")).toBe("kiosk");
    expect(mapServerStepKey("kiosk-provision")).toBe("kiosk");
    expect(mapServerStepKey("unknown")).toBeNull();
  });
});
