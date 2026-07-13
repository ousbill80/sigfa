/**
 * observability/dashboard-lint — validation structurelle des dashboards as-code (NET-003).
 *
 * LA LOI (NET-003) : les dashboards Grafana sont AS-CODE (`ops/monitoring/`).
 * L'alimentation réelle (datasources Prometheus/Loki) est GATED sur l'infra
 * (cf. `_arbitrage-f6-f11.md` D11) ; ce qui est TESTABLE maintenant est la
 * VALIDITÉ STRUCTURELLE des définitions JSON : titre, uid, panneaux, cibles.
 *
 * Un dashboard doit couvrir les 4 domaines exigés (API / temps réel / infra /
 * parc bornes) — `lintDashboardSet` vérifie la couverture de l'ensemble.
 *
 * Logique PURE (aucune I/O) : le lint prend l'objet JSON déjà parsé.
 *
 * @module
 */

/** Une cible (query) d'un panneau Grafana. */
export interface DashboardTarget {
  /** Expression de requête (PromQL/LogQL) — non vide. */
  expr: string;
  /** Référence de la légende (facultatif). */
  legendFormat?: string;
}

/** Un panneau d'un dashboard Grafana. */
export interface DashboardPanel {
  /** Titre du panneau — non vide. */
  title: string;
  /** Type de panneau (timeseries, stat, gauge…). */
  type: string;
  /** Cibles (au moins une). */
  targets: DashboardTarget[];
}

/** Domaines exigés par NET-003. */
export type DashboardDomain = "api" | "realtime" | "infra" | "kiosks";

/** Une définition de dashboard Grafana as-code. */
export interface DashboardDefinition {
  /** Identifiant unique stable (uid Grafana) — non vide. */
  uid: string;
  /** Titre du dashboard — non vide. */
  title: string;
  /** Domaine couvert (NET-003 : api / realtime / infra / kiosks). */
  domain: DashboardDomain;
  /** Panneaux (au moins un). */
  panels: DashboardPanel[];
}

/** Résultat de lint : validité + erreurs structurelles listées. */
export interface LintResult {
  /** `true` si aucune erreur. */
  valid: boolean;
  /** Erreurs structurelles (vide si valide). */
  errors: string[];
}

const DOMAINS: readonly DashboardDomain[] = [
  "api",
  "realtime",
  "infra",
  "kiosks",
];

/** Vrai si `value` est un objet non-null (pas un array). */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Vrai si `value` est une chaîne non vide (après trim). */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Lint structurel d'UN dashboard as-code. Vérifie uid/titre/domaine, la présence
 * d'au moins un panneau, et pour chaque panneau titre/type + au moins une cible
 * à `expr` non vide.
 *
 * @param input - Objet JSON déjà parsé (forme inconnue → validée ici)
 * @returns Validité + liste d'erreurs
 */
export function lintDashboard(input: unknown): LintResult {
  const errors: string[] = [];

  if (!isObject(input)) {
    return { valid: false, errors: ["dashboard: doit être un objet JSON"] };
  }

  const uid = input["uid"];
  if (!isNonEmptyString(uid)) errors.push("dashboard.uid: chaîne non vide requise");

  const title = input["title"];
  if (!isNonEmptyString(title))
    errors.push("dashboard.title: chaîne non vide requise");

  const domain = input["domain"];
  if (!isNonEmptyString(domain) || !DOMAINS.includes(domain as DashboardDomain)) {
    errors.push(
      `dashboard.domain: doit être l'un de ${DOMAINS.join(" | ")}`
    );
  }

  const panels = input["panels"];
  if (!Array.isArray(panels) || panels.length === 0) {
    errors.push("dashboard.panels: au moins un panneau requis");
  } else {
    panels.forEach((panel, i) => {
      if (!isObject(panel)) {
        errors.push(`panels[${i}]: doit être un objet`);
        return;
      }
      if (!isNonEmptyString(panel["title"]))
        errors.push(`panels[${i}].title: chaîne non vide requise`);
      if (!isNonEmptyString(panel["type"]))
        errors.push(`panels[${i}].type: chaîne non vide requise`);
      const targets = panel["targets"];
      if (!Array.isArray(targets) || targets.length === 0) {
        errors.push(`panels[${i}].targets: au moins une cible requise`);
      } else {
        targets.forEach((target, j) => {
          if (!isObject(target) || !isNonEmptyString(target["expr"])) {
            errors.push(`panels[${i}].targets[${j}].expr: expression non vide requise`);
          }
        });
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Lint d'un ENSEMBLE de dashboards : chaque dashboard valide ET les 4 domaines
 * NET-003 (api / realtime / infra / kiosks) couverts au moins une fois.
 *
 * @param inputs - Dashboards as-code déjà parsés
 * @returns Validité globale + erreurs (dont domaines manquants)
 */
export function lintDashboardSet(inputs: readonly unknown[]): LintResult {
  const errors: string[] = [];
  const covered = new Set<string>();

  inputs.forEach((input, i) => {
    const res = lintDashboard(input);
    if (!res.valid) {
      for (const e of res.errors) errors.push(`dashboard[${i}]: ${e}`);
    }
    if (isObject(input) && isNonEmptyString(input["domain"])) {
      covered.add(input["domain"]);
    }
  });

  for (const domain of DOMAINS) {
    if (!covered.has(domain)) {
      errors.push(`couverture: domaine "${domain}" manquant (NET-003 exige les 4)`);
    }
  }

  return { valid: errors.length === 0, errors };
}
