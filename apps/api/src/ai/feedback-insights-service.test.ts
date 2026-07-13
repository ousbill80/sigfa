/**
 * IA-004 — Tests du service d'insights (extraction tenant, projection, zéro egress).
 *
 * Couvre les critères ⊛ : isolation tenant (bank_id/agency_id dans la requête,
 * jamais de fuite cross-bank) ; par défaut aucun appel réseau sortant (QueryFn
 * locale, aucun fetch) ; projection contractuelle (themes enum, insufficientSample,
 * language, zéro PII/verbatim en clair) ; agrégation de bout en bout.
 *
 * Nommage strict : `IA-004: <description>`.
 *
 * @module
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { QueryFn } from "src/reporting/aggregate-service.js";
import {
  extractFeedbackRows,
  analyzeFeedbackRows,
  buildInsightsResponse,
  computeFeedbackInsights,
  dominantLanguage,
  NLP_MODEL_VERSION,
  type InsightsQuery,
} from "src/ai/feedback-insights-service.js";
import { MIN_SAMPLE_SIZE } from "src/ai/quality-scoring.js";
import { FEEDBACK_THEMES } from "src/ai/feedback-nlp.js";
import { containsPii } from "src/ai/pii-redaction.js";

const BANK_A = "11111111-1111-4111-8111-111111111111";
const BANK_B = "22222222-2222-4222-8222-222222222222";
const AGENCY_A = "aaaaaaaa-1111-4111-8111-111111111111";
const NOW = new Date("2026-07-15T06:00:00Z");

/** Capture les requêtes émises (SQL + params) et renvoie des lignes injectées. */
function captureQuery(rows: Array<Record<string, unknown>>): {
  fn: QueryFn;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const fn: QueryFn = (sql, params) => {
    calls.push({ sql, params: (params ?? []) as unknown[] });
    return Promise.resolve({ rows });
  };
  return { fn, calls };
}

