/**
 * REP-001 — Tests unitaires purs du parseur de période (jour Abidjan).
 *
 * Traduit une chaîne ISO 8601 (`2026`, `2026-07`, `2026-Q3`, `2026-07-12`) en
 * bornes de jours civils Abidjan `[dayStart, dayEnd]` + `periodKey` normalisé.
 * Fonction pure, déterministe (aucune horloge).
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { parsePeriod } from "src/reporting/period.js";

describe("REP-001: period — parsePeriod (bornes jour Abidjan)", () => {
  it("REP-001: jour YYYY-MM-DD → borne unique", () => {
    expect(parsePeriod("2026-07-12")).toEqual({
      dayStart: "2026-07-12",
      dayEnd: "2026-07-12",
      periodKey: "2026-07-12",
    });
  });

  it("REP-001: mois YYYY-MM → 1er au dernier jour", () => {
    expect(parsePeriod("2026-07")).toEqual({
      dayStart: "2026-07-01",
      dayEnd: "2026-07-31",
      periodKey: "2026-07",
    });
  });

  it("REP-001: mois de février bissextile → 29 jours", () => {
    // 2028 est bissextile
    expect(parsePeriod("2028-02")).toEqual({
      dayStart: "2028-02-01",
      dayEnd: "2028-02-29",
      periodKey: "2028-02",
    });
  });

  it("REP-001: mois de février non bissextile → 28 jours", () => {
    expect(parsePeriod("2026-02").dayEnd).toBe("2026-02-28");
  });

  it("REP-001: trimestre YYYY-Q3 → juillet à septembre", () => {
    expect(parsePeriod("2026-Q3")).toEqual({
      dayStart: "2026-07-01",
      dayEnd: "2026-09-30",
      periodKey: "2026-Q3",
    });
  });

  it("REP-001: trimestre YYYY-Q1 → janvier à mars", () => {
    expect(parsePeriod("2026-Q1")).toEqual({
      dayStart: "2026-01-01",
      dayEnd: "2026-03-31",
      periodKey: "2026-Q1",
    });
  });

  it("REP-001: année YYYY → 1er janvier au 31 décembre", () => {
    expect(parsePeriod("2026")).toEqual({
      dayStart: "2026-01-01",
      dayEnd: "2026-12-31",
      periodKey: "2026",
    });
  });

  it("REP-001: format invalide → null (route décide du 400)", () => {
    expect(parsePeriod("juillet")).toBeNull();
    expect(parsePeriod("2026-13")).toBeNull();
    expect(parsePeriod("2026-Q5")).toBeNull();
    expect(parsePeriod("2026-07-32")).toBeNull();
    expect(parsePeriod("")).toBeNull();
  });
});
