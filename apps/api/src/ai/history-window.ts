/**
 * IA-001 — Fenêtre d'historique & seuil `INSUFFICIENT_HISTORY` (fonctions PURES).
 *
 * Expose, PAR AGENCE, `availableDays` (nb de jours civils distincts observés) et le
 * verdict de suffisance d'historique, réutilisé TEL QUEL par les endpoints IA pour
 * renvoyer `422 INSUFFICIENT_HISTORY` (CONTRACT-008, `details: { requiredDays,
 * availableDays }`). Le pipeline n'invente JAMAIS d'historique : il compte les
 * jours réellement présents.
 *
 * @module
 */

import { HISTORY_THRESHOLD_DAYS, type FeatureRecord } from "src/ai/feature-engine.js";

/** Statut d'historique d'une agence vis-à-vis du seuil 90 j (CONTRACT-008). */
export interface AgencyHistoryStatus {
  /** Agence. */
  readonly agencyId: string;
  /** Nb de jours civils distincts observés. */
  readonly availableDays: number;
  /** Seuil requis (90 j par défaut). */
  readonly requiredDays: number;
  /** `true` si `availableDays >= requiredDays`. */
  readonly sufficient: boolean;
}

/**
 * Détails d'erreur `INSUFFICIENT_HISTORY` (forme CONTRACT-008 `details`).
 * `null` si l'historique est suffisant.
 */
export interface InsufficientHistoryDetails {
  readonly requiredDays: number;
  readonly availableDays: number;
}

/**
 * Calcule le statut d'historique par agence à partir d'un feature-set matérialisé.
 *
 * @param records      - Features (un tenant) — les jours distincts sont comptés par agence
 * @param requiredDays - Seuil (défaut 90 j, CONTRACT-008)
 * @returns Map agencyId → statut
 */
export function computeAgencyHistoryStatus(
  records: readonly FeatureRecord[],
  requiredDays: number = HISTORY_THRESHOLD_DAYS
): Map<string, AgencyHistoryStatus> {
  const daysByAgency = new Map<string, Set<string>>();
  for (const r of records) {
    const set = daysByAgency.get(r.agencyId) ?? new Set<string>();
    set.add(r.date);
    daysByAgency.set(r.agencyId, set);
  }
  const out = new Map<string, AgencyHistoryStatus>();
  for (const [agencyId, days] of daysByAgency) {
    const availableDays = days.size;
    out.set(agencyId, {
      agencyId,
      availableDays,
      requiredDays,
      sufficient: availableDays >= requiredDays,
    });
  }
  return out;
}

/**
 * Retourne les `details` d'erreur `INSUFFICIENT_HISTORY` pour une agence, ou `null`
 * si l'historique est suffisant. Forme alignée CONTRACT-008.
 *
 * @param status - Statut d'historique de l'agence
 */
export function insufficientHistoryDetails(
  status: AgencyHistoryStatus
): InsufficientHistoryDetails | null {
  if (status.sufficient) return null;
  return { requiredDays: status.requiredDays, availableDays: status.availableDays };
}
