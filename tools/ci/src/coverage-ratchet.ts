/**
 * Ratchet de couverture SIGFA — INFRA-003 + CI-RATCHET-ZONES
 *
 * Lit les rapports istanbul coverage-final.json, les fusionne, découpe la
 * couverture en deux zones et compare chaque zone avec sa baseline :
 * - zone backend (apps/api + packages/* + tools/*) : tolérance 0,1pt,
 *   nouveaux fichiers ≥85% (exigence stricte inchangée) ;
 * - zone ui (apps/web + apps/kiosk) : tolérance 1,0pt, nouveaux fichiers ≥70%
 *   (exigence assouplie — décision PO, la couverture de lignes garantit peu sur l'UI).
 * La baseline n'est jamais abaissée par une baisse tolérée (pas d'érosion).
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

/** Zones de couverture du monorepo. */
export type Zone = "backend" | "ui";

/** Politique de ratchet d'une zone. */
export interface ZonePolicy {
  /** Baisse maximale tolérée par métrique (en points de %). */
  tolerance: number;
  /** Seuil de statements exigé pour un nouveau fichier en PR (en %). */
  newFileThreshold: number;
}

/** Politiques par zone — source de vérité des seuils (documentées dans CLAUDE.md §4). */
export const ZONE_POLICIES: Record<Zone, ZonePolicy> = {
  backend: { tolerance: 0.1, newFileThreshold: 85 },
  ui: { tolerance: 1.0, newFileThreshold: 70 },
};

const ZONES: Zone[] = ["backend", "ui"];

/** Chemins de la zone ui : apps/web et apps/kiosk. Tout le reste est backend. */
const UI_ZONE_PATTERN = /[/\\]apps[/\\](?:web|kiosk)[/\\]/;

/**
 * Détermine la zone d'un fichier couvert à partir de son chemin.
 * @param filePath - Chemin (absolu ou relatif) du fichier
 * @returns "ui" pour apps/web et apps/kiosk, "backend" sinon
 */
