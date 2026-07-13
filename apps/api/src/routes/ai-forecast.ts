/**
 * IA-002 — Routeur `GET /ai/forecast` (CONTRACT-008).
 *
 * Projette le forecast d'affluence horaire d'une agence pour une date sous la forme
 * contractuelle `ForecastResponse` (`{ agencyId, date, contextualFactors, forecast[],
 * meta }`) où chaque `forecast[]` porte `drivers[]` (explicabilité) et `lowConfidence`
 * (additifs CONTRACT-013 / IA-002).
 *
 * ## Runtime GATED sur données réelles
 * La prédiction n'a de valeur qu'avec ≥ 90 j d'historique réel (seuil CONTRACT-008).
 * La SOURCE de features (`ForecastDataProvider`) est INJECTÉE :
 *  - en production, aucune table `ai_features` n'est encore matérialisée (zone DB
 *    parallèle hors périmètre IA-001/002) → le provider par défaut renvoie
 *    `availableDays = 0` ⇒ **422 INSUFFICIENT_HISTORY** (comportement gated attendu) ;
 *  - en test/backtest, un provider synthétique fournit des features → 200 avec la
 *    série prédite (le moteur `forecast-model` est mergeable et testable MAINTENANT).
 *
 * Le seuil de suffisance réutilise TEL QUEL le verdict d'IA-001
 * (`computeAgencyHistoryStatus` / `insufficientHistoryDetails`).
 *
 * RBAC/tenant assurés en amont par le middleware global (AGENCY_DIRECTOR min., scope
 * agency — `rbac-route-map`). Ce routeur ajoute la garde de scope agence explicite.
 *
 * @module
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { SigfaError } from "src/lib/errors.js";
import { errorResponse, requireBankId, assertAgencyScope, UUID_RE } from "src/lib/admin-helpers.js";
import type { TenantContext } from "src/middleware/tenant.js";
import type { FeatureRecord } from "src/ai/feature-engine.js";
import { HISTORY_THRESHOLD_DAYS, FEATURE_SET_VERSION } from "src/ai/feature-engine.js";
import {
  computeAgencyHistoryStatus,
  insufficientHistoryDetails,
} from "src/ai/history-window.js";
import {
  forecastAgencyDay,
  FORECAST_MODEL_VERSION,
  type AgencyForecast,
} from "src/ai/forecast-model.js";

/** Variables de contexte Hono du routeur ai-forecast. */
interface AiForecastEnv {
  Variables: {
    tenant: TenantContext;
  };
}

/** Regex jour civil `YYYY-MM-DD`. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fenêtre d'historique + features d'une agence, telles que lues par le routeur.
 *
 * `records` = features IA-001 de la banque pour l'agence (au moins celles de la date
 * cible pour la projection ; toutes celles présentes pour le compte de jours).
 */
export interface ForecastData {
  /** Features IA-001 du tenant pour l'agence (un `FeatureRecord` par bucket/jour). */
  readonly records: readonly FeatureRecord[];
}

/**
 * Source de features du forecast (injectée). En production, elle interroge la
 * matérialisation IA-001 sous `withTenant(bankId)` ; par défaut (aucune table encore
 * matérialisée) elle ne renvoie aucun record → 422 INSUFFICIENT_HISTORY (gated).
 */
export type ForecastDataProvider = (input: {
  readonly bankId: string;
  readonly agencyId: string;
  readonly date: string;
}) => Promise<ForecastData>;

/**
 * Provider par défaut : aucune matérialisation `ai_features` disponible → aucun
 * record. Conséquence : `availableDays = 0` ⇒ 422 INSUFFICIENT_HISTORY. C'est le
 * comportement GATED attendu tant que l'historique pilote réel n'existe pas.
 */
export const emptyForecastDataProvider: ForecastDataProvider = async () => ({
  records: [],
});

/** Dépendances du routeur ai-forecast (source de features injectable). */
export interface AiForecastRouterDeps {
  /** Source de features (défaut : `emptyForecastDataProvider` → 422 gated). */
  readonly provider?: ForecastDataProvider;
}

/** Lit et valide les paramètres `agencyId` (UUID) et `date` (YYYY-MM-DD). */
function readQuery(c: Context): { agencyId: string; date: string } {
  const agencyId = c.req.query("agencyId") ?? "";
  const date = c.req.query("date") ?? "";
  if (!UUID_RE.test(agencyId)) {
    throw new SigfaError("BAD_REQUEST", "Paramètre agencyId invalide (UUID attendu).", 400, {
      field: "agencyId",
    });
  }
  if (!DATE_RE.test(date)) {
    throw new SigfaError("BAD_REQUEST", "Paramètre date invalide (YYYY-MM-DD attendu).", 400, {
      field: "date",
    });
  }
  return { agencyId, date };
}

/** Calcule la fenêtre de données `AiMeta.dataWindow` (ISO 8601 interval) des records. */
function dataWindow(records: readonly FeatureRecord[]): string {
  if (records.length === 0) return "";
  let min = records[0]!.date;
  let max = records[0]!.date;
  for (const r of records) {
    if (r.date < min) min = r.date;
    if (r.date > max) max = r.date;
  }
  return `${min}/${max}`;
}

/** Projette le forecast interne vers la forme contractuelle `ForecastResponse`. */
function toForecastResponse(
  fc: AgencyForecast,
  records: readonly FeatureRecord[],
  availableDays: number,
  now: Date
): Record<string, unknown> {
  return {
    agencyId: fc.agencyId,
    date: fc.date,
    contextualFactors: fc.contextualFactors,
    forecast: fc.forecast.map((h) => ({
      hour: h.hour,
      expectedTickets: h.expectedTickets,
      confidence: h.confidence,
      drivers: h.drivers,
      lowConfidence: h.lowConfidence,
    })),
    meta: {
      modelVersion: FORECAST_MODEL_VERSION,
      computedAt: now.toISOString(),
      dataWindow: dataWindow(records),
      featureSetVersion: FEATURE_SET_VERSION,
      availableDays,
    },
  };
}

/**
 * Crée le routeur `GET /ai/forecast`.
 *
 * @param deps - Dépendances (source de features ; défaut → 422 gated)
 */
export function createAiForecastRouter(deps: AiForecastRouterDeps = {}): Hono<AiForecastEnv> {
  const provider = deps.provider ?? emptyForecastDataProvider;
  const router = new Hono<AiForecastEnv>();

  router.get("/ai/forecast", async (c) => {
    const tenant = c.get("tenant");
    try {
      const bankId = requireBankId(tenant);
      const { agencyId, date } = readQuery(c);
      assertAgencyScope(tenant, agencyId);

      const { records } = await provider({ bankId, agencyId, date });

      // Verdict d'historique IA-001 réutilisé TEL QUEL (seuil 90 j CONTRACT-008).
      const statusByAgency = computeAgencyHistoryStatus(records, HISTORY_THRESHOLD_DAYS);
      const status = statusByAgency.get(agencyId) ?? {
        agencyId,
        availableDays: 0,
        requiredDays: HISTORY_THRESHOLD_DAYS,
        sufficient: false,
      };
      const insufficient = insufficientHistoryDetails(status);
      if (insufficient) {
        throw new SigfaError(
          "INSUFFICIENT_HISTORY",
          "Historique insuffisant pour calculer les prédictions. Minimum requis : 90 jours de tickets fermés.",
          422,
          { requiredDays: insufficient.requiredDays, availableDays: insufficient.availableDays }
        );
      }

      const fc = forecastAgencyDay(agencyId, date, records);
      const body = toForecastResponse(fc, records, status.availableDays, new Date());
      return c.json(body, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  return router;
}
