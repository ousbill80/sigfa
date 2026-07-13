/**
 * IA-001 — Tests unitaires du calendrier CI (fonctions PURES, déterministes).
 *
 * Couvre les critères ⊛ :
 *  - is_month_end / is_public_pay_day / is_public_holiday / is_eve_of_holiday
 *    corrects sur des dates connues ;
 *  - libellés de facteurs = énumération CONTRACT-008 EXACTE.
 *
 * Nommage strict : `IA-001: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  CONTEXTUAL_FACTORS,
  calendarFlags,
  dayOfWeek,
  previousDay,
  nextDay,
  DEFAULT_PAY_DAY_CONFIG,
} from "src/ai/ci-calendar.js";

/** Jeu de fériés CI de référence (échantillon 2026, seed DB-003). */
const HOLIDAYS_2026 = new Set<string>([
  "2026-01-01", // Jour de l'An
  "2026-05-01", // Fête du Travail
  "2026-08-07", // Fête Nationale
  "2026-12-25", // Noël
]);

describe("ci-calendar", () => {
  it("IA-001: libellés de facteurs = énumération CONTRACT-008 exacte (test structurel)", () => {
    expect([...CONTEXTUAL_FACTORS]).toEqual([
      "END_OF_MONTH",
      "CIVIL_SERVICE_PAY",
      "PUBLIC_HOLIDAY",
      "SCHOOL_START",
      "NONE",
    ]);
  });

  it("IA-001: day_of_week = 0..6 (dim..sam) heure locale Abidjan", () => {
    // 2026-07-13 est un lundi.
    expect(dayOfWeek("2026-07-13")).toBe(1);
    // 2026-07-12 est un dimanche.
    expect(dayOfWeek("2026-07-12")).toBe(0);
    // 2026-07-18 est un samedi.
    expect(dayOfWeek("2026-07-18")).toBe(6);
  });

  it("IA-001: is_month_end = l'un des 3 derniers jours OUVRÉS du mois", () => {
    // Juillet 2026 se termine un vendredi 31. Les 3 derniers ouvrés = 29,30,31.
    expect(calendarFlags("2026-07-31", HOLIDAYS_2026).isMonthEnd).toBe(true);
    expect(calendarFlags("2026-07-30", HOLIDAYS_2026).isMonthEnd).toBe(true);
    expect(calendarFlags("2026-07-29", HOLIDAYS_2026).isMonthEnd).toBe(true);
    // 28 juillet (mardi) n'est PAS dans les 3 derniers ouvrés.
    expect(calendarFlags("2026-07-28", HOLIDAYS_2026).isMonthEnd).toBe(false);
  });

  it("IA-001: is_month_end saute les week-ends (mois finissant un dimanche)", () => {
    // Mai 2026 finit un dimanche 31. Les 3 derniers OUVRÉS = mer 27, jeu 28, ven 29.
    expect(calendarFlags("2026-05-31", HOLIDAYS_2026).isMonthEnd).toBe(false); // dimanche
    expect(calendarFlags("2026-05-30", HOLIDAYS_2026).isMonthEnd).toBe(false); // samedi
    expect(calendarFlags("2026-05-29", HOLIDAYS_2026).isMonthEnd).toBe(true);
    expect(calendarFlags("2026-05-28", HOLIDAYS_2026).isMonthEnd).toBe(true);
    expect(calendarFlags("2026-05-27", HOLIDAYS_2026).isMonthEnd).toBe(true);
    expect(calendarFlags("2026-05-26", HOLIDAYS_2026).isMonthEnd).toBe(false);
  });

  it("IA-001: is_public_pay_day = fenêtre 25 → fin de mois par défaut", () => {
    expect(calendarFlags("2026-07-24", HOLIDAYS_2026).isPublicPayDay).toBe(false);
    expect(calendarFlags("2026-07-25", HOLIDAYS_2026).isPublicPayDay).toBe(true);
    expect(calendarFlags("2026-07-31", HOLIDAYS_2026).isPublicPayDay).toBe(true);
    // 1er du mois n'est pas dans la fenêtre paie.
    expect(calendarFlags("2026-07-01", HOLIDAYS_2026).isPublicPayDay).toBe(false);
  });

  it("IA-001: is_public_pay_day paramétrable par banque (sans migration)", () => {
    // Banque qui paie à partir du 20.
    const cfg = { payDayStart: 20 };
    expect(calendarFlags("2026-07-19", HOLIDAYS_2026, cfg).isPublicPayDay).toBe(false);
    expect(calendarFlags("2026-07-20", HOLIDAYS_2026, cfg).isPublicPayDay).toBe(true);
  });

  it("IA-001: is_public_holiday = présence dans le seed DB-003 injecté", () => {
    expect(calendarFlags("2026-08-07", HOLIDAYS_2026).isPublicHoliday).toBe(true);
    expect(calendarFlags("2026-08-06", HOLIDAYS_2026).isPublicHoliday).toBe(false);
  });

  it("IA-001: is_eve_of_holiday = veille d'un férié CI", () => {
    // 2026-08-06 est la veille de la Fête Nationale (07).
    expect(calendarFlags("2026-08-06", HOLIDAYS_2026).isEveOfHoliday).toBe(true);
    // Le férié lui-même n'est pas « veille ».
    expect(calendarFlags("2026-08-07", HOLIDAYS_2026).isEveOfHoliday).toBe(false);
  });

  it("IA-001: factors composite = libellés CONTRACT-008 exacts, ordre déterministe", () => {
    // 2026-08-31 (lundi) : fin de mois (3 derniers ouvrés) + fenêtre paie (≥25).
    const f = calendarFlags("2026-08-31", HOLIDAYS_2026);
    expect(f.factors).toEqual(["END_OF_MONTH", "CIVIL_SERVICE_PAY"]); // ordre déterministe
    // 2026-08-06 : veille de férié uniquement → PUBLIC_HOLIDAY seul.
    const eve = calendarFlags("2026-08-06", HOLIDAYS_2026);
    expect(eve.factors).toEqual(["PUBLIC_HOLIDAY"]);
    // Tous les facteurs émis appartiennent à l'énum de LA LOI.
    for (const factor of [...f.factors, ...eve.factors]) {
      expect(CONTEXTUAL_FACTORS).toContain(factor);
    }
  });

  it("IA-001: factors = [NONE] quand aucun facteur exceptionnel", () => {
    // 2026-07-15 (mercredi), hors fin de mois / paie / férié.
    expect(calendarFlags("2026-07-15", HOLIDAYS_2026).factors).toEqual(["NONE"]);
  });

  it("IA-001: previousDay / nextDay franchissent correctement les bornes de mois", () => {
    expect(previousDay("2026-08-01")).toBe("2026-07-31");
    expect(nextDay("2026-07-31")).toBe("2026-08-01");
    // Année bissextile 2028 : 29 février existe.
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
    expect(nextDay("2028-02-29")).toBe("2028-03-01");
  });

  it("IA-001: DEFAULT_PAY_DAY_CONFIG démarre au 25", () => {
    expect(DEFAULT_PAY_DAY_CONFIG.payDayStart).toBe(25);
  });

  it("IA-001: jour civil invalide lève une erreur explicite", () => {
    expect(() => calendarFlags("2026-13-01", HOLIDAYS_2026)).toThrow(/invalide/);
    expect(() => calendarFlags("2026-02-30", HOLIDAYS_2026)).toThrow(/invalide/);
    expect(() => dayOfWeek("pas-une-date")).toThrow(/invalide/);
  });
});
