/**
 * observability/alert-rules — règles d'alerte infra AS-CODE + évaluation PURE (NET-003).
 *
 * LA LOI (NET-003, EARS) :
 *  - CPU>80% / mem>85% sur fenêtre soutenue (défaut 5 min) → `WARNING` vers ops.
 *  - err>1% (5xx/req) sur fenêtre → `CRITICAL` vers astreinte.
 *  - RT p95 `ticket:called` ≥ 500ms (aligné SEC-004) → dégradation `WARNING`.
 *  - Dépendance critique down (PostgreSQL/Redis) ou `/health` 503 → `CRITICAL`
 *    IMMÉDIAT (pas d'attente de fenêtre).
 *  - Chaque règle nomme sa sévérité, sa fenêtre et son/ses destinataire(s).
 *
 * Logique d'évaluation 100% PURE (aucune I/O) : testable sur métriques SIMULÉES,
 * y compris la bascule AUX BORNES EXACTES. Le calibrage réel des seuils est GATED
 * sur le run de charge SEC-004 (cf. `_arbitrage-f6-f11.md` D11).
 *
 * @module
 */

import {
  getObservabilityConfig,
  type ObservabilityConfig,
} from "src/config/observability.js";

/** Sévérité d'une alerte infra. */
export type AlertSeverity = "WARNING" | "CRITICAL";

/** Identifiant stable d'une règle d'alerte (clé de dédup / routage). */
export type AlertRuleId =
  | "cpu-high"
  | "mem-high"
  | "error-rate-high"
  | "rt-latency-degraded"
  | "dependency-down";

/** Un échantillon de métrique daté (valeur brute + timestamp epoch ms). */
export interface MetricSample {
  /** Instant de la mesure (epoch ms). */
  at: number;
  /** Valeur mesurée (fraction pour CPU/mem/err, ms pour latence). */
  value: number;
}

/** Définition as-code d'une règle d'alerte (métadonnées de routage). */
export interface AlertRuleDefinition {
  /** Identifiant stable de la règle. */
  id: AlertRuleId;
  /** Sévérité émise si la règle se déclenche. */
  severity: AlertSeverity;
  /** Destinataire nommé (placeholder résolu depuis la config). */
  recipient: string;
  /** Fenêtre soutenue requise (secondes) ; 0 = immédiat (pas de fenêtre). */
  windowS: number;
  /** Seuil numérique (fraction ou ms selon la métrique). */
  threshold: number;
  /** Libellé lisible (dashboards / runbook). */
  label: string;
}

/**
 * Construit les définitions de règles as-code à partir de la config résolue.
 * Chaque règle NOMME explicitement sa sévérité, sa fenêtre et son destinataire
 * (LA LOI NET-003 : routage par sévérité, fenêtre et destinataire par règle).
 *
 * @param config - Config d'observabilité (défaut : env-injectable résolu)
 * @returns Les 5 règles d'alerte infra as-code
 */
export function buildAlertRules(
  config: ObservabilityConfig = getObservabilityConfig()
): readonly AlertRuleDefinition[] {
  const { thresholds, recipients } = config;
  return [
    {
      id: "cpu-high",
      severity: "WARNING",
      recipient: recipients.ops,
      windowS: thresholds.windowS,
      threshold: thresholds.cpuThreshold,
      label: "CPU > 80% (fenêtre soutenue)",
    },
    {
      id: "mem-high",
      severity: "WARNING",
      recipient: recipients.ops,
      windowS: thresholds.windowS,
      threshold: thresholds.memThreshold,
      label: "Mémoire > 85% (fenêtre soutenue)",
    },
    {
      id: "error-rate-high",
      severity: "CRITICAL",
      recipient: recipients.onCall,
      windowS: thresholds.windowS,
      threshold: thresholds.errorRateThreshold,
      label: "Taux d'erreur 5xx > 1% (fenêtre soutenue)",
    },
    {
      id: "rt-latency-degraded",
      severity: "WARNING",
      recipient: recipients.ops,
      windowS: thresholds.windowS,
      threshold: thresholds.rtP95SlaMs,
      label: "Latence RT ticket:called p95 ≥ 500ms (dégradation)",
    },
    {
      id: "dependency-down",
      severity: "CRITICAL",
      recipient: recipients.onCall,
      windowS: 0,
      threshold: 0,
      label: "Dépendance critique down / /health 503 (immédiat)",
    },
  ];
}

