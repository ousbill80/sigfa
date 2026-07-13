/**
 * REP-002 — Tests unitaires de l'assemblage d'un rapport (`buildAndEnqueueReport`),
 * SANS BullMQ ni DB réelle : `reportQuery` et `recipientsQuery` sont des stubs.
 *
 * Prouve :
 *  - KPI dérivés EXCLUSIVEMENT de REP-001 (agrégat DB-006 → `computeKpiSet`) ;
 *  - portée agency → 1 payload/agence ; network → 1 payload anonymisé (0 PII) ;
 *  - un envoi email enfilé par destinataire, clé idempotente (tenant,type,period,recipient) ;
 *  - 0 donnée sur la fenêtre → payload émis avec KPIs `null` (jamais d'échec silencieux) ;
 *  - 0 destinataire → aucun envoi, journalisé (pas d'exception).
 *
 * Nommage strict : `REP-002: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import type { QueryFn as DbQueryFn } from "@sigfa/database";
import {
  buildAndEnqueueReport,
  type BuildReportDeps,
  type ReportEmailEnqueue,
} from "src/jobs/report-build.job.js";
import type { ReportPayload } from "src/reporting/report-schedule.js";
import type { QueryFn as ReportQueryFn } from "src/reporting/aggregate-service.js";

/** Ligne d'agrégat DB-006 (toutes-services) — colonnes utiles. */
type StatsRow = Record<string, number>;

/** Fabrique une ligne d'agrégat journalier réaliste (une journée pleine). */
function statsRow(overrides: Partial<StatsRow> = {}): StatsRow {
  return {
    tickets_issued: 100,
    tickets_served: 80,
    tickets_abandoned: 15,
    tickets_no_show: 5,
    total_wait_seconds: 80 * 300, // 300 s moyenne d'attente sur les servis+no_show
    total_service_seconds: 80 * 240,
    sla_met_count: 70,
    sla_total_count: 100,
    feedback_count: 40,
    nps_promoters: 30,
    nps_passives: 5,
    nps_detractors: 5,
    agent_active_seconds: 3600,
    agent_available_seconds: 7200,
    ...overrides,
  };
}

/** Stub `reportQuery` : renvoie `rows` pour toute lecture d'agrégats. */
function stubReportQuery(rows: Array<Record<string, unknown>>): ReportQueryFn {
  return async () => ({ rows });
}

/** Stub `recipientsQuery` : BEGIN/SET/COMMIT no-op ; SELECT email → `emails`. */
function stubRecipientsQuery(emails: string[]): DbQueryFn {
  return (async (sql: string) => {
    if (sql.includes("SELECT DISTINCT u.email")) {
      return { rows: emails.map((email) => ({ email })) };
    }
    return { rows: [] };
  }) as DbQueryFn;
}

/** Une entrée d'enfilement capturée (avec la pièce jointe PDF éventuelle). */
interface CapturedEnqueue {
  /** Métadonnées d'enfilement. */
  enqueue: ReportEmailEnqueue;
  /** Payload de rapport. */
  payload: ReportPayload;
  /** Pièce jointe PDF passée par le job (REP-002b) — `undefined` si non branchée. */
  pdf?: { filename: string; contentType: string; sizeBytes: number; contentBase64: string };
}

/** Collecteur d'enfilements (au lieu d'un vrai enqueue BullMQ). */
function makeEnqueueCollector(): {
  deps: Pick<BuildReportDeps, "enqueueReportEmail">;
  enqueued: CapturedEnqueue[];
} {
  const enqueued: CapturedEnqueue[] = [];
  return {
    enqueued,
    deps: {
      enqueueReportEmail: async (enqueue, payload, pdfAttachment) => {
        enqueued.push({ enqueue, payload, pdf: pdfAttachment });
      },
    },
  };
}

