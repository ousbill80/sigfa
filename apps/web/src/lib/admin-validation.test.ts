/**
 * Tests for admin-validation (WEB-006) — inline Zod-style validation.
 * @module lib/admin-validation.test
 */
import { describe, it, expect } from "vitest";
import {
  validateService,
  validateOperation,
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

describe("admin-validation — operation (MODEL-WEB-A)", () => {
  it("MODEL-WEB-A: opération valide (code ^[A-Z0-9]{2,6}$, SLA propre) → aucune erreur", () => {
    expect(isValid(validateOperation({ code: "DEP", name: "Dépôt espèces", slaMinutes: 8, displayOrder: 1 }))).toBe(true);
    expect(isValid(validateOperation({ code: "RET1", name: "Retrait", slaMinutes: 12, displayOrder: 2 }))).toBe(true);
    // 6 chars max, chiffres autorisés.
    expect(isValid(validateOperation({ code: "AB12CD", name: "X", slaMinutes: 5, displayOrder: 1 }))).toBe(true);
  });

  it("MODEL-WEB-A: SLA vide (null) est VALIDE → hérite du service (D4)", () => {
    const ok = validateOperation({ code: "DEP", name: "Dépôt", slaMinutes: null, displayOrder: 1 });
    expect(isValid(ok)).toBe(true);
    expect(ok.slaMinutes).toBeUndefined();
  });

  it("MODEL-WEB-A: code hors regex ^[A-Z0-9]{2,6}$ → erreur inline sur code", () => {
    expect(validateOperation({ code: "d", name: "X", slaMinutes: null, displayOrder: 1 }).code).toBeDefined();
    expect(validateOperation({ code: "dep", name: "X", slaMinutes: null, displayOrder: 1 }).code).toBeDefined();
    expect(validateOperation({ code: "TOOLONG", name: "X", slaMinutes: null, displayOrder: 1 }).code).toBeDefined();
    expect(validateOperation({ code: "DE-P", name: "X", slaMinutes: null, displayOrder: 1 }).code).toBeDefined();
  });

  it("MODEL-WEB-A: SLA renseigné < 1 → erreur ; nom vide → erreur ; ordre < 1 → erreur", () => {
    expect(validateOperation({ code: "DEP", name: "X", slaMinutes: 0, displayOrder: 1 }).slaMinutes).toBeDefined();
    expect(validateOperation({ code: "DEP", name: "  ", slaMinutes: null, displayOrder: 1 }).name).toBeDefined();
    expect(validateOperation({ code: "DEP", name: "X", slaMinutes: null, displayOrder: 0 }).displayOrder).toBeDefined();
  });

  it("MODEL-WEB-A: PAS de champ priorité sur l'opération (D4)", () => {
    // Le draft n'a aucune notion de priorité ; seul displayOrder existe.
    const draft = validateOperation({ code: "DEP", name: "Dépôt", slaMinutes: null, displayOrder: 1 });
    expect(Object.keys(draft)).not.toContain("priority");
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
