/**
 * IA-002 — Tests du modèle de forecast (fonctions PURES, interprétables).
 *
 * Couvre les critères ⊛ :
 *  - série horaire `{ hour, expectedTickets, confidence }` conforme CONTRACT-008 ;
 *  - `drivers[]` (facteur, sens, poids) non vide et cohérent (explicabilité) ;
 *  - `lowConfidence` quand la confiance < seuil ;
 *  - modèle PAR TENANT : ne mélange jamais un autre agencyId.
 *
 * Nommage strict : `IA-002: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  predictBucket,
  forecastAgencyDay,
  baselineExpected,
  DEFAULT_CALENDAR_WEIGHTS,
  LOW_CONFIDENCE_THRESHOLD,
  FORECAST_MODEL_VERSION,
} from "src/ai/forecast-model.js";
import { makeFeature, makeDay, FX_AGENCY } from "src/ai/forecast-fixtures.js";

describe("forecast-model", () => {
  it("IA-002: forecast retourne une série horaire { hour, expectedTickets, confidence } conforme CONTRACT-008", () => {
    const records = makeDay("2026-07-15", [
      { hour: 8, roll: 12 },
      { hour: 9, roll: 25 },
      { hour: 10, roll: 38 },
    ]);
    const fc = forecastAgencyDay(FX_AGENCY, "2026-07-15", records);
    expect(fc.agencyId).toBe(FX_AGENCY);
    expect(fc.date).toBe("2026-07-15");
    expect(fc.forecast).toHaveLength(3);
    expect(fc.forecast.map((h) => h.hour)).toEqual(["08:00", "09:00", "10:00"]);
    for (const h of fc.forecast) {
      expect(typeof h.expectedTickets).toBe("number");
      expect(h.expectedTickets).toBeGreaterThanOrEqual(0);
      expect(h.confidence).toBeGreaterThanOrEqual(0);
      expect(h.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("IA-002: série triée par heure croissante même si les features arrivent en désordre", () => {
    const records = [
      makeFeature({ hourBucket: 10, arrivalsRollMean4w: 30, arrivalsLag7d: 30 }),
      makeFeature({ hourBucket: 8, arrivalsRollMean4w: 10, arrivalsLag7d: 10 }),
    ];
    const fc = forecastAgencyDay(FX_AGENCY, "2026-07-15", records);
    expect(fc.forecast.map((h) => h.hour)).toEqual(["08:00", "10:00"]);
  });

  it("IA-002: baseline = rollMean4w, repli lag7d, puis 0 (miroir non-régression)", () => {
    expect(baselineExpected(makeFeature({ arrivalsRollMean4w: 40, arrivalsLag7d: 10 }))).toBe(40);
    expect(baselineExpected(makeFeature({ arrivalsRollMean4w: null, arrivalsLag7d: 15 }))).toBe(15);
    expect(baselineExpected(makeFeature({ arrivalsRollMean4w: null, arrivalsLag7d: null }))).toBe(0);
  });

  it("IA-002: chaque forecast expose drivers[] non vide (explicabilité) — driver history_trend par défaut", () => {
    const h = predictBucket(makeFeature({ arrivalsRollMean4w: 20, arrivalsLag7d: 20 }));
    expect(h.drivers.length).toBeGreaterThan(0);
    expect(h.drivers[0]!.factor).toBe("history_trend");
    expect(h.drivers[0]!.direction).toBe("up");
  });

  it("IA-002: facteur paie fonction publique pousse à la hausse et est tracé dans drivers[] (sens up, poids > 0)", () => {
    const base = predictBucket(makeFeature({ arrivalsRollMean4w: 20, arrivalsLag7d: 20 }));
    const pay = predictBucket(
      makeFeature({ arrivalsRollMean4w: 20, arrivalsLag7d: 20, isPublicPayDay: true })
    );
    expect(pay.expectedTickets).toBeGreaterThan(base.expectedTickets);
    const driver = pay.drivers.find((d) => d.factor === "CIVIL_SERVICE_PAY");
    expect(driver).toBeDefined();
    expect(driver!.direction).toBe("up");
    expect(driver!.weight).toBeGreaterThan(0);
    // poids relatif = |mult - 1| = 0.4
    expect(driver!.weight).toBeCloseTo(DEFAULT_CALENDAR_WEIGHTS.civilServicePay - 1, 5);
  });

  it("IA-002: jour férié pousse à la baisse (driver PUBLIC_HOLIDAY sens down)", () => {
    const h = predictBucket(
      makeFeature({ arrivalsRollMean4w: 40, arrivalsLag7d: 40, isPublicHoliday: true })
    );
    const driver = h.drivers.find((d) => d.factor === "PUBLIC_HOLIDAY");
    expect(driver).toBeDefined();
    expect(driver!.direction).toBe("down");
    expect(h.expectedTickets).toBeLessThan(40);
  });

  it("IA-002: fin de mois + paie cumulent leurs multiplicateurs (interprétable)", () => {
    const h = predictBucket(
      makeFeature({
        arrivalsRollMean4w: 20,
        arrivalsLag7d: 20,
        isMonthEnd: true,
        isPublicPayDay: true,
      })
    );
    // 20 * 1.25 * 1.4 = 35
    expect(h.expectedTickets).toBe(35);
    expect(h.drivers.map((d) => d.factor)).toEqual(["END_OF_MONTH", "CIVIL_SERVICE_PAY"]);
  });

  it("IA-002: lowConfidence=true quand la densité d'historique est faible (< seuil 0,5)", () => {
    const h = predictBucket(
      makeFeature({ arrivalsRollMean4w: null, arrivalsLag7d: 10 })
    );
    // seul lag7d présent → densité = 1/4 = 0.25 < 0.5
    expect(h.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
    expect(h.lowConfidence).toBe(true);
  });

  it("IA-002: lowConfidence=false quand l'historique est dense (rollMean4w présent, bucket complet)", () => {
    const h = predictBucket(makeFeature({ arrivalsRollMean4w: 30, arrivalsLag7d: 30 }));
    expect(h.confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE_THRESHOLD);
    expect(h.lowConfidence).toBe(false);
  });

  it("IA-002: bucket partiel pénalise la confiance (fraîcheur dégradée)", () => {
    const full = predictBucket(makeFeature({ arrivalsRollMean4w: 30, arrivalsLag7d: 30, isPartial: false }));
    const partial = predictBucket(makeFeature({ arrivalsRollMean4w: 30, arrivalsLag7d: 30, isPartial: true }));
    expect(partial.confidence).toBeLessThan(full.confidence);
  });

  it("IA-002: modèle PAR TENANT — forecastAgencyDay ignore un autre agencyId", () => {
    const mine = makeFeature({ agencyId: FX_AGENCY, hourBucket: 9, arrivalsRollMean4w: 20, arrivalsLag7d: 20 });
    const other = makeFeature({
      agencyId: "44444444-4444-4444-a444-444444444444",
      hourBucket: 10,
      arrivalsRollMean4w: 99,
      arrivalsLag7d: 99,
    });
    const fc = forecastAgencyDay(FX_AGENCY, "2026-07-15", [mine, other]);
    expect(fc.forecast).toHaveLength(1);
    expect(fc.forecast[0]!.hour).toBe("09:00");
  });

  it("IA-002: contextualFactors = union des buckets, dédupliquée, sinon [NONE]", () => {
    const records = makeDay(
      "2026-07-15",
      [
        { hour: 8, roll: 10 },
        { hour: 9, roll: 10 },
      ],
      { isPublicPayDay: true, factors: ["CIVIL_SERVICE_PAY"] }
    );
    const fc = forecastAgencyDay(FX_AGENCY, "2026-07-15", records);
    expect(fc.contextualFactors).toEqual(["CIVIL_SERVICE_PAY"]);

    const none = forecastAgencyDay(FX_AGENCY, "2026-07-16", []);
    expect(none.contextualFactors).toEqual(["NONE"]);
  });

  it("IA-002: idempotence de calcul — mêmes features ⇒ même forecast", () => {
    const records = makeDay("2026-07-15", [
      { hour: 8, roll: 12 },
      { hour: 9, roll: 25 },
    ]);
    const a = forecastAgencyDay(FX_AGENCY, "2026-07-15", records);
    const b = forecastAgencyDay(FX_AGENCY, "2026-07-15", records);
    expect(a).toEqual(b);
  });

  it("IA-002: version du modèle exposée (AiMeta.modelVersion)", () => {
    expect(FORECAST_MODEL_VERSION).toBe("forecast-ia002-v1");
  });
});