describe("REP-002 assemblage journalier (portée agency, dérivé REP-001)", () => {
  it("REP-002: payload chiffré 100% dérivé de REP-001 (KPIs calculés depuis l'agrégat DB-006)", async () => {
    const col = makeEnqueueCollector();
    const deps: BuildReportDeps = {
      reportQuery: stubReportQuery([statsRow()]),
      recipientsQuery: stubRecipientsQuery(["dir@banque.example"]),
      listAgencies: async () => ["agency-1"],
      ...col.deps,
    };
    const res = await buildAndEnqueueReport(
      "DAILY",
      "bank-1",
      new Date("2026-07-13T18:00:00Z"),
      deps
    );

    expect(res.payloadsBuilt).toBe(1);
    const payload = res.payloads[0]!;
    expect(payload.scope).toBe("agency");
    expect(payload.agencyId).toBe("agency-1");
    expect(payload.periodKey).toBe("2026-07-13");
    expect(payload.partial).toBe(true);
    expect(payload.totalTickets).toBe(100);
    // KPIs dérivés du moteur pur (aucune formule locale) : SLA = 70/100 = 70 %.
    expect(payload.kpis.tauxSLA.value).toBe(70);
    // Occupation = 3600/7200 = 50 %.
    expect(payload.kpis.occupation.value).toBe(50);
    // TMA = 80*300 / (80+5) servedCount ≈ 282 s (base attente = DONE+NO_SHOW).
    expect(payload.kpis.tma.value).toBeGreaterThan(0);
  });

  it("REP-002: un envoi email enfilé par destinataire, clé idempotente stable", async () => {
    const col = makeEnqueueCollector();
    const deps: BuildReportDeps = {
      reportQuery: stubReportQuery([statsRow()]),
      recipientsQuery: stubRecipientsQuery(["a@banque.example", "b@banque.example"]),
      listAgencies: async () => ["agency-1"],
      ...col.deps,
    };
    const res = await buildAndEnqueueReport(
      "DAILY",
      "bank-1",
      new Date("2026-07-13T18:00:00Z"),
      deps
    );

    expect(res.emailsEnqueued).toBe(2);
    expect(col.enqueued.map((e) => e.enqueue.recipient).sort()).toEqual([
      "a@banque.example",
      "b@banque.example",
    ]);
    expect(col.enqueued[0]!.enqueue.emailType).toBe("DAILY_REPORT");
    expect(col.enqueued[0]!.enqueue.dedupeKey).toBe(
      "report:bank-1:DAILY:2026-07-13:a@banque.example"
    );
  });

  it("REP-002: une agence par payload (portée agency)", async () => {
    const col = makeEnqueueCollector();
    const deps: BuildReportDeps = {
      reportQuery: stubReportQuery([statsRow()]),
      recipientsQuery: stubRecipientsQuery(["dir@banque.example"]),
      listAgencies: async () => ["a1", "a2", "a3"],
      ...col.deps,
    };
    const res = await buildAndEnqueueReport(
      "DAILY",
      "bank-1",
      new Date("2026-07-13T18:00:00Z"),
      deps
    );
    expect(res.payloadsBuilt).toBe(3);
    expect(res.payloads.map((p) => p.agencyId)).toEqual(["a1", "a2", "a3"]);
    expect(res.emailsEnqueued).toBe(3);
  });

  it("REP-002: 0 donnée sur la fenêtre → payload émis avec KPIs null (N/A, jamais d'échec)", async () => {
    const col = makeEnqueueCollector();
    const deps: BuildReportDeps = {
      // Aucune ligne d'agrégat sur la fenêtre.
      reportQuery: stubReportQuery([]),
      recipientsQuery: stubRecipientsQuery(["dir@banque.example"]),
      listAgencies: async () => ["agency-1"],
      ...col.deps,
    };
    const res = await buildAndEnqueueReport(
      "DAILY",
      "bank-1",
      new Date("2026-07-13T18:00:00Z"),
      deps
    );
    const payload = res.payloads[0]!;
    expect(payload.totalTickets).toBe(0);
    // Dénominateurs nuls ⇒ KPIs null (rendus « N/A » par REP-002b), jamais 0 trompeur.
    expect(payload.kpis.tma.value).toBeNull();
    expect(payload.kpis.tauxSLA.value).toBeNull();
    expect(payload.kpis.nps).toBeNull();
    // Le rapport est TOUT DE MÊME émis (envoi enfilé).
    expect(res.emailsEnqueued).toBe(1);
  });

  it("REP-002: 0 destinataire → aucun envoi, journalisé (pas d'exception)", async () => {
    const logs: string[] = [];
    const col = makeEnqueueCollector();
    const deps: BuildReportDeps = {
      reportQuery: stubReportQuery([statsRow()]),
      recipientsQuery: stubRecipientsQuery([]), // aucun destinataire résolu
      listAgencies: async () => ["agency-1"],
      log: (e) => logs.push(e.message),
      ...col.deps,
    };
    const res = await buildAndEnqueueReport(
      "DAILY",
      "bank-1",
      new Date("2026-07-13T18:00:00Z"),
      deps
    );
    expect(res.emailsEnqueued).toBe(0);
    expect(res.payloadsBuilt).toBe(1); // payload construit malgré l'absence de destinataire
    expect(logs.some((m) => m.includes("sans destinataire"))).toBe(true);
  });
});

