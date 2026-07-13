/**
 * observability/alert-dedup — dédup / anti-flapping des alertes infra (NET-003).
 *
 * LA LOI (NET-003, risque R7 ; `_arbitrage-f6-f11.md` D3) :
 *  - Regroupement / dédup sur fenêtre 10 min (défaut) : une même condition
 *    soutenue ne génère PAS une alerte par échantillon.
 *  - Pas de RÉÉMISSION avant RÉSOLUTION : tant que la condition dure, une seule
 *    alerte active par (règle) ; la réémission n'est possible qu'après un cycle
 *    de résolution.
 *  - Routage par sévérité conservé (WARNING → ops, CRITICAL → astreinte).
 *
 * Logique PURE et déterministe : l'état des alertes actives est passé et retourné
 * (aucune I/O). Testable sans Redis — pas de tempête d'alertes prouvable.
 *
 * @module
 */

import { DEFAULT_DEDUP_WINDOW_S } from "src/config/observability.js";
import type {
  AlertRuleId,
  AlertSeverity,
  CandidateAlert,
} from "src/observability/alert-rules.js";

/** État d'une alerte actuellement « active » (déjà émise, non résolue). */
export interface ActiveAlert {
  /** Règle concernée. */
  ruleId: AlertRuleId;
  /** Sévérité émise. */
  severity: AlertSeverity;
  /** Destinataire routé. */
  recipient: string;
  /** Instant de la DERNIÈRE émission (epoch ms). */
  lastEmittedAt: number;
}

/** Une alerte effectivement émise après dédup (à router vers le destinataire). */
export interface EmittedAlert {
  /** Règle concernée. */
  ruleId: AlertRuleId;
  /** Sévérité émise. */
  severity: AlertSeverity;
  /** Destinataire routé (par sévérité). */
  recipient: string;
  /** Instant d'émission (epoch ms). */
  at: number;
}

/** Résultat d'une passe de dédup : alertes émises + nouvel état actif. */
export interface DedupResult {
  /** Alertes réellement émises pendant cette passe (jamais une tempête). */
  emitted: readonly EmittedAlert[];
  /** Nouvel état des alertes actives (à repasser au tour suivant). */
  active: readonly ActiveAlert[];
}

/**
 * Applique la dédup / anti-flapping à un lot d'alertes candidates.
 *
 * Règles :
 *  - Une candidate dont la règle est DÉJÀ active dans la fenêtre de dédup est
 *    SUPPRIMÉE (pas de réémission avant résolution) — mais son `lastEmittedAt`
 *    est conservé (la condition dure toujours).
 *  - Une candidate dont la règle n'est PAS active (ou dont l'alerte active a
 *    expiré la fenêtre de dédup) est ÉMISE et devient/redevient active.
 *  - Une règle active SANS candidate cette passe est considérée RÉSOLUE et
 *    retirée de l'état actif (une future occurrence pourra réémettre).
 *
 * @param candidates - Alertes candidates de cette passe (cf. `evaluateAlertRules`)
 * @param active     - État des alertes actives issues des passes précédentes
 * @param nowMs      - Instant courant (epoch ms)
 * @param dedupWindowS - Fenêtre de dédup (secondes ; défaut 10 min)
 * @returns Alertes émises + nouvel état actif
 */
export function dedupeAlerts(
  candidates: readonly CandidateAlert[],
  active: readonly ActiveAlert[],
  nowMs: number,
  dedupWindowS: number = DEFAULT_DEDUP_WINDOW_S
): DedupResult {
  const windowMs = dedupWindowS * 1000;
  const activeById = new Map<AlertRuleId, ActiveAlert>(
    active.map((a) => [a.ruleId, a])
  );
  const candidateIds = new Set(candidates.map((c) => c.ruleId));

  const emitted: EmittedAlert[] = [];
  const nextActive = new Map<AlertRuleId, ActiveAlert>();

  for (const candidate of candidates) {
    const existing = activeById.get(candidate.ruleId);
    const withinWindow =
      existing !== undefined && nowMs - existing.lastEmittedAt < windowMs;

    if (withinWindow) {
      // Condition soutenue : pas de réémission, on conserve l'alerte active.
      nextActive.set(candidate.ruleId, existing);
      continue;
    }

    // Nouvelle occurrence (ou fenêtre de dédup expirée) → émission.
    emitted.push({
      ruleId: candidate.ruleId,
      severity: candidate.severity,
      recipient: candidate.recipient,
      at: candidate.at,
    });
    nextActive.set(candidate.ruleId, {
      ruleId: candidate.ruleId,
      severity: candidate.severity,
      recipient: candidate.recipient,
      lastEmittedAt: candidate.at,
    });
  }

  // Les règles actives SANS candidate cette passe sont résolues (retirées) :
  // elles ne figurent pas dans `nextActive`, donc une future occurrence réémet.
  // (Rien à faire : on n'a copié que les règles vues cette passe.)
  void candidateIds;

  return {
    emitted,
    active: [...nextActive.values()],
  };
}
