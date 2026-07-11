/**
 * Ratchet de couverture SIGFA — INFRA-003
 *
 * Lit les rapports istanbul coverage-final.json, les fusionne,
 * compare avec la baseline, et échoue si une métrique baisse de plus de 0,1 point.
 * En contexte PR, vérifie également que les nouveaux fichiers atteignent ≥85%.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types publics ────────────────────────────────────────────────────────────

/** Les 4 métriques suivies par le ratchet. */
export interface GlobalMetrics {
  lines: number;
  statements: number;
  branches: number;
  functions: number;
}

/** Entrée d'un seul fichier dans un rapport istanbul coverage-final.json. */
export interface IstanbulFileCoverage {
  path: string;
  all: boolean;
  statementMap: Record<string, unknown>;
  s: Record<string, number>;
  branchMap: Record<string, unknown>;
  b: Record<string, number[]>;
  fnMap: Record<string, unknown>;
  f: Record<string, number>;
}

/** Un rapport coverage-final.json complet (chemin → données). */
export type IstanbulCoverageMap = Record<string, IstanbulFileCoverage>;

/** Options passées à runRatchet. */
export interface RatchetOptions {
  /** Chemin absolu vers coverage-baseline.json. */
  baselinePath: string;
  /** Tableaux de rapports istanbul à fusionner. */
  coverageReports: IstanbulCoverageMap[];
  /** Contexte GitHub Actions : "push" ou "pull_request". */
  context: "push" | "pull_request";
  /** Liste des chemins de nouveaux fichiers source (diff PR). */
  newFiles: string[];
  /** Répertoire où écrire la baseline régénérée si amélioration. */
  artifactDir: string;
  /** Callback optionnel pour capturer les messages stdout (test). */
  onLog?: (message: string) => void;
}

/** Résultat retourné par runRatchet. */
export interface RatchetResult {
  exitCode: 0 | 1;
  message: string;
  metrics?: GlobalMetrics;
}

/** Format du fichier coverage-baseline.json. */
interface BaselineFile {
  global: GlobalMetrics;
}

// ─── Fonctions utilitaires ────────────────────────────────────────────────────

/**
 * Arrondit un pourcentage à 2 décimales.
 * @param value - Valeur brute
 * @returns Valeur arrondie à 2 décimales
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Calcule un pourcentage couvert/total.
 * @param covered - Nombre d'items couverts
 * @param total - Nombre total d'items
 * @returns Pourcentage (0-100) arrondi à 2 décimales
 */
function pct(covered: number, total: number): number {
  if (total === 0) return 100;
  return round2((covered / total) * 100);
}

// ─── Fonctions exportées ──────────────────────────────────────────────────────

/**
 * Compte le nombre d'items couverts et le total dans un Record<string, number>.
 * @param counts - Map d'items → hits
 * @returns [couverts, total]
 */
function countHits(counts: Record<string, number>): [number, number] {
  let cov = 0, tot = 0;
  for (const c of Object.values(counts)) { tot++; if (c > 0) cov++; }
  return [cov, tot];
}

/**
 * Compte les branches (tableaux de hits) dans un Record<string, number[]>.
 * @param branches - Map de branches → tableau de hits
 * @returns [couverts, total]
 */
function countBranches(branches: Record<string, number[]>): [number, number] {
  let cov = 0, tot = 0;
  for (const hits of Object.values(branches)) {
    for (const hit of hits) { tot++; if (hit > 0) cov++; }
  }
  return [cov, tot];
}

/**
 * Calcule les métriques globales (lines/statements/branches/functions) en %
 * à partir d'un rapport istanbul brut.
 * @param map - Map istanbul (chemin → FileCoverage)
 * @returns Métriques globales à 2 décimales
 */
export function computeGlobalMetrics(map: IstanbulCoverageMap): GlobalMetrics {
  let totalS = 0, covS = 0, totalB = 0, covB = 0, totalF = 0, covF = 0;

  for (const file of Object.values(map)) {
    const [cs, ts] = countHits(file.s);
    const [cb, tb] = countBranches(file.b);
    const [cf, tf] = countHits(file.f);
    covS += cs; totalS += ts;
    covB += cb; totalB += tb;
    covF += cf; totalF += tf;
  }

  return {
    lines: pct(covS, totalS),       // V8 ne distingue pas lines/statements
    statements: pct(covS, totalS),
    branches: pct(covB, totalB),
    functions: pct(covF, totalF),
  };
}

/**
 * Copie profonde d'un IstanbulFileCoverage (premier rapport pour un fichier).
 * @param fc - Entrée de couverture source
 * @returns Copie indépendante
 */
function deepCopyFileCoverage(fc: IstanbulFileCoverage): IstanbulFileCoverage {
  return {
    path: fc.path, all: fc.all,
    statementMap: fc.statementMap, s: { ...fc.s },
    branchMap: fc.branchMap,
    b: Object.fromEntries(Object.entries(fc.b).map(([k, v]) => [k, [...v]])),
    fnMap: fc.fnMap, f: { ...fc.f },
  };
}