export function zoneOf(filePath: string): Zone {
  return UI_ZONE_PATTERN.test(filePath) ? "ui" : "backend";
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

/** Format du fichier coverage-baseline.json (une baseline par zone). */
interface BaselineFile {
  zones: Record<Zone, GlobalMetrics>;
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
 * Calcule les métriques par zone depuis une map istanbul fusionnée.
 * @param map - Map istanbul fusionnée
 * @returns Métriques par zone, ou null pour une zone sans fichier couvert
 */
export function computeZoneMetrics(
  map: IstanbulCoverageMap
): Record<Zone, GlobalMetrics | null> {
  const byZone: Record<Zone, IstanbulCoverageMap> = { backend: {}, ui: {} };
  for (const [filePath, fileCoverage] of Object.entries(map)) {
    byZone[zoneOf(filePath)][filePath] = fileCoverage;
  }
  return {
    backend: Object.keys(byZone.backend).length > 0 ? computeGlobalMetrics(byZone.backend) : null,
    ui: Object.keys(byZone.ui).length > 0 ? computeGlobalMetrics(byZone.ui) : null,
  };
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
 * Vérifie que les nouveaux fichiers d'une PR atteignent le seuil de leur zone
 * (backend ≥85%, ui ≥70%).
 * @param merged - Map de couverture fusionnée
 * @param newFiles - Liste des chemins de nouveaux fichiers
 * @returns Message d'erreur ou null si tous les fichiers passent leur seuil
 */
function checkNewFilesThreshold(
  merged: IstanbulCoverageMap,
  newFiles: string[]
): string | null {
  const failingFiles: string[] = [];
  for (const filePath of newFiles) {
    const fileMetrics = computeFileMetrics(merged, filePath);
    if (!fileMetrics) continue;
    const zone = zoneOf(filePath);
    const threshold = ZONE_POLICIES[zone].newFileThreshold;
    if (fileMetrics.statements < threshold) {
      failingFiles.push(
        `${filePath} (${fileMetrics.statements}% statements < ${threshold}% — zone ${zone})`
      );
    }
  }
  if (failingFiles.length === 0) return null;
  return (
    `Nouveaux fichiers sous le seuil de couverture de leur zone :\n` +
    failingFiles.map((f) => `  - ${f}`).join("\n")
  );
}

/**
 * Vérifie le ratchet d'une zone : aucune métrique ne doit baisser de plus
 * que la tolérance de la zone.
 * @param zone - Zone vérifiée
 * @param current - Métriques courantes de la zone
 * @param base - Métriques de la baseline de la zone
 * @returns Message d'erreur ou null si le ratchet est respecté
 */
function checkZoneRatchet(
  zone: Zone,
  current: GlobalMetrics,
  base: GlobalMetrics
): string | null {
  const metrics: Array<keyof GlobalMetrics> = ["lines", "statements", "branches", "functions"];
  const tolerance = ZONE_POLICIES[zone].tolerance;
  const deltas: string[] = [];
  for (const metric of metrics) {
    const diff = current[metric] - base[metric];
    if (diff < -tolerance) {
      deltas.push(
        `  ${metric}: ${base[metric].toFixed(2)}% → ${current[metric].toFixed(2)}% (delta: ${diff.toFixed(2)}%)`
      );
    }
  }
  if (deltas.length === 0) return null;
  return (
    `Ratchet de couverture ÉCHOUÉ — zone ${zone} en baisse ` +
    `(tolérance ${tolerance}pt, delta par métrique) :\n` +
    deltas.join("\n")
  );
}

/**
 * Régénère la baseline si au moins une zone s'est améliorée au-delà de sa tolérance.
 * Seules les zones améliorées sont relevées : une baisse tolérée n'érode JAMAIS
 * la baseline d'une zone (sinon la tolérance ui deviendrait un canal d'érosion).
 * @param currentZones - Métriques courantes par zone (null si zone sans fichier)
 * @param baseZones - Baselines par zone
 * @param artifactDir - Répertoire de sortie de la nouvelle baseline
 * @param log - Fonction de log
 * @returns true si la baseline a été régénérée, false sinon
 */
function maybeUpdateBaseline(
  currentZones: Record<Zone, GlobalMetrics | null>,
  baseZones: Record<Zone, GlobalMetrics>,
  artifactDir: string,
  log: (msg: string) => void
): boolean {
  const metrics: Array<keyof GlobalMetrics> = ["lines", "statements", "branches", "functions"];
  const newZones: Record<Zone, GlobalMetrics> = { ...baseZones };
  let improved = false;
  for (const zone of ZONES) {
    const current = currentZones[zone];
    const base = baseZones[zone];
    if (!current || !base) continue;
    const tolerance = ZONE_POLICIES[zone].tolerance;
    if (metrics.some((m) => current[m] > base[m] + tolerance)) {
      newZones[zone] = current;
      improved = true;
    }
  }
  if (!improved) return false;
  const newBaseline: BaselineFile = { zones: newZones };
  fs.writeFileSync(path.join(artifactDir, "coverage-baseline.json"), JSON.stringify(newBaseline, null, 2));
  log("baseline améliorée — commitez coverage-baseline.json");
  return true;
}

/**
 * Point d'entrée principal du ratchet de couverture.
 * Compare les métriques courantes avec la baseline et applique les règles.
 * @param options - Options du ratchet
 * @returns Résultat avec exitCode 0 (succès) ou 1 (échec)
 */
export async function runRatchet(options: RatchetOptions): Promise<RatchetResult> {
  const { baselinePath, coverageReports, context, newFiles, artifactDir, onLog } = options;
  const log = (msg: string) => { process.stdout.write(msg + "\n"); onLog?.(msg); };

  if (coverageReports.length === 0) {
    return { exitCode: 0, message: "Aucun rapport de couverture — diff vide, skip ratchet." };
  }

  const merged = mergeIstanbulReports(coverageReports);
  const current = computeGlobalMetrics(merged);
  const currentZones = computeZoneMetrics(merged);
  const baseZones = (JSON.parse(fs.readFileSync(baselinePath, "utf-8")) as BaselineFile).zones;

  if (context === "pull_request" && newFiles.length > 0) {
    const err = checkNewFilesThreshold(merged, newFiles);
    if (err) return { exitCode: 1, message: err, metrics: current };
  }

  for (const zone of ZONES) {
    const zoneMetrics = currentZones[zone];
    if (!zoneMetrics) {
      log(`zone ${zone}: aucun fichier couvert dans le diff — skip.`);
      continue;
    }
    const zoneBase = baseZones[zone];
    if (!zoneBase) {
      log(`zone ${zone}: absente de la baseline — skip (elle sera ajoutée à la prochaine régénération).`);
      continue;
    }
    const ratchetErr = checkZoneRatchet(zone, zoneMetrics, zoneBase);
    if (ratchetErr) return { exitCode: 1, message: ratchetErr, metrics: current };
    log(
      `zone ${zone}: OK (lines ${zoneMetrics.lines}%, statements ${zoneMetrics.statements}%, ` +
        `branches ${zoneMetrics.branches}%, functions ${zoneMetrics.functions}%)`
    );
  }

  if (maybeUpdateBaseline(currentZones, baseZones, artifactDir, log)) {
    return { exitCode: 0, message: "Couverture améliorée. Baseline régénérée en artefact.", metrics: current };
  }

  return { exitCode: 0, message: "Couverture stable. Ratchet OK.", metrics: current };
}
