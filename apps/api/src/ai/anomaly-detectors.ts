/**
 * IA-003 — Détecteurs d'anomalies agrégées (fonctions PURES, déterministes).
 *
 * Trois détecteurs, alignés sur l'énumération FERMÉE `AnomalyType` (CONTRACT-008,
 * enum DB `anomaly_type`) :
 *  - **QUEUE_STUCK** : une file n'avance pas (aucun `ticket:called` net) pendant
 *    une fenêtre configurable (défaut ≥ 15 min) avec ≥ N tickets en attente
 *    (défaut ≥ 3, seuil D3) et ≥ 1 guichet théoriquement ouvert.
 *  - **AGENT_INACTIVE_PATTERN** : motif d'inactivité récurrent — ≥ 3 alertes
 *    agrégées `AGENT_INACTIVE` (API-007) sur 7 jours glissants pour le même agent
 *    (seuil CONTRACT-008). C'est un MOTIF, pas l'alerte instantanée.
 *  - **SLA_SYSTEMIC** : le taux SLA (REP-001) d'un service/agence reste sous cible
 *    sur une fenêtre récurrente (défaut : sous cible ≥ 3 jours ouvrés sur 5
 *    glissants).
 *
 * ## Frontière alertes/anomalies (pas de double comptage — CONTRACT-008)
 * Une **anomalie** est un MOTIF AGRÉGÉ ; elle ne recrée jamais les alertes
 * instantanées d'API-007 : elle les RÉFÉRENCE (`evidence.metric = "inactive_alerts"`,
 * `evidence.sample = N alertes agrégées`). Les détecteurs consomment les
 * ENREGISTREMENTS d'alertes déjà agrégés, sans les réémettre.
 *
 * ## ZÉRO action corrective automatique (garde-fou constitution §5)
 * Ces fonctions sont PURES : aucune I/O, aucune mutation opérationnelle
 * (réaffectation, ouverture guichet, sanction agent). Elles SIGNALENT ; l'humain
 * décide. Toute persistance se fait EN AVAL via `aiAnomalies` (statut open).
 *
 * ## Seuils surchargeables par banque
 * `DetectorThresholds` fournit les défauts ; une banque peut surcharger via
 * `/banks/:id/thresholds` (CONTRACT-005). `resolveThresholds` fusionne défauts +
 * surcharges partielles.
 *
 * ## Idempotence de clé
 * Chaque candidat porte une `anomalyKey` stable `(bankId, type, scope, windowKey)` :
 * réexécuter le détecteur sur la même fenêtre produit la MÊME clé → l'upsert aval
 * met à jour au lieu de dupliquer.
 *
 * ## Zéro PII
 * Aucune donnée personnelle : uniquement des UUID techniques et des agrégats.
 *
 * @module
 */

/**
 * Énumération FERMÉE des types d'anomalies (CONTRACT-008, miroir exact de
 * l'enum DB `anomaly_type` de `packages/database`). Aucune autre valeur possible.
 * `ANOMALY_TYPES` est la source structurelle testable ; `AnomalyType` en dérive.
 */
export const ANOMALY_TYPES = [
  "QUEUE_STUCK",
  "AGENT_INACTIVE_PATTERN",
  "SLA_SYSTEMIC",
] as const;