/**
 * Additionne les hits d'une couverture source dans une couverture existante.
 * @param existing - Couverture cible (modifiée en place)
 * @param src - Couverture source à fusionner
 */
function addFileCoverage(existing: IstanbulFileCoverage, src: IstanbulFileCoverage): void {
  for (const [k, v] of Object.entries(src.s)) existing.s[k] = (existing.s[k] ?? 0) + v;
  for (const [k, hits] of Object.entries(src.b)) {
    existing.b[k] = existing.b[k]
      ? existing.b[k]!.map((h, i) => h + (hits[i] ?? 0))
      : [...hits];
  }
  for (const [k, v] of Object.entries(src.f)) existing.f[k] = (existing.f[k] ?? 0) + v;
}

/**
 * Fusionne plusieurs rapports istanbul en un seul en additionnant les hits.
 * @param reports - Tableaux de rapports à fusionner
 * @returns Map fusionnée
 */
export function mergeIstanbulReports(reports: IstanbulCoverageMap[]): IstanbulCoverageMap {
  const result: IstanbulCoverageMap = {};
  for (const report of reports) {
    for (const [filePath, fileCoverage] of Object.entries(report)) {
      if (!result[filePath]) {
        result[filePath] = deepCopyFileCoverage(fileCoverage);
      } else {
        addFileCoverage(result[filePath]!, fileCoverage);
      }
    }
  }
  return result;
}

/**
 * Calcule les métriques par fichier individuel depuis la map fusionnée.
 * @param map - Map istanbul fusionnée
 * @param filePath - Chemin absolu du fichier
 * @returns Métriques du fichier ou null si absent
 */
function computeFileMetrics(
  map: IstanbulCoverageMap,
  filePath: string
): GlobalMetrics | null {
  const file = map[filePath];
  if (!file) return null;
  return computeGlobalMetrics({ [filePath]: file });
}

/**
 * Point d'entrée principal du ratchet de couverture.
 * Compare les métriques courantes avec la baseline et applique les règles.
 * @param options - Options du ratchet
 * @returns Résultat avec exitCode 0 (succès) ou 1 (échec)
 */
export async function runRatchet(options: RatchetOptions): Promise<RatchetResult> {
  const { baselinePath, coverageReports, context, newFiles, artifactDir, onLog } = options;
  const log = (msg: string) => {
    process.stdout.write(msg + "\n");
    onLog?.(msg);
  };

  // Diff vide → exit 0 direct
  if (coverageReports.length === 0) {
    return { exitCode: 0, message: "Aucun rapport de couverture — diff vide, skip ratchet." };
  }

  // Fusion des rapports
  const merged = mergeIstanbulReports(coverageReports);
  const current = computeGlobalMetrics(merged);

  // Lecture de la baseline
  const baselineRaw = fs.readFileSync(baselinePath, "utf-8");
  const baseline: BaselineFile = JSON.parse(baselineRaw) as BaselineFile;
  const base = baseline.global;

  // ── Vérification par fichier (uniquement sur pull_request) ──
  if (context === "pull_request" && newFiles.length > 0) {
    const failingFiles: string[] = [];

    for (const filePath of newFiles) {
      const fileMetrics = computeFileMetrics(merged, filePath);
      if (!fileMetrics) continue;
      // Seuil : statements ≥ 85%
      if (fileMetrics.statements < 85) {
        failingFiles.push(`${filePath} (${fileMetrics.statements}% statements < 85%)`);
      }
    }

    if (failingFiles.length > 0) {
      const msg =
        `Nouveaux fichiers sous le seuil de 85% de couverture :\n` +
        failingFiles.map((f) => `  - ${f}`).join("\n");
      return { exitCode: 1, message: msg, metrics: current };
    }
  }

  // ── Ratchet global ──
  const metrics: Array<keyof GlobalMetrics> = ["lines", "statements", "branches", "functions"];
  const TOLERANCE = 0.1;

  const deltas: string[] = [];
  for (const metric of metrics) {
    const diff = current[metric] - base[metric];
    if (diff < -TOLERANCE) {
      deltas.push(
        `  ${metric}: ${base[metric].toFixed(2)}% → ${current[metric].toFixed(2)}% (delta: ${diff.toFixed(2)}%)`
      );
    }
  }

  if (deltas.length > 0) {
    const msg =
      `Ratchet de couverture ÉCHOUÉ — baisse détectée (delta par métrique) :\n` +
      deltas.join("\n");
    return { exitCode: 1, message: msg, metrics: current };
  }

  // ── Vérification si amélioration ──
  const improved = metrics.some((m) => current[m] > base[m] + TOLERANCE);
  if (improved) {
    const newBaseline: BaselineFile = { global: current };
    const artifactPath = path.join(artifactDir, "coverage-baseline.json");
    fs.writeFileSync(artifactPath, JSON.stringify(newBaseline, null, 2));
    log("baseline améliorée — commitez coverage-baseline.json");
    return {
      exitCode: 0,
      message: "Couverture améliorée. Baseline régénérée en artefact.",
      metrics: current,
    };
  }

  return {
    exitCode: 0,
    message: "Couverture stable. Ratchet OK.",
    metrics: current,
  };
}