describe("REP-002 assemblage réseau (hebdo/mensuel, anonymisé 0 PII)", () => {
  it("REP-002: réseau → 1 payload agrégé anonymisé, aucun agencyId exposé", async () => {
    const col = makeEnqueueCollector();
    // Deux agences distinctes sur la fenêtre → agrégat sommé, agencyCount=2.
    const rows = [
      { ...statsRow(), agency_id: "a1" },
      { ...statsRow(), agency_id: "a2" },
    ];
    const deps: BuildReportDeps = {
      reportQuery: stubReportQuery(rows),
      recipientsQuery: stubRecipientsQuery(["reseau@banque.example"]),
      listAgencies: async () => {
        throw new Error("listAgencies ne doit PAS être appelé en portée network");
      },
      ...col.deps,
    };
    const res = await buildAndEnqueueReport(
      "WEEKLY",
      "bank-1",
      new Date("2026-07-13T07:00:00Z"),
      deps
    );
    expect(res.payloadsBuilt).toBe(1);
    const payload = res.payloads[0]!;
    expect(payload.scope).toBe("network");
    expect(payload.agencyId).toBeNull(); // aucune agence identifiée (anonymat)
    expect(payload.agencyCount).toBe(2);
    // Somme des deux agences : 200 tickets émis.
    expect(payload.totalTickets).toBe(200);
    expect(res.emailsEnqueued).toBe(1);
    expect(col.enqueued[0]!.enqueue.emailType).toBe("WEEKLY_REPORT");
    // Le payload réseau ne porte AUCUN champ d'agence individuel.
    expect(JSON.stringify(payload)).not.toContain("a1");
    expect(JSON.stringify(payload)).not.toContain("a2");
  });

  it("REP-002: mensuel → periodKey mois précédent, email MONTHLY_REPORT", async () => {
    const col = makeEnqueueCollector();
    const deps: BuildReportDeps = {
      reportQuery: stubReportQuery([{ ...statsRow(), agency_id: "a1" }]),
      recipientsQuery: stubRecipientsQuery(["comex@banque.example"]),
      listAgencies: async () => [],
      ...col.deps,
    };
    const res = await buildAndEnqueueReport(
      "MONTHLY",
      "bank-1",
      new Date("2026-08-01T07:00:00Z"),
      deps
    );
    expect(res.periodKey).toBe("2026-07");
    expect(col.enqueued[0]!.enqueue.emailType).toBe("MONTHLY_REPORT");
    expect(col.enqueued[0]!.enqueue.dedupeKey).toBe(
      "report:bank-1:MONTHLY:2026-07:comex@banque.example"
    );
  });
});

describe("REP-002b: branchement du gabarit PDF riche dans l'assemblage", () => {
  it("REP-002b: sans attachReportPdf, aucune pièce jointe PDF passée (rétro-compatibilité)", async () => {
    const col = makeEnqueueCollector();
    const deps: BuildReportDeps = {
      reportQuery: stubReportQuery([statsRow()]),
      recipientsQuery: stubRecipientsQuery(["dir@banque.example"]),
      listAgencies: async () => ["agency-1"],
      ...col.deps,
    };
    await buildAndEnqueueReport(
      "DAILY",
      "bank-1",
      new Date("2026-07-13T18:00:00Z"),
      deps
    );
    expect(col.enqueued[0]!.pdf).toBeUndefined();
  });

  it("REP-002b: attachReportPdf → pièce jointe PDF A4 attachée (filename déterministe)", async () => {
    const col = makeEnqueueCollector();
    const deps: BuildReportDeps = {
      reportQuery: stubReportQuery([statsRow()]),
      recipientsQuery: stubRecipientsQuery(["dir@banque.example"]),
      listAgencies: async () => ["agency-1"],
      attachReportPdf: true,
      ...col.deps,
    };
    await buildAndEnqueueReport(
      "DAILY",
      "bank-1",
      new Date("2026-07-13T18:00:00Z"),
      deps
    );
    const pdf = col.enqueued[0]!.pdf;
    expect(pdf).toBeDefined();
    expect(pdf!.filename).toBe("report-daily-2026-07-13.pdf");
    expect(pdf!.contentType).toBe("application/pdf");
    expect(pdf!.sizeBytes).toBeGreaterThan(0);
    // Le contenu base64 décode bien vers un PDF valide.
    expect(Buffer.from(pdf!.contentBase64, "base64").subarray(0, 5).toString()).toBe(
      "%PDF-"
    );
  });

  it("REP-002b: même PDF pour tous les destinataires d'un même payload (rendu 1 fois)", async () => {
    const col = makeEnqueueCollector();
    const deps: BuildReportDeps = {
      reportQuery: stubReportQuery([statsRow()]),
      recipientsQuery: stubRecipientsQuery(["a@banque.example", "b@banque.example"]),
      listAgencies: async () => ["agency-1"],
      attachReportPdf: true,
      ...col.deps,
    };
    await buildAndEnqueueReport(
      "DAILY",
      "bank-1",
      new Date("2026-07-13T18:00:00Z"),
      deps
    );
    expect(col.enqueued).toHaveLength(2);
    expect(col.enqueued[0]!.pdf!.contentBase64).toBe(
      col.enqueued[1]!.pdf!.contentBase64
    );
  });

  it("REP-002b: resolveReportBrand appliqué au theming du PDF (couleur/logo tenant)", async () => {
    const col = makeEnqueueCollector();
    const brandCalls: string[] = [];
    const deps: BuildReportDeps = {
      reportQuery: stubReportQuery([statsRow()]),
      recipientsQuery: stubRecipientsQuery(["dir@banque.example"]),
      listAgencies: async () => ["agency-1"],
      attachReportPdf: true,
      resolveReportBrand: (bankId) => {
        brandCalls.push(bankId);
        return { brandColor: "#0F766E", bankName: "Banque Atlantique" };
      },
      ...col.deps,
    };
    await buildAndEnqueueReport(
      "DAILY",
      "bank-1",
      new Date("2026-07-13T18:00:00Z"),
      deps
    );
    expect(brandCalls).toEqual(["bank-1"]);
    expect(col.enqueued[0]!.pdf).toBeDefined();
  });
});