/**
 * Vrai si TOUS les échantillons de la fenêtre `[now-windowS, now]` dépassent
 * STRICTEMENT le seuil. Une condition « soutenue » exige que la fenêtre soit
 * couverte : au moins un échantillon dans la fenêtre, et aucun sous le seuil.
 *
 * Bascule AUX BORNES : la comparaison est STRICTEMENT `>` — une valeur ÉGALE au
 * seuil ne déclenche pas (80% pile ne franchit pas CPU>80%). Un échantillon plus
 * ancien que la fenêtre est ignoré (pas de sustain prouvé → pas de déclenchement).
 *
 * @param samples   - Échantillons datés (ordre quelconque)
 * @param threshold - Seuil à franchir strictement
 * @param windowS   - Largeur de fenêtre (secondes)
 * @param nowMs     - Instant courant (epoch ms)
 * @returns `true` si la fenêtre est soutenue au-dessus du seuil
 */
export function isSustainedAbove(
  samples: readonly MetricSample[],
  threshold: number,
  windowS: number,
  nowMs: number
): boolean {
  const windowStart = nowMs - windowS * 1000;
  const inWindow = samples.filter((s) => s.at >= windowStart && s.at <= nowMs);
  if (inWindow.length === 0) return false;
  return inWindow.every((s) => s.value > threshold);
}

/** État instantané des dépendances critiques (pas de fenêtre). */
export interface DependencyHealth {
  /** PostgreSQL joignable. */
  postgres: boolean;
  /** Redis joignable. */
  redis: boolean;
  /** `GET /health` renvoie 200 (false = 503 SERVICE_UNAVAILABLE). */
  healthOk: boolean;
}

/**
 * Vrai si une dépendance critique est tombée : PostgreSQL/Redis injoignable OU
 * `/health` en 503. Déclenche un CRITICAL IMMÉDIAT (aucune fenêtre — LA LOI).
 *
 * @param health - État instantané des dépendances
 * @returns `true` si une alerte immédiate doit partir
 */
export function isDependencyDown(health: DependencyHealth): boolean {
  return !health.postgres || !health.redis || !health.healthOk;
}

/** Une alerte candidate produite par l'évaluation d'une règle. */
export interface CandidateAlert {
  /** Règle déclenchée. */
  ruleId: AlertRuleId;
  /** Sévérité de l'alerte. */
  severity: AlertSeverity;
  /** Destinataire routé (par sévérité). */
  recipient: string;
  /** Instant de déclenchement (epoch ms). */
  at: number;
}

/** Entrée d'évaluation : métriques simulées + état de santé instantané. */
export interface EvaluationInput {
  /** Instant courant (epoch ms). */
  nowMs: number;
  /** Échantillons CPU (fraction 0..1). */
  cpu: readonly MetricSample[];
  /** Échantillons mémoire (fraction 0..1). */
  mem: readonly MetricSample[];
  /** Échantillons taux d'erreur (fraction 0..1). */
  errorRate: readonly MetricSample[];
  /** Échantillons latence RT p95 (ms). */
  rtP95: readonly MetricSample[];
  /** État instantané des dépendances critiques. */
  health: DependencyHealth;
}

/**
 * Évalue TOUTES les règles d'alerte sur des métriques simulées et retourne les
 * alertes candidates (avant dédup / anti-flapping — cf. `alert-dedup.ts`).
 *
 * Fonction PURE : aucune I/O, résultat déterministe. Les règles à fenêtre
 * (CPU/mem/err/RT) exigent un `sustain` prouvé ; `dependency-down` est immédiat.
 *
 * @param input  - Métriques simulées + santé
 * @param config - Config d'observabilité (défaut : env-injectable résolu)
 * @returns Alertes candidates (une par règle déclenchée)
 */
export function evaluateAlertRules(
  input: EvaluationInput,
  config: ObservabilityConfig = getObservabilityConfig()
): readonly CandidateAlert[] {
  const rules = buildAlertRules(config);
  const byId = new Map(rules.map((r) => [r.id, r]));
  const out: CandidateAlert[] = [];

  const windowRules: ReadonlyArray<
    [AlertRuleId, readonly MetricSample[]]
  > = [
    ["cpu-high", input.cpu],
    ["mem-high", input.mem],
    ["error-rate-high", input.errorRate],
    ["rt-latency-degraded", input.rtP95],
  ];

  for (const [ruleId, samples] of windowRules) {
    const rule = byId.get(ruleId);
    if (rule === undefined) continue;
    if (isSustainedAbove(samples, rule.threshold, rule.windowS, input.nowMs)) {
      out.push({
        ruleId: rule.id,
        severity: rule.severity,
        recipient: rule.recipient,
        at: input.nowMs,
      });
    }
  }

  const depRule = byId.get("dependency-down");
  if (depRule !== undefined && isDependencyDown(input.health)) {
    out.push({
      ruleId: depRule.id,
      severity: depRule.severity,
      recipient: depRule.recipient,
      at: input.nowMs,
    });
  }

  return out;
}
