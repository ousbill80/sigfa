/**
 * IA-002 — Dérivation des recommandations de staffing (fonctions PURES).
 *
 * ## GARDE-FOU CARDINAL : ZÉRO mutation automatique
 * Ce module **propose** — il ne décide JAMAIS. Il ne fait qu'appliquer des règles
 * de capacité sur le forecast et produit une liste de recommandations **inertes**
 * (`{ time, action, counters, rationale, status: PENDING }`). Aucune fonction ici
 * n'ouvre/ferme un guichet, ne réaffecte un agent, n'émet d'événement ou de
 * notification : la sortie est une donnée pure. L'ouverture réelle reste une action
 * HUMAINE (DIRECTOR+ acquitte via `POST /ai/staffing-recommendations/:id/ack`).
 * Un test dédié vérifie l'absence de tout effet de bord (constitution §5).
 *
 * ## Garde `lowConfidence`
 * Un pic marqué `lowConfidence` (confiance < seuil) ne dérive **aucune** reco à lui
 * seul (anti-sur-réaction, EARS IA-002). On l'ignore purement.
 *
 * ## Capacité & SLA
 * On estime la capacité horaire d'un guichet (tickets/h servis) et on compare au
 * forecast : si le pic dépasse la capacité ouverte, on recommande d'OUVRIR le
 * différentiel de guichets ; en creux marqué, on recommande d'en FERMER. `rationale`
 * cite explicitement la prédiction ET l'objectif SLA (réutilise le taux SLA REP-001).
 *
 * @module
 */

import type { ForecastHour, AgencyForecast } from "src/ai/forecast-model.js";

/** Version du modèle de staffing (estampille `AiMeta.modelVersion`, CONTRACT-008). */
export const STAFFING_MODEL_VERSION = "staffing-ia002-v1" as const;

/** Action de staffing (CONTRACT-008 `StaffingAction`). */
export type StaffingAction = "OPEN_COUNTER" | "CLOSE_COUNTER" | "BREAK";

/** Statut d'acquittement (CONTRACT-008 `StaffingAckStatus`, forme API). */
export type StaffingAckStatus = "pending" | "acked";

/** Recommandation de staffing INERTE (aucune action émise). */
export interface StaffingRecommendation {
  /** Heure d'application `HH:MM`. */
  readonly time: string;
  /** Action proposée (jamais exécutée par ce moteur). */
  readonly action: StaffingAction;
  /** Nombre de guichets concernés (≥ 1). */
  readonly counters: number;
  /** Justification citant la prédiction + l'objectif SLA. */
  readonly rationale: string;
  /** Statut initial — toujours `pending` (humain dans la boucle). */
  readonly status: StaffingAckStatus;
}

/** Paramètres capacité/SLA de dérivation (tous injectables/paramétrables par tenant). */
export interface StaffingParams {
  /**
   * Tickets/heure qu'un guichet ouvert peut servir dans l'objectif SLA.
   * Défaut prudent (12/h ≈ 5 min/ticket). Paramétrable par tenant (dérivable du
   * TMT REP-001 sans changer le moteur).
   */
  readonly ticketsPerCounterPerHour: number;
  /**
   * Taux SLA cible (%) — réutilise le taux SLA de référence REP-001. Cité dans le
   * `rationale`. Défaut 80 %.
   */
  readonly slaTargetRate: number;
  /**
   * Seuil de creux (fraction de capacité d'UN guichet) sous lequel on propose une
   * fermeture. Défaut 0,4 : si le forecast < 40 % d'un guichet, on ferme 1 guichet.
   */
  readonly lowActivityFraction: number;
}

/** Paramètres de staffing par défaut (prudents, D3). */
export const DEFAULT_STAFFING_PARAMS: StaffingParams = {
  ticketsPerCounterPerHour: 12,
  slaTargetRate: 80,
  lowActivityFraction: 0.4,
};

/** Nombre de guichets requis pour absorber `expectedTickets` dans l'objectif SLA. */
function requiredCounters(expectedTickets: number, perCounter: number): number {
  if (perCounter <= 0) return 0;
  return Math.ceil(expectedTickets / perCounter);
}

/**
 * Dérive une recommandation d'un bucket, ou `null` si aucune action n'est requise
 * ou si le bucket est en faible confiance (garde anti-sur-réaction).
 *
 * @param h      - Point de forecast du bucket
 * @param params - Capacité/SLA
 */
function deriveForBucket(
  h: ForecastHour,
  params: StaffingParams
): StaffingRecommendation | null {
  // Garde lowConfidence : aucune reco dérivée d'un seul point faible.
  if (h.lowConfidence) return null;

  const perCounter = params.ticketsPerCounterPerHour;
  const need = requiredCounters(h.expectedTickets, perCounter);

  // Pic : capacité > 1 guichet requise → proposer d'OUVRIR (need - 1) guichets
  // supplémentaires au-delà du guichet de base. Aucune exécution : proposition pure.
  if (need >= 2) {
    const extra = need - 1;
    return {
      time: h.hour,
      action: "OPEN_COUNTER",
      counters: extra,
      rationale:
        `Pic prévu à ${h.hour} : ${h.expectedTickets} tickets attendus ` +
        `(confiance ${(h.confidence * 100).toFixed(0)} %). Ouvrir ${extra} guichet(s) ` +
        `pour tenir l'objectif SLA de ${params.slaTargetRate} %.`,
      status: "pending",
    };
  }

  // Creux marqué : forecast sous une fraction d'un guichet → proposer une FERMETURE.
  if (h.expectedTickets <= perCounter * params.lowActivityFraction) {
    return {
      time: h.hour,
      action: "CLOSE_COUNTER",
      counters: 1,
      rationale:
        `Creux prévu à ${h.hour} : ${h.expectedTickets} tickets attendus ` +
        `(confiance ${(h.confidence * 100).toFixed(0)} %). Fermer 1 guichet ` +
        `sans risque pour l'objectif SLA de ${params.slaTargetRate} %.`,
      status: "pending",
    };
  }

  return null;
}

/**
 * Dérive la liste des recommandations de staffing d'un forecast d'agence.
 *
 * Fonction PURE et SANS effet de bord : ne retourne que des données inertes en
 * statut `pending`. AUCUNE mutation opérationnelle n'est émise (garde-fou cardinal).
 *
 * @param forecast - Forecast d'agence (issu de `forecastAgencyDay`)
 * @param params   - Capacité/SLA (défaut prudents)
 * @returns Recommandations triées par heure croissante
 */
export function deriveStaffingRecommendations(
  forecast: AgencyForecast,
  params: StaffingParams = DEFAULT_STAFFING_PARAMS
): StaffingRecommendation[] {
  const recs: StaffingRecommendation[] = [];
  for (const h of forecast.forecast) {
    const rec = deriveForBucket(h, params);
    if (rec !== null) recs.push(rec);
  }
  return recs;
}
