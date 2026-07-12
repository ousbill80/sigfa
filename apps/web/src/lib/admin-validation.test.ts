/**
 * Tests for admin-validation (WEB-006) — inline Zod-style validation.
 * @module lib/admin-validation.test
 */
import { describe, it, expect } from "vitest";
import {
  validateService,
  validateThresholds,
  validateAgencyName,
  isValid,
} from "./admin-validation";

describe("admin-validation — service", () => {
  it("WEB-006: CRUD service — SLA, priorité, actif/inactif — validation Zod inline", () => {
    // Valide.
    const ok = validateService({ name: "Virements", code: "OC", slaMinutes: 10, order: 1 });
    expect(isValid(ok)).toBe(true);

    // Code hors pattern ^[A-Z]{2,4}$ → erreur inline sur `code`.
    const badCode = validateService({ name: "X", code: "oc1", slaMinutes: 10, order: 1 });
    expect(badCode.code).toBeDefined();
    expect(isValid(badCode)).toBe(false);

    // SLA < 1 → erreur inline sur `slaMinutes`.
    const badSla = validateService({ name: "X", code: "OC", slaMinutes: 0, order: 1 });
    expect(badSla.slaMinutes).toBeDefined();

    // Priorité < 1 → erreur inline sur `order`.
    const badOrder = validateService({ name: "X", code: "OC", slaMinutes: 5, order: 0 });
    expect(badOrder.order).toBeDefined();

    // Nom vide → erreur inline sur `name`.
    const badName = validateService({ name: "   ", code: "OC", slaMinutes: 5, order: 1 });
    expect(badName.name).toBeDefined();
  });
});

describe("admin-validation — thresholds", () => {
  it("WEB-006: seuils file critique / inactivité / no-show validés selon bornes contrat", () => {
    expect(isValid(validateThresholds({ queueCriticalThreshold: 50, agentInactivityMinutes: 15, noShowTimeoutMinutes: 3 }))).toBe(true);
    expect(validateThresholds({ queueCriticalThreshold: 501, agentInactivityMinutes: 15, noShowTimeoutMinutes: 3 }).queueCriticalThreshold).toBeDefined();
    expect(validateThresholds({ queueCriticalThreshold: 50, agentInactivityMinutes: 61, noShowTimeoutMinutes: 3 }).agentInactivityMinutes).toBeDefined();
    expect(validateThresholds({ queueCriticalThreshold: 50, agentInactivityMinutes: 15, noShowTimeoutMinutes: 31 }).noShowTimeoutMinutes).toBeDefined();
    expect(validateThresholds({ queueCriticalThreshold: 0, agentInactivityMinutes: 0, noShowTimeoutMinutes: 0 }).queueCriticalThreshold).toBeDefined();
  });
});

describe("admin-validation — agency", () => {
  it("WEB-006: nom d'agence obligatoire", () => {
    expect(isValid(validateAgencyName("Agence Cocody"))).toBe(true);
    expect(validateAgencyName("").name).toBeDefined();
    expect(validateAgencyName("   ").name).toBeDefined();
  });
});
