/**
 * Tests — NET-002 : assignation de cohortes déterministe + adoption idempotente.
 *
 * Nommage : `NET-002: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  kioskRank,
  isInCohort,
  decideAdoption,
  type AdoptionInput,
} from "src/services/rollout/rollout-adoption.js";

function baseInput(over: Partial<AdoptionInput> = {}): AdoptionInput {
  return {
    kioskId: "kiosk-a",
    reportedVersion: "1.9.0",
    targetVersion: "2.0.0",
    stagePct: 100,
    quarantined: false,
    ...over,
  };
}

describe("NET-002 rollout-adoption — cohortes déterministes", () => {
  it("NET-002: kioskRank est déterministe et borné [0,1)", () => {
    const r = kioskRank("kiosk-x");
    expect(r).toBe(kioskRank("kiosk-x"));
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
  });

  it("NET-002: cohortes monotones — un palier plus large inclut les paliers étroits", () => {
    const ids = Array.from({ length: 500 }, (_, i) => `kiosk-${i}`);
    const in5 = ids.filter((id) => isInCohort(id, 5));
    const in25 = ids.filter((id) => isInCohort(id, 25));
    const in100 = ids.filter((id) => isInCohort(id, 100));
    // Tout membre de 5% est membre de 25% et de 100% (jamais de saut incohérent).
    expect(in5.every((id) => in25.includes(id))).toBe(true);
    expect(in25.every((id) => in100.includes(id))).toBe(true);
    expect(in100.length).toBe(ids.length);
  });

  it("NET-002: canary ≤5% — la cohorte 5% est ~5% du parc (déterministe)", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `borne-${i}`);
    const in5 = ids.filter((id) => isInCohort(id, 5)).length / ids.length;
    expect(in5).toBeLessThanOrEqual(0.08); // ≤5% avec marge de dispersion du hash
    expect(in5).toBeGreaterThan(0.02);
  });
});

describe("NET-002 rollout-adoption — idempotence & offline", () => {
  it("NET-002: borne déjà sur la cible → NOOP idempotent (réappliquer sans effet)", () => {
    const d = decideAdoption(baseInput({ reportedVersion: "2.0.0" }));
    expect(d.action).toBe("NOOP");
    if (d.action === "NOOP") expect(d.reason).toBe("ALREADY_TARGET");
  });

  it("NET-002: borne OFFLINE (version ancienne) dans la cohorte → ADOPT à la reconnexion", () => {
    const d = decideAdoption(baseInput({ reportedVersion: "1.9.0", stagePct: 100 }));
    expect(d.action).toBe("ADOPT");
    if (d.action === "ADOPT") expect(d.version).toBe("2.0.0");
  });

  it("NET-002: borne hors cohorte du palier → NOOP (n'adopte pas prématurément)", () => {
    // On cherche une borne dont le rang ≥ 5% pour le palier canary.
    const outsider = Array.from({ length: 200 }, (_, i) => `k-${i}`).find(
      (id) => !isInCohort(id, 5),
    )!;
    const d = decideAdoption(
      baseInput({ kioskId: outsider, stagePct: 5, reportedVersion: "1.9.0" }),
    );
    expect(d.action).toBe("NOOP");
    if (d.action === "NOOP") expect(d.reason).toBe("NOT_IN_COHORT");
  });

  it("NET-002: borne en quarantaine → NOOP (reste sur stable, pas de téléchargement)", () => {
    const d = decideAdoption(baseInput({ quarantined: true, reportedVersion: "1.9.0" }));
    expect(d.action).toBe("NOOP");
    if (d.action === "NOOP") expect(d.reason).toBe("QUARANTINED");
  });

  it("NET-002: adopter deux fois de suite la même cible est sans effet (idempotence)", () => {
    let input = baseInput({ reportedVersion: "1.9.0" });
    const first = decideAdoption(input);
    expect(first.action).toBe("ADOPT");
    // Après adoption, la borne rapporte la cible → NOOP.
    input = { ...input, reportedVersion: "2.0.0" };
    const second = decideAdoption(input);
    expect(second.action).toBe("NOOP");
  });
});