function agencyQuery(overrides: Partial<InsightsQuery> = {}): InsightsQuery {
  return {
    bankId: BANK_A,
    scope: "agency",
    agencyId: AGENCY_A,
    dayStart: "2026-07-01",
    dayEnd: "2026-07-31",
    periodKey: "2026-07",
    now: NOW,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("feedback-insights-service — isolation tenant", () => {
  it("IA-004: la requête filtre bank_id ET agency_id en scope agence", async () => {
    const { fn, calls } = captureQuery([]);
    await extractFeedbackRows(fn, agencyQuery());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain("t.bank_id = $1");
    expect(calls[0]!.sql).toContain("t.agency_id = $4");
    expect(calls[0]!.params[0]).toBe(BANK_A);
    expect(calls[0]!.params[3]).toBe(AGENCY_A);
  });

  it("IA-004: scope bank filtre bank_id seul (pas d'agency_id)", async () => {
    const { fn, calls } = captureQuery([]);
    await extractFeedbackRows(fn, agencyQuery({ scope: "bank", agencyId: undefined }));
    expect(calls[0]!.sql).toContain("t.bank_id = $1");
    expect(calls[0]!.sql).not.toContain("agency_id = $4");
    expect(calls[0]!.params).toEqual([BANK_A, "2026-07-01", "2026-07-31"]);
  });

  it("IA-004: bank_id est TOUJOURS le 1er paramètre (jamais cross-bank)", async () => {
    const { fn, calls } = captureQuery([]);
    await extractFeedbackRows(fn, agencyQuery({ bankId: BANK_B }));
    expect(calls[0]!.params[0]).toBe(BANK_B);
    // Aucun autre bankId n'apparaît dans les params.
    expect(calls[0]!.params).not.toContain(BANK_A);
  });

  it("IA-004: scope agence sans agencyId → throw (jamais de requête non scopée)", async () => {
    const { fn } = captureQuery([]);
    await expect(
      extractFeedbackRows(fn, agencyQuery({ agencyId: undefined }))
    ).rejects.toThrow(/agencyId requis/);
  });
});

describe("feedback-insights-service — zéro appel réseau tiers", () => {
  it("IA-004: aucun fetch() n'est appelé par défaut (modèle intra-infra)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { fn } = captureQuery([
      { feedback_score: 5, feedback_comment: "service excellent et rapide" },
      { feedback_score: 2, feedback_comment: "attente trop longue" },
    ]);
    await computeFeedbackInsights(fn, agencyQuery());
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("feedback-insights-service — projection contractuelle", () => {
  it("IA-004: analyse rows (note seule vs note+commentaire)", () => {
    const analyzed = analyzeFeedbackRows([
      { feedback_score: 5, feedback_comment: null },
      { feedback_score: 1, feedback_comment: "personnel impoli, attente horrible" },
    ]);
    expect(analyzed[0]!.analysis.excluded).toBe(false);
    expect(analyzed[0]!.rating).toBe(5);
    expect(analyzed[1]!.analysis.sentiment).toBe("negative");
    expect(analyzed[1]!.analysis.themes).toContain("STAFF_ATTITUDE");
  });

  it("IA-004: réponse conforme — scope/period/meta/themes enum/insufficientSample", () => {
    const analyzed = analyzeFeedbackRows(
      Array.from({ length: MIN_SAMPLE_SIZE }, () => ({
        feedback_score: 4,
        feedback_comment: "service rapide et accueil aimable",
      }))
    );
    const res = buildInsightsResponse(analyzed, agencyQuery());
    expect(res["scope"]).toBe("agency");
    expect(res["period"]).toBe("2026-07");
    expect(res["agencyId"]).toBe(AGENCY_A);
    expect(res["insufficientSample"]).toBe(false);
    expect((res["meta"] as Record<string, unknown>)["modelVersion"]).toBe(NLP_MODEL_VERSION);
    // themes ⊂ enum fermé
    for (const t of res["themes"] as string[]) {
      expect(FEEDBACK_THEMES).toContain(t);
    }
    // qualityScores.agency décomposé
    const q = (res["qualityScores"] as Record<string, Record<string, unknown>>)["agency"]!;
    expect(Array.isArray(q["components"])).toBe(true);
    expect(q["insufficientSample"]).toBe(false);
  });

  it("IA-004: sous le seuil → insufficientSample:true, score masqué (0)", () => {
    const analyzed = analyzeFeedbackRows([
      { feedback_score: 4, feedback_comment: "bien" },
    ]);
    const res = buildInsightsResponse(analyzed, agencyQuery());
    expect(res["insufficientSample"]).toBe(true);
    const q = (res["qualityScores"] as Record<string, Record<string, unknown>>)["agency"]!;
    expect(q["score"]).toBe(0);
    expect(q["insufficientSample"]).toBe(true);
  });

  it("IA-004: verbatims PII ne fuitent JAMAIS dans la réponse (contenu issu des commentaires)", () => {
    const analyzed = analyzeFeedbackRows([
      { feedback_score: 1, feedback_comment: "M. Traoré +225 07 07 07 07 07 service lent" },
    ]);
    const res = buildInsightsResponse(analyzed, agencyQuery());
    // La réponse expose légitimement le scope agencyId (identifiant fourni par
    // l'appelant, non issu d'un verbatim). On vérifie que le CONTENU dérivé des
    // commentaires (thèmes, sentiments, verbatims) ne contient AUCUNE PII ni
    // fragment de verbatim brut.
    const derived = JSON.stringify({
      sentimentBreakdown: res["sentimentBreakdown"],
      recurrentThemes: res["recurrentThemes"],
      themes: res["themes"],
      language: res["language"],
    });
    expect(containsPii(derived)).toBe(false);
    // Aucun fragment de verbatim brut (nom, numéro) n'apparaît nulle part.
    const whole = JSON.stringify(res);
    expect(whole).not.toContain("Traoré");
    expect(whole).not.toContain("07 07 07");
    expect(whole).not.toContain("service lent");
  });

  it("IA-004: langue unsupported dominante → language=unsupported, exclus du scoring", () => {
    const analyzed = analyzeFeedbackRows([
      { feedback_score: null, feedback_comment: "El servicio fue lento" },
      { feedback_score: null, feedback_comment: "Muy mala atención" },
    ]);
    const res = buildInsightsResponse(analyzed, agencyQuery());
    expect(res["language"]).toBe("unsupported");
    expect(res["feedbackCount"]).toBe(0);
  });

  it("IA-004: dominantLanguage choisit la langue majoritaire", () => {
    const analyzed = analyzeFeedbackRows([
      { feedback_score: null, feedback_comment: "service rapide et propre" },
      { feedback_score: null, feedback_comment: "accueil aimable au guichet" },
      { feedback_score: null, feedback_comment: "fast and clean service" },
    ]);
    expect(dominantLanguage(analyzed)).toBe("fr");
  });
});

describe("feedback-insights-service — orchestration bout en bout", () => {
  it("IA-004: computeFeedbackInsights agrège extraction→NLP→projection", async () => {
    const rows = Array.from({ length: MIN_SAMPLE_SIZE }, (_, i) => ({
      feedback_score: i % 2 === 0 ? 5 : 2,
      feedback_comment:
        i % 2 === 0 ? "service excellent et rapide" : "attente trop longue et lente",
    }));
    const { fn } = captureQuery(rows);
    const res = await computeFeedbackInsights(fn, agencyQuery());
    expect(res["feedbackCount"]).toBe(MIN_SAMPLE_SIZE);
    expect(res["insufficientSample"]).toBe(false);
    const breakdown = res["sentimentBreakdown"] as Record<string, number>;
    expect(breakdown["positive"]).toBeGreaterThan(0);
    expect(breakdown["negative"]).toBeGreaterThan(0);
  });
});
