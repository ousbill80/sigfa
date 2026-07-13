/**
 * IA-004 — Service d'insights feedbacks : extraction tenant → NLP → projection.
 *
 * Couture DB → moteurs PURS. Lit **uniquement** les feedbacks SIGFA du tenant
 * (API-010 : `tickets.feedback_score` + `feedback_comment`), isolés par `bank_id`
 * (et `agency_id` en scope agence), rédige la PII, analyse en NLP, agrège le score
 * qualité, puis projette la forme contractuelle `FeedbackInsightsResponse`
 * (CONTRACT-008).
 *
 * ## Anti-PII (CRITIQUE)
 * La rédaction PII est appliquée AVANT toute analyse ; **aucun verbatim brut** ne
 * quitte ce service. La réponse ne contient que des agrégats (sentiments, thèmes
 * de l'enum fermé, scores) — jamais de commentaire en clair.
 *
 * ## Zéro appel réseau tiers
 * Toute l'analyse est en mémoire via `feedback-nlp.ts` (modèle intra-infra). Ce
 * service ne fait qu'une requête SQL paramétrée sur la base du tenant.
 *
 * ## Isolation tenant STRICTE
 * Chaque requête filtre `bank_id = $1`. Le service NE lit jamais hors du `bankId`.
 *
 * ## Aucune décision automatique
 * Lecture seule : aucune mutation, aucune action RH/opérationnelle émise.
 *
 * @module
 */

import type { QueryFn } from "src/reporting/aggregate-service.js";
import { ABIDJAN_TZ } from "src/reporting/sla-engine.js";
import { analyzeComment, type FeedbackLanguage } from "src/ai/feedback-nlp.js";
import {
  computeQualityScore,
  computeSentimentBreakdown,
  computeRecurrentThemes,
  analyzableFeedbacks,
  MIN_SAMPLE_SIZE,
  QUALITY_SCALE,
  type AnalyzedFeedback,
} from "src/ai/quality-scoring.js";

/** Version du modèle NLP (AiMeta.modelVersion). */
export const NLP_MODEL_VERSION = "nlp-v1.0.0";

/** Nombre maximum de thèmes récurrents exposés. */
const TOP_THEMES = 5;

/** Ligne brute de feedback lue en base. */
interface FeedbackRow {
  readonly feedback_score: number | null;
  readonly feedback_comment: string | null;
}

/** Bornes de période + scope pour l'extraction. */
export interface InsightsQuery {
  /** Tenant — isolation stricte. */
  readonly bankId: string;
  /** Scope d'analyse. */
  readonly scope: "agency" | "bank";
  /** Agence ciblée (requis si scope=agency). */
  readonly agencyId?: string;
  /** Jour civil Abidjan de début (inclus). */
  readonly dayStart: string;
  /** Jour civil Abidjan de fin (inclus). */
  readonly dayEnd: string;
  /** Clé de période normalisée (pour la réponse). */
  readonly periodKey: string;
  /** Horloge (pour computedAt) — injectée pour déterminisme des tests. */
  readonly now: Date;
}

/**
 * Extrait les feedbacks bruts de la fenêtre pour un tenant (et une agence si scope
 * agence). Ne sélectionne QUE la note et le commentaire — aucune colonne PII
 * (phone/nom/tracking) n'est lue. `withTenant(bankId)` est ouvert par l'appelant.
 *
 * @param query - Requête paramétrée (connexion tenant).
 * @param q     - Bornes + scope + tenant.
 * @returns Lignes brutes de feedback (note + commentaire).
 */
export async function extractFeedbackRows(
  query: QueryFn,
  q: InsightsQuery
): Promise<FeedbackRow[]> {
  const params: unknown[] = [q.bankId, q.dayStart, q.dayEnd];
  let agencyFilter = "";
  if (q.scope === "agency") {
    if (!q.agencyId) {
      throw new Error("extractFeedbackRows: agencyId requis en scope agency");
    }
    params.push(q.agencyId);
    agencyFilter = "AND t.agency_id = $4";
  }
  const res = await query(
    `
    SELECT t.feedback_score, t.feedback_comment
      FROM tickets t
     WHERE t.bank_id = $1
       ${agencyFilter}
       AND t.feedback_at IS NOT NULL
       AND (t.feedback_at AT TIME ZONE '${ABIDJAN_TZ}')::date >= $2::date
       AND (t.feedback_at AT TIME ZONE '${ABIDJAN_TZ}')::date <= $3::date
    `,
    params
  );
  return res.rows.map((row) => ({
    feedback_score:
      row["feedback_score"] === null || row["feedback_score"] === undefined
        ? null
        : Number(row["feedback_score"]),
    feedback_comment:
      row["feedback_comment"] === null || row["feedback_comment"] === undefined
        ? null
        : String(row["feedback_comment"]),
  }));
}

