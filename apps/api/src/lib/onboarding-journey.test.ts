/**
 * Tests unitaires — parcours d'onboarding chronométré (ADM-002a).
 *
 * Prouve : 5 étapes horodatées, transitions DONE/SKIPPED, `completedAt` posé quand
 * TOUT est terminal, durée écoulée + indicateur < 2h, somme des cibles < 120 min,
 * projection contractuelle `OnboardingStatusResponse`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  createJourney,
  markStep,
  elapsedMinutes,
  isUnderTarget,
  toStatusResponse,
  isOnboardingStepKey,
  ONBOARDING_STEP_KEYS,
  STEP_TARGET_MINUTES,
  ONBOARDING_TARGET_MINUTES,
} from "src/lib/onboarding-journey.js";

const IDS = {
  onboardingId: "77777777-7777-4777-a777-777777777777",
  agencyId: "66666666-6666-4666-a666-666666666666",
  bankId: "22222222-2222-4222-a222-222222222222",
};

describe("ADM-002a: parcours 5 étapes horodatées", () => {
  it("ADM-002a: parcours neuf → 5 étapes PENDING + startedAt, completedAt null", () => {
    const now = new Date("2026-07-12T10:00:00Z");
    const j = createJourney({ ...IDS, now });
    expect(j.steps).toHaveLength(5);
    expect(j.steps.map((s) => s.key)).toEqual([...ONBOARDING_STEP_KEYS]);
    expect(j.steps.every((s) => s.status === "PENDING")).toBe(true);
    expect(j.steps.every((s) => s.completedAt === null)).toBe(true);
    expect(j.startedAt).toBe("2026-07-12T10:00:00.000Z");
    expect(j.completedAt).toBeNull();
  });

  it("ADM-002a: markStep DONE horodate l'étape, IN_PROGRESS ne l'horodate pas", () => {
    const j0 = createJourney(IDS);
    const done = markStep(j0, "agency_created", "DONE", new Date("2026-07-12T10:05:00Z"));
    const step = done.steps.find((s) => s.key === "agency_created");
    expect(step?.status).toBe("DONE");
    expect(step?.completedAt).toBe("2026-07-12T10:05:00.000Z");

    const inProg = markStep(j0, "services_cloned", "IN_PROGRESS");
    expect(inProg.steps.find((s) => s.key === "services_cloned")?.completedAt).toBeNull();
    // Immutabilité : j0 inchangé.
    expect(j0.steps.find((s) => s.key === "agency_created")?.status).toBe("PENDING");
  });

  it("ADM-002a: completedAt posé UNIQUEMENT quand toutes les étapes sont terminales", () => {
    let j = createJourney(IDS);
    for (const key of ONBOARDING_STEP_KEYS.slice(0, 4)) {
      j = markStep(j, key, "DONE");
      expect(j.completedAt).toBeNull();
    }
    j = markStep(j, "kiosk_provisioned", "DONE", new Date("2026-07-12T11:30:00Z"));
    expect(j.completedAt).toBe("2026-07-12T11:30:00.000Z");
  });

  it("ADM-002a: SKIPPED compte comme terminal (import agents hors périmètre)", () => {
    let j = createJourney(IDS);
    j = markStep(j, "agency_created", "DONE");
    j = markStep(j, "services_cloned", "DONE");
    j = markStep(j, "counters_ready", "DONE");
    j = markStep(j, "agents_imported", "SKIPPED");
    expect(j.completedAt).toBeNull();
    j = markStep(j, "kiosk_provisioned", "DONE");
    expect(j.completedAt).not.toBeNull();
  });
});

describe("ADM-002a: < 2h mesurable", () => {
  it("ADM-002a: la somme des temps cibles est < 120 min", () => {
    const sum = ONBOARDING_STEP_KEYS.reduce((acc, k) => acc + STEP_TARGET_MINUTES[k], 0);
    expect(sum).toBeLessThan(ONBOARDING_TARGET_MINUTES);
  });

  it("ADM-002a: durée écoulée mesurée + indicateur < 2h", () => {
    const start = new Date("2026-07-12T10:00:00Z");
    const j = createJourney({ ...IDS, now: start });
    expect(elapsedMinutes(j, new Date("2026-07-12T11:00:00Z"))).toBeCloseTo(60);
    expect(isUnderTarget(j, new Date("2026-07-12T11:00:00Z"))).toBe(true);
    // Au-delà de 2h → dépassement.
    expect(isUnderTarget(j, new Date("2026-07-12T12:30:00Z"))).toBe(false);
  });

  it("ADM-002a: parcours terminé → durée figée à completedAt", () => {
    const start = new Date("2026-07-12T10:00:00Z");
    let j = createJourney({ ...IDS, now: start });
    for (const key of ONBOARDING_STEP_KEYS) {
      j = markStep(j, key, "DONE", new Date("2026-07-12T11:15:00Z"));
    }
    // now bien après completedAt : la durée reste figée (75 min).
    expect(elapsedMinutes(j, new Date("2026-07-12T20:00:00Z"))).toBeCloseTo(75);
  });
});

describe("ADM-002a: projection + garde de clé", () => {
  it("ADM-002a: toStatusResponse conforme au schéma OnboardingStatusResponse", () => {
    let j = createJourney(IDS);
    j = markStep(j, "agency_created", "DONE", new Date("2026-07-12T10:01:00Z"));
    const res = toStatusResponse(j);
    expect(res.onboardingId).toBe(IDS.onboardingId);
    expect(res.agencyId).toBe(IDS.agencyId);
    expect(res.steps).toHaveLength(5);
    expect(res.steps[0]).toEqual({
      key: "agency_created",
      status: "DONE",
      completedAt: "2026-07-12T10:01:00.000Z",
    });
    expect(res.startedAt).toBe(j.startedAt);
    expect(res.completedAt).toBeNull();
    // La projection n'expose PAS le bankId (garde tenant, hors schéma public).
    expect(res).not.toHaveProperty("bankId");
  });

  it("ADM-002a: isOnboardingStepKey reconnaît les clés valides et rejette le reste", () => {
    expect(isOnboardingStepKey("kiosk_provisioned")).toBe(true);
    expect(isOnboardingStepKey("bogus")).toBe(false);
  });
});