/** Type d'anomalie (union fermée dérivée de `ANOMALY_TYPES`). */
export type AnomalyType = (typeof ANOMALY_TYPES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Seuils (défauts + surcharge banque CONTRACT-005)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seuils de détection surchargeables par banque (CONTRACT-005).
 * Toutes les valeurs ont un défaut ; une surcharge partielle est fusionnée.
 */
export interface DetectorThresholds {
  /** QUEUE_STUCK — durée minimale de stagnation (minutes). Défaut 15 (D3). */
  readonly queueStuckMinutes: number;
  /** QUEUE_STUCK — nb minimal de tickets en attente. Défaut 3 (D3). */
  readonly queueStuckMinWaiting: number;
  /** AGENT_INACTIVE_PATTERN — nb minimal d'alertes agrégées. Défaut 3 (CONTRACT-008). */
  readonly inactiveAlertThreshold: number;
  /** AGENT_INACTIVE_PATTERN — fenêtre glissante (jours). Défaut 7 (CONTRACT-008). */
  readonly inactiveWindowDays: number;
  /** SLA_SYSTEMIC — cible de taux SLA (fraction 0..1). Défaut 0.8. */
  readonly slaTargetRate: number;
  /** SLA_SYSTEMIC — nb minimal de jours sous cible dans la fenêtre. Défaut 3. */
  readonly slaMinDaysUnder: number;
  /** SLA_SYSTEMIC — fenêtre glissante (jours ouvrés). Défaut 5. */
  readonly slaWindowDays: number;
}

/** Seuils par défaut IA-003 (D3 QUEUE_STUCK, CONTRACT-008 AGENT_INACTIVE_PATTERN). */
export const DEFAULT_DETECTOR_THRESHOLDS: DetectorThresholds = {
  queueStuckMinutes: 15,
  queueStuckMinWaiting: 3,
  inactiveAlertThreshold: 3,
  inactiveWindowDays: 7,
  slaTargetRate: 0.8,
  slaMinDaysUnder: 3,
  slaWindowDays: 5,
};

/** Surcharge partielle des seuils (venue de `/banks/:id/thresholds`). */
export type ThresholdOverrides = Partial<DetectorThresholds>;

/**
 * Fusionne les seuils par défaut avec une surcharge banque partielle.
 * Les valeurs `undefined` de la surcharge n'écrasent JAMAIS le défaut.
 *
 * @param overrides - Surcharge partielle (CONTRACT-005), optionnelle
 * @returns Seuils effectifs complets
 */
export function resolveThresholds(overrides?: ThresholdOverrides): DetectorThresholds {
  if (!overrides) return DEFAULT_DETECTOR_THRESHOLDS;
  const merged: Record<string, number> = { ...DEFAULT_DETECTOR_THRESHOLDS };
  for (const [k, v] of Object.entries(overrides)) {
    if (typeof v === "number") merged[k] = v;
  }
  return merged as unknown as DetectorThresholds;
}

// ─────────────────────────────────────────────────────────────────────────────
// Preuve structurée (CONTRACT-013 AnomalyEvidence)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preuve structurée d'une anomalie (CONTRACT-013 `AnomalyEvidence`, additif IA-003).
 * Référence la métrique déclencheuse SANS double comptage des alertes.
 */
export interface AnomalyEvidence {
  /** Métrique observée (ex. "wait_seconds", "sla_rate", "inactive_alerts"). */
  readonly metric: string;
  /** Seuil configuré ayant été franchi. */
  readonly threshold: number;
  /** Fenêtre temporelle d'observation (ex. "7d", "PT15M", "5d"). */
  readonly window: string;
  /** Taille de l'échantillon ayant servi à la détection. */
  readonly sample: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidat d'anomalie (sortie PURE, matérialisable en aval dans aiAnomalies)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Candidat d'anomalie produit par un détecteur — objet PUR, jamais persisté ici.
 * L'upsert aval (`aiAnomalies`, statut open) utilise `anomalyKey` pour l'idempotence.
 */
export interface AnomalyCandidate {
  /** Tenant. */
  readonly bankId: string;
  /** Type (énum FERMÉE CONTRACT-008). */
  readonly type: AnomalyType;
  /** Agence concernée (null = niveau banque, ex. SLA cross-agences). */
  readonly agencyId: string | null;
  /** Service concerné (QUEUE_STUCK / SLA_SYSTEMIC), sinon null. */
  readonly serviceId: string | null;
  /** Agent concerné (AGENT_INACTIVE_PATTERN), sinon null. */
  readonly agentId: string | null;
  /** Description lisible (métriques/seuil/fenêtre) — explicabilité manager. */
  readonly description: string;
  /** Preuves structurées (CONTRACT-013). */
  readonly evidence: readonly AnomalyEvidence[];
  /**
   * Clé d'idempotence stable `(bankId|type|scope|windowKey)` — deux runs sur la
   * même fenêtre produisent la même clé → mise à jour, pas duplication.
   */
  readonly anomalyKey: string;
}

/** Construit la clé d'idempotence stable d'un candidat. */
function buildAnomalyKey(
  bankId: string,
  type: AnomalyType,
  scope: string,
  windowKey: string
): string {
  return `${bankId}|${type}|${scope}|${windowKey}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Détecteur 1 : QUEUE_STUCK (D3 — ≥3 tickets en attente sur ≥15 min)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Observation instantanée de l'état d'une file (dérivée des faits SIGFA).
 * `stuckMinutes` = minutes écoulées depuis le dernier `ticket:called` net.
 */
export interface QueueStateObservation {
  readonly bankId: string;
  readonly agencyId: string;
  readonly serviceId: string;
  /** Jour civil Abidjan `YYYY-MM-DD` (compose la windowKey). */
  readonly date: string;
  /** Nb de tickets en attente au moment de l'observation. */
  readonly waitingTickets: number;
  /** Minutes écoulées sans aucun appel net (stagnation). */
  readonly stuckMinutes: number;
  /** Nb de guichets théoriquement ouverts (≥1 exigé). */
  readonly countersOpen: number;
}

/**
 * Détecte les files bloquées (QUEUE_STUCK).
 *
 * Règle D3 : anomalie SI `waitingTickets ≥ queueStuckMinWaiting` (défaut 3)
 * ET `stuckMinutes ≥ queueStuckMinutes` (défaut 15) ET `countersOpen ≥ 1`.
 *
 * @param observations - États de files observés (tenant isolé en amont)
 * @param thresholds   - Seuils effectifs (défauts + surcharge banque)
 * @returns Candidats QUEUE_STUCK (triés par clé, aucun doublon de clé)
 */
export function detectQueueStuck(
  observations: readonly QueueStateObservation[],
  thresholds: DetectorThresholds = DEFAULT_DETECTOR_THRESHOLDS
): AnomalyCandidate[] {
  const candidates: AnomalyCandidate[] = [];
  for (const o of observations) {
    const stuckEnough = o.stuckMinutes >= thresholds.queueStuckMinutes;
    const waitingEnough = o.waitingTickets >= thresholds.queueStuckMinWaiting;
    const counterOpen = o.countersOpen >= 1;
    if (!stuckEnough || !waitingEnough || !counterOpen) continue;

    const windowKey = `${o.date}|${o.stuckMinutes}m`;
    candidates.push({
      bankId: o.bankId,
      type: "QUEUE_STUCK",
      agencyId: o.agencyId,
      serviceId: o.serviceId,
      agentId: null,
      description:
        `File ${o.serviceId} bloquée ${o.stuckMinutes} min sans appel ` +
        `(${o.waitingTickets} tickets en attente, ${o.countersOpen} guichet(s) ouvert(s) ; ` +
        `seuil : ≥${thresholds.queueStuckMinWaiting} tickets sur ≥${thresholds.queueStuckMinutes} min).`,
      evidence: [
        {
          metric: "stuck_minutes",
          threshold: thresholds.queueStuckMinutes,
          window: `PT${thresholds.queueStuckMinutes}M`,
          sample: o.stuckMinutes,
        },
        {
          metric: "waiting_tickets",
          threshold: thresholds.queueStuckMinWaiting,
          window: `PT${thresholds.queueStuckMinutes}M`,
          sample: o.waitingTickets,
        },
      ],
      anomalyKey: buildAnomalyKey(o.bankId, "QUEUE_STUCK", o.serviceId, windowKey),
    });
  }
  return dedupeByKey(candidates);
}

// ─────────────────────────────────────────────────────────────────────────────
// Détecteur 2 : AGENT_INACTIVE_PATTERN (≥3 alertes AGENT_INACTIVE / 7j)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enregistrement d'une alerte agrégée `AGENT_INACTIVE` déjà émise par API-007.
 * IA-003 la RÉFÉRENCE — elle ne la recrée jamais (pas de double comptage).
 */
export interface AgentInactiveAlertRecord {
  readonly bankId: string;
  readonly agencyId: string;
  readonly agentId: string;
  /** Jour civil Abidjan `YYYY-MM-DD` de l'alerte. */
  readonly date: string;
}

/**
 * Détecte le motif d'inactivité récurrent (AGENT_INACTIVE_PATTERN).
 *
 * Seuil CONTRACT-008 : ≥ `inactiveAlertThreshold` (défaut 3) alertes distinctes
 * `AGENT_INACTIVE` sur `inactiveWindowDays` (défaut 7) jours glissants, pour le
 * même agent. On compte les JOURS distincts avec alerte (une seule anomalie /
 * agent / fenêtre) pour ne pas sur-compter plusieurs alertes du même jour.
 *
 * @param alerts        - Alertes agrégées API-007 (référencées, non recréées)
 * @param windowEndDate - Fin de fenêtre glissante `YYYY-MM-DD` (jour d'analyse)
 * @param thresholds    - Seuils effectifs (défauts + surcharge banque)
 * @returns Candidats AGENT_INACTIVE_PATTERN (triés par clé, aucun doublon)
 */
export function detectAgentInactivePattern(
  alerts: readonly AgentInactiveAlertRecord[],
  windowEndDate: string,
  thresholds: DetectorThresholds = DEFAULT_DETECTOR_THRESHOLDS
): AnomalyCandidate[] {
  const windowStart = subtractDays(windowEndDate, thresholds.inactiveWindowDays - 1);

  // Groupe par agent → jours distincts d'alerte dans la fenêtre.
  const byAgent = new Map<
    string,
    { bankId: string; agencyId: string; agentId: string; days: Set<string> }
  >();
  for (const a of alerts) {
    if (a.date < windowStart || a.date > windowEndDate) continue;
    const key = `${a.bankId}|${a.agentId}`;
    const g =
      byAgent.get(key) ??
      { bankId: a.bankId, agencyId: a.agencyId, agentId: a.agentId, days: new Set<string>() };
    g.days.add(a.date);
    byAgent.set(key, g);
  }

  const candidates: AnomalyCandidate[] = [];
  for (const g of byAgent.values()) {
    const count = g.days.size;
    if (count < thresholds.inactiveAlertThreshold) continue;
    const windowKey = `${windowStart}_${windowEndDate}`;
    candidates.push({
      bankId: g.bankId,
      type: "AGENT_INACTIVE_PATTERN",
      agencyId: g.agencyId,
      serviceId: null,
      agentId: g.agentId,
      description:
        `Agent ${g.agentId} : ${count} alertes AGENT_INACTIVE sur ${thresholds.inactiveWindowDays} ` +
        `jours glissants (seuil : ≥${thresholds.inactiveAlertThreshold}).`,
      evidence: [
        {
          metric: "inactive_alerts",
          threshold: thresholds.inactiveAlertThreshold,
          window: `${thresholds.inactiveWindowDays}d`,
          sample: count,
        },
      ],
      anomalyKey: buildAnomalyKey(
        g.bankId,
        "AGENT_INACTIVE_PATTERN",
        g.agentId,
        windowKey
      ),
    });
  }
  return dedupeByKey(candidates);
}

// ─────────────────────────────────────────────────────────────────────────────
// Détecteur 3 : SLA_SYSTEMIC (taux SLA sous cible sur fenêtre récurrente)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Taux SLA journalier d'un scope (service ou agence), issu de REP-001.
 * `slaRate` est une fraction 0..1 (déjà calculée, non recalculée ici).
 */
export interface DailySlaRecord {
  readonly bankId: string;
  readonly agencyId: string;
  /** Service concerné, ou null pour un agrégat agence (SLA cross-services). */
  readonly serviceId: string | null;
  /** Jour civil Abidjan `YYYY-MM-DD`. */
  readonly date: string;
  /** Taux SLA du jour (fraction 0..1), issu de REP-001. */
  readonly slaRate: number;
}

/**
 * Détecte les violations SLA systémiques (SLA_SYSTEMIC).
 *
 * Règle : par scope `(agencyId, serviceId)`, sur les `slaWindowDays` (défaut 5)
 * jours les plus récents disponibles, SI ≥ `slaMinDaysUnder` (défaut 3) jours
 * ont un `slaRate < slaTargetRate` (défaut 0.8), alors anomalie.
 *
 * @param daily      - Taux SLA journaliers (REP-001), tenant isolé en amont
 * @param thresholds - Seuils effectifs (défauts + surcharge banque)
 * @returns Candidats SLA_SYSTEMIC (triés par clé, aucun doublon)
 */
export function detectSlaSystemic(
  daily: readonly DailySlaRecord[],
  thresholds: DetectorThresholds = DEFAULT_DETECTOR_THRESHOLDS
): AnomalyCandidate[] {
  // Groupe par scope (agence + service).
  const byScope = new Map<string, DailySlaRecord[]>();
  for (const d of daily) {
    const key = `${d.bankId}|${d.agencyId}|${d.serviceId ?? "∅"}`;
    const arr = byScope.get(key) ?? [];
    arr.push(d);
    byScope.set(key, arr);
  }

  const candidates: AnomalyCandidate[] = [];
  for (const rows of byScope.values()) {
    // Fenêtre = N jours les plus récents (tri chronologique décroissant).
    const sorted = [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const window = sorted.slice(0, thresholds.slaWindowDays);
    if (window.length === 0) continue;
    const under = window.filter((r) => r.slaRate < thresholds.slaTargetRate);
    if (under.length < thresholds.slaMinDaysUnder) continue;

    const first = window[0]!;
    const scopeId = first.serviceId ?? first.agencyId;
    const windowKey = `${window[window.length - 1]!.date}_${first.date}`;
    const worstRate = Math.min(...under.map((r) => r.slaRate));
    candidates.push({
      bankId: first.bankId,
      type: "SLA_SYSTEMIC",
      agencyId: first.agencyId,
      serviceId: first.serviceId,
      agentId: null,
      description:
        `Taux SLA sous cible (${toPct(thresholds.slaTargetRate)}) sur ` +
        `${under.length} jours des ${window.length} derniers ` +
        `(pire taux : ${toPct(worstRate)}).`,
      evidence: [
        {
          metric: "sla_rate",
          threshold: thresholds.slaTargetRate,
          window: `${thresholds.slaWindowDays}d`,
          sample: under.length,
        },
      ],
      anomalyKey: buildAnomalyKey(first.bankId, "SLA_SYSTEMIC", scopeId, windowKey),
    });
  }
  return dedupeByKey(candidates);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers PURS (dates, dédup, format)
// ─────────────────────────────────────────────────────────────────────────────

/** Recule une date `YYYY-MM-DD` de `n` jours (arithmétique UTC pure). */
export function subtractDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map((s) => Number.parseInt(s, 10));
  const base = Date.UTC(y!, (m! - 1), d!);
  const shifted = new Date(base - n * 24 * 60 * 60 * 1000);
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Formate une fraction 0..1 en pourcentage entier (ex. 0.8 → "80%"). */
function toPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/**
 * Déduplique une liste de candidats par `anomalyKey` (garde le premier),
 * puis trie par clé pour un ordre déterministe (idempotence de sortie).
 */
function dedupeByKey(candidates: readonly AnomalyCandidate[]): AnomalyCandidate[] {
  const seen = new Map<string, AnomalyCandidate>();
  for (const c of candidates) {
    if (!seen.has(c.anomalyKey)) seen.set(c.anomalyKey, c);
  }
  return [...seen.values()].sort((a, b) => (a.anomalyKey < b.anomalyKey ? -1 : a.anomalyKey > b.anomalyKey ? 1 : 0));
}