/**
 * Analyse un lot de lignes de feedback : rédaction PII + NLP par commentaire.
 * Les lignes sans commentaire conservent leur note (contribution structurée),
 * avec une analyse NLP neutre non exclue.
 *
 * @param rows - Lignes brutes de feedback.
 * @returns Feedbacks analysés (PII déjà masquée dans l'analyse).
 */
export function analyzeFeedbackRows(rows: readonly FeedbackRow[]): AnalyzedFeedback[] {
  return rows.map((row): AnalyzedFeedback => {
    if (row.feedback_comment === null || row.feedback_comment.trim().length === 0) {
      // Note seule : sentiment neutre, non exclue (compte dans l'échantillon).
      return {
        rating: row.feedback_score,
        analysis: {
          language: "fr",
          sentiment: "neutral",
          sentimentScore: 0,
          themes: [],
          excluded: false,
        },
      };
    }
    return {
      rating: row.feedback_score,
      analysis: analyzeComment(row.feedback_comment),
    };
  });
}

/** Détermine la langue dominante d'un lot (fr/en/unsupported). */
export function dominantLanguage(feedbacks: readonly AnalyzedFeedback[]): FeedbackLanguage {
  const counts: Record<FeedbackLanguage, number> = { fr: 0, en: 0, unsupported: 0 };
  for (const f of feedbacks) counts[f.analysis.language] += 1;
  if (counts.fr === 0 && counts.en === 0) return "unsupported";
  return counts.fr >= counts.en ? "fr" : "en";
}

/**
 * Construit la réponse `FeedbackInsightsResponse` à partir des feedbacks analysés.
 * Projette la forme contractuelle CONTRACT-008 (zéro PII, thèmes enum fermé,
 * `insufficientSample`, `language`). Le `qualityScore` est décomposé (explicabilité).
 *
 * @param feedbacks - Feedbacks analysés du scope.
 * @param q          - Bornes + scope + tenant.
 * @returns Objet réponse conforme au contrat (lecture seule).
 */
export function buildInsightsResponse(
  feedbacks: readonly AnalyzedFeedback[],
  q: InsightsQuery
): Record<string, unknown> {
  const usable = analyzableFeedbacks(feedbacks);
  const quality = computeQualityScore(feedbacks);
  const breakdown = computeSentimentBreakdown(feedbacks);
  const recurrent = computeRecurrentThemes(feedbacks, TOP_THEMES);
  const language = dominantLanguage(feedbacks);

  const qualityScore: Record<string, unknown> = {
    score: quality.score ?? 0,
    scale: QUALITY_SCALE,
    components: quality.components.map((c) => ({ key: c.key, value: c.value })),
    insufficientSample: quality.insufficientSample,
  };
  if (q.scope === "agency" && q.agencyId) qualityScore["agencyId"] = q.agencyId;

  const response: Record<string, unknown> = {
    scope: q.scope,
    period: q.periodKey,
    feedbackCount: usable.length,
    sentimentBreakdown: breakdown,
    recurrentThemes: recurrent.map((t) => ({
      theme: t.theme,
      frequency: t.frequency,
      sentiment: t.sentiment,
    })),
    qualityScores: { agency: qualityScore },
    themes: Array.from(new Set(recurrent.map((t) => t.theme))),
    language,
    insufficientSample: quality.insufficientSample,
    meta: {
      modelVersion: NLP_MODEL_VERSION,
      computedAt: q.now.toISOString(),
      dataWindow: `${q.dayStart}/${q.dayEnd}`,
    },
  };
  if (q.scope === "agency" && q.agencyId) response["agencyId"] = q.agencyId;
  return response;
}

/**
 * Orchestration complète : extraction tenant → NLP → projection contractuelle.
 *
 * @param query - Requête paramétrée (connexion tenant).
 * @param q     - Bornes + scope + tenant.
 * @returns Réponse `FeedbackInsightsResponse` (zéro PII).
 */
export async function computeFeedbackInsights(
  query: QueryFn,
  q: InsightsQuery
): Promise<Record<string, unknown>> {
  const rows = await extractFeedbackRows(query, q);
  const feedbacks = analyzeFeedbackRows(rows);
  return buildInsightsResponse(feedbacks, q);
}

/** Seuil de publication exposé pour les tests d'intégration. */
export const PUBLICATION_THRESHOLD = MIN_SAMPLE_SIZE;
