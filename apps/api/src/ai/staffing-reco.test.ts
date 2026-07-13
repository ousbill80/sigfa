/**
 * IA-002 — Tests de la dérivation staffing (fonctions PURES, garde-fou cardinal).
 *
 * Couvre les critères ⊛ :
 *  - dérivation `{ time, action, counters, rationale }` citant prédiction + SLA ;
 *  - garde `lowConfidence` : aucune reco dérivée d'un seul point faible ;
 *  - GARDE-FOU « humain dans la boucle » : AUCUNE mutation d'état émise par le moteur.
 *
 * Nommage strict : `IA-002: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  deriveStaffingRecommendations,
  DEFAULT_STAFFING_PARAMS,
  STAFFING_MODEL_VERSION,
  type StaffingParams,
} from "src/ai/staffing-reco.js";
import { forecastAgencyDay } from "src/ai/forecast-model.js";
import type { AgencyForecast, ForecastHour } from "src/ai/forecast-model.js";
import { makeDay, FX_AGENCY } from "src/ai/forecast-fixtures.js";

/** Construit un forecast d'agence directement à partir de points horaires (bypass modèle). */
function forecastOf(hours: readonly ForecastHour[]): AgencyForecast {
  return {
    agencyId: FX_AGENCY,
    date: "2026-07-15",
    contextualFactors: ["NONE"],
    forecast: hours,
  };
}

function hour(
  h: string,
  expectedTickets: number,
  confidence = 0.9,
  lowConfidence = false
): ForecastHour {
  return {
    hour: h,
    expectedTickets,
    confidence,
    drivers: [{ factor: "history_trend", direction: "up", weight: confidence }],
    lowConfidence,
  };
}

describe("staffing-reco", () => {
  it("IA-002: un pic (>1 guichet requis) dérive OPEN_COUNTER avec rationale citant prédiction + SLA", () => {
    // 38 tickets / 12 par guichet = 4 guichets requis → ouvrir 3 supplémentaires.
    const recs = deriveStaffingRecommendations(forecastOf([hour("10:00", 38)]));
    expect(recs).toHaveLength(1);
    const rec = recs[0]!;
    expect(rec.time).toBe("10:00");
    expect(rec.action).toBe("OPEN_COUNTER");
    expect(rec.counters).toBe(3);
    expect(rec.status).toBe("pending");
    expect(rec.rationale).toContain("38 tickets");
    expect(rec.rationale).toContain("10:00");
    expect(rec.rationale).toContain(`${DEFAULT_STAFFING_PARAMS.slaTargetRate} %`);
  });

  it("IA-002: un creux marqué dérive CLOSE_COUNTER (sous-activité prévue)", () => {
    // 4 tickets ≤ 12 * 0.4 = 4.8 → creux → fermer 1 guichet.
    const recs = deriveStaffingRecommendations(forecastOf([hour("13:00", 4)]));
    expect(recs).toHaveLength(1);
    expect(recs[0]!.action).toBe("CLOSE_COUNTER");
    expect(recs[0]!.counters).toBe(1);
    expect(recs[0]!.rationale).toContain("Creux");
  });

  it("IA-002: une charge nominale (1 guichet suffit, pas de creux) ne dérive aucune reco", () => {
    // 10 tickets : 1 guichet suffit (ceil(10/12)=1), et 10 > 4.8 → aucune action.
    const recs = deriveStaffingRecommendations(forecastOf([hour("11:00", 10)]));
    expect(recs).toHaveLength(0);
  });

  it("IA-002: lowConfidence → AUCUNE recommandation dérivée du seul point faible (anti-sur-réaction)", () => {
    // Pic à 60 tickets MAIS lowConfidence → ignoré.
    const recs = deriveStaffingRecommendations(
      forecastOf([hour("10:00", 60, 0.3, true)])
    );
    expect(recs).toHaveLength(0);
  });

  it("IA-002: dérivation depuis un vrai forecast du modèle (chaîne complète)", () => {
    const records = makeDay("2026-07-15", [
      { hour: 8, roll: 3 }, // creux (≤ 12*0.4 = 4.8)
      { hour: 10, roll: 40 }, // pic
      { hour: 12, roll: 15 }, // nominal
    ]);
    const fc = forecastAgencyDay(FX_AGENCY, "2026-07-15", records);
    const recs = deriveStaffingRecommendations(fc);
    const actions = recs.map((r) => r.action);
    expect(actions).toContain("OPEN_COUNTER");
    expect(actions).toContain("CLOSE_COUNTER");
    expect(actions).not.toContain("BREAK"); // non produit par ce moteur v1
  });

  it("IA-002: recommandations triées par heure croissante", () => {
    const recs = deriveStaffingRecommendations(
      forecastOf([hour("08:00", 2), hour("14:00", 50)])
    );
    expect(recs.map((r) => r.time)).toEqual(["08:00", "14:00"]);
  });

  it("IA-002: paramètres capacité/SLA injectables (par tenant) sans changer le moteur", () => {
    const params: StaffingParams = {
      ticketsPerCounterPerHour: 20,
      slaTargetRate: 90,
      lowActivityFraction: 0.4,
    };
    // 38 / 20 = 2 guichets requis → ouvrir 1.
    const recs = deriveStaffingRecommendations(forecastOf([hour("10:00", 38)]), params);
    expect(recs[0]!.counters).toBe(1);
    expect(recs[0]!.rationale).toContain("90 %");
  });

  it("IA-002: GARDE-FOU CARDINAL — le moteur n'émet AUCUNE mutation (sortie 100 % inerte, sans effet de bord)", () => {
    const records = makeDay("2026-07-15", [
      { hour: 10, roll: 40 },
      { hour: 13, roll: 3 },
    ]);
    const fc = forecastAgencyDay(FX_AGENCY, "2026-07-15", records);

    // On gèle les fixtures : aucune mutation ne doit les toucher.
    const snapshot = JSON.stringify(records);
    const recs = deriveStaffingRecommendations(fc);

    // 1. Les features d'entrée sont inchangées (pas de mutation d'état).
    expect(JSON.stringify(records)).toBe(snapshot);

    // 2. La sortie est une donnée pure : chaque reco est en `pending`, jamais exécutée.
    for (const rec of recs) {
      expect(rec.status).toBe("pending");
      // Aucune reco ne porte de marqueur d'exécution/acquittement automatique.
      expect(Object.keys(rec).sort()).toEqual(
        ["action", "counters", "rationale", "status", "time"].sort()
      );
    }

    // 3. La fonction est pure : deux appels donnent un résultat structurellement égal
    //    (aucun compteur/état interne muté entre appels).
    expect(deriveStaffingRecommendations(fc)).toEqual(recs);
  });

  it("IA-002: version du modèle staffing exposée (AiMeta.modelVersion)", () => {
    expect(STAFFING_MODEL_VERSION).toBe("staffing-ia002-v1");
  });
});
