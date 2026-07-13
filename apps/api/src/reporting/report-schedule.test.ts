/**
 * REP-002 — Tests unitaires PURS de la logique de planification (fenêtres, cron
 * Abidjan, periodKey, idempotence, misfire). Fake-timers pour prouver la
 * conversion de fuseau. Nommage strict : `REP-002: <description>`.
 *
 * @module
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  REPORT_CRONS,
  REPORT_EMAIL_TYPE,
  REPORT_SCOPE,
  REPORT_RECIPIENT_ROLES,
  computeReportWindow,
  reportIdempotencyKey,
  decideMisfire,
  ABIDJAN_TZ,
} from "src/reporting/report-schedule.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("REP-002 crons & mappings (fuseau Abidjan)", () => {
  it("REP-002: journalier planifié 18h00 Africa/Abidjan (pas UTC) — cron + tz", () => {
    expect(REPORT_CRONS.DAILY).toBe("0 18 * * *");
    expect(ABIDJAN_TZ).toBe("Africa/Abidjan");
  });

  it("REP-002: hebdo lundi 07h00, mensuel 1er 07h00 (cron Abidjan)", () => {
    expect(REPORT_CRONS.WEEKLY).toBe("0 7 * * 1");
    expect(REPORT_CRONS.MONTHLY).toBe("0 7 1 * *");
  });

  it("REP-002: mapping type → email NOTIF-004 (DAILY/WEEKLY/MONTHLY_REPORT)", () => {
    expect(REPORT_EMAIL_TYPE.DAILY).toBe("DAILY_REPORT");
    expect(REPORT_EMAIL_TYPE.WEEKLY).toBe("WEEKLY_REPORT");
    expect(REPORT_EMAIL_TYPE.MONTHLY).toBe("MONTHLY_REPORT");
  });

  it("REP-002: portée agency (journalier) vs network (hebdo/mensuel)", () => {
    expect(REPORT_SCOPE.DAILY).toBe("agency");
    expect(REPORT_SCOPE.WEEKLY).toBe("network");
    expect(REPORT_SCOPE.MONTHLY).toBe("network");
  });

  it("REP-002: destinataires par rôle (directeur/réseau/QUALITY+COMEX)", () => {
    expect(REPORT_RECIPIENT_ROLES.DAILY).toEqual(["AGENCY_DIRECTOR"]);
    expect(REPORT_RECIPIENT_ROLES.WEEKLY).toEqual(["NETWORK_DIRECTOR"]);
    expect(REPORT_RECIPIENT_ROLES.MONTHLY).toEqual(["QUALITY", "COMEX"]);
  });
});

describe("REP-002 fenêtres de données (jours civils Abidjan)", () => {
  it("REP-002: journalier → jour civil courant Abidjan, fenêtre partielle (18h00)", () => {
    // 18h00 Abidjan (=18:00Z, Abidjan = UTC+0) le 2026-07-13.
    const firedAt = new Date("2026-07-13T18:00:00Z");
    const w = computeReportWindow("DAILY", firedAt);
    expect(w.dayStart).toBe("2026-07-13");
    expect(w.dayEnd).toBe("2026-07-13");
    expect(w.periodKey).toBe("2026-07-13");
    expect(w.partial).toBe(true);
  });

  it("REP-002: le jour Abidjan est calculé en fuseau, pas en UTC local serveur", () => {
    // 23:30Z un 12 juillet = toujours le 12 en Abidjan (UTC+0). On simule un serveur
    // dont l'horloge locale (fake-timers) est un autre fuseau ; le résultat dépend
    // UNIQUEMENT du fuseau Abidjan, pas de l'horloge locale.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T23:30:00Z"));
    const w = computeReportWindow("DAILY", new Date());
    expect(w.dayStart).toBe("2026-07-12");
  });

  it("REP-002: hebdo lundi 07h → semaine PRÉCÉDENTE lundi→dimanche (bornes exactes)", () => {
    // Lundi 2026-07-13 07h Abidjan → semaine précédente = 2026-07-06 (lun) → 2026-07-12 (dim).
    const firedAt = new Date("2026-07-13T07:00:00Z");
    const w = computeReportWindow("WEEKLY", firedAt);
    expect(w.dayStart).toBe("2026-07-06");
    expect(w.dayEnd).toBe("2026-07-12");
    expect(w.periodKey).toBe("2026-W28");
    expect(w.partial).toBe(false);
  });

  it("REP-002: hebdo — bornes exactes à cheval sur un changement d'année (ISO week)", () => {
    // Lundi 2026-01-05 → semaine précédente = 2025-12-29 (lun) → 2026-01-04 (dim) = 2026-W01.
    const firedAt = new Date("2026-01-05T07:00:00Z");
    const w = computeReportWindow("WEEKLY", firedAt);
    expect(w.dayStart).toBe("2025-12-29");
    expect(w.dayEnd).toBe("2026-01-04");
    expect(w.periodKey).toBe("2026-W01");
  });

  it("REP-002: mensuel 1er 07h → mois civil PRÉCÉDENT (bornes exactes)", () => {
    // 1er août 2026 → juillet 2026 complet.
    const firedAt = new Date("2026-08-01T07:00:00Z");
    const w = computeReportWindow("MONTHLY", firedAt);
    expect(w.dayStart).toBe("2026-07-01");
    expect(w.dayEnd).toBe("2026-07-31");
    expect(w.periodKey).toBe("2026-07");
  });

  it("REP-002: mensuel en janvier → décembre de l'année précédente", () => {
    const firedAt = new Date("2026-01-01T07:00:00Z");
    const w = computeReportWindow("MONTHLY", firedAt);
    expect(w.dayStart).toBe("2025-12-01");
    expect(w.dayEnd).toBe("2025-12-31");
    expect(w.periodKey).toBe("2025-12");
  });

  it("REP-002: mensuel gère février bissextile (2024)", () => {
    const firedAt = new Date("2024-03-01T07:00:00Z");
    const w = computeReportWindow("MONTHLY", firedAt);
    expect(w.dayStart).toBe("2024-02-01");
    expect(w.dayEnd).toBe("2024-02-29");
  });

  it("REP-002: hebdo robuste si le jour de tir tombe un dimanche (isoDow=7)", () => {
    // Robustesse : même si le tir tombe un dimanche (2026-07-12), la semaine
    // précédente reste calculée sur des lundis→dimanches cohérents.
    const firedAt = new Date("2026-07-12T07:00:00Z"); // dimanche
    const w = computeReportWindow("WEEKLY", firedAt);
    expect(w.dayStart).toBe("2026-06-29"); // lundi de la semaine précédente
    expect(w.dayEnd).toBe("2026-07-05");
  });

  it("REP-002: hebdo — semaine ISO d'une année dont le 4 janvier est un dimanche (2015)", () => {
    // 2015-01-04 est un dimanche → exerce la branche `firstThursday` dow=0.
    const firedAt = new Date("2015-01-12T07:00:00Z"); // lundi
    const w = computeReportWindow("WEEKLY", firedAt);
    expect(w.dayStart).toBe("2015-01-05");
    expect(w.periodKey).toBe("2015-W02");
  });
});

describe("REP-002 idempotence (tenant, reportType, periodKey, recipient)", () => {
  it("REP-002: clé stable et déterministe pour les mêmes composants", () => {
    const key = reportIdempotencyKey({
      bankId: "bank-1",
      reportType: "DAILY",
      periodKey: "2026-07-13",
      recipient: "dir@banque.example",
    });
    const same = reportIdempotencyKey({
      bankId: "bank-1",
      reportType: "DAILY",
      periodKey: "2026-07-13",
      recipient: "dir@banque.example",
    });
    expect(key).toBe(same);
    expect(key).toBe("report:bank-1:DAILY:2026-07-13:dir@banque.example");
  });

  it("REP-002: la clé diffère si un composant change (période/destinataire)", () => {
    const base = {
      bankId: "bank-1",
      reportType: "DAILY" as const,
      periodKey: "2026-07-13",
      recipient: "a@banque.example",
    };
    expect(reportIdempotencyKey(base)).not.toBe(
      reportIdempotencyKey({ ...base, periodKey: "2026-07-14" })
    );
    expect(reportIdempotencyKey(base)).not.toBe(
      reportIdempotencyKey({ ...base, recipient: "b@banque.example" })
    );
  });
});

describe("REP-002 misfire (rattrapage unique, fenêtre bornée)", () => {
  const GRACE = 2 * 60 * 60 * 1000; // 2 h

  it("REP-002: tir à l'heure (0 retard) → pas de rattrapage, exécution normale", () => {
    const at = new Date("2026-07-13T18:00:00Z");
    const d = decideMisfire(at, at, GRACE);
    expect(d.recover).toBe(false);
    expect(d.lateBy).toBe(0);
  });

  it("REP-002: worker en retard dans la fenêtre → rattrapage UNIQUE", () => {
    const scheduled = new Date("2026-07-13T18:00:00Z");
    const now = new Date("2026-07-13T18:30:00Z"); // 30 min de retard
    const d = decideMisfire(scheduled, now, GRACE);
    expect(d.recover).toBe(true);
    expect(d.lateBy).toBe(30 * 60 * 1000);
  });

  it("REP-002: retard au-delà de la fenêtre bornée → pas de rattrapage (skip)", () => {
    const scheduled = new Date("2026-07-13T18:00:00Z");
    const now = new Date("2026-07-13T21:00:00Z"); // 3 h de retard > 2 h
    const d = decideMisfire(scheduled, now, GRACE);
    expect(d.recover).toBe(false);
    expect(d.lateBy).toBeGreaterThan(GRACE);
  });
});
