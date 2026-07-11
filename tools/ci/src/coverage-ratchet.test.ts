/**
 * Tests unitaires pour coverage-ratchet.ts — INFRA-003
 *
 * Couvre tous les cas spécifiés dans la story :
 * - Baisse >0,1pt sur une métrique → rouge avec delta par métrique
 * - Hausse → exit 0 + baseline régénérée + message actionnable
 * - Nouveau fichier <85% en contexte PR → rouge le nommant
 * - Contexte push → vérification par fichier sautée
 * - Diff vide
 * - Fusion istanbul de ≥2 coverage-final.json → totaux exacts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Imports des fonctions à tester — elles n'existent pas encore (phase ROUGE)
import {
  computeGlobalMetrics,
  mergeIstanbulReports,
  runRatchet,
  type RatchetOptions,
  type GlobalMetrics,
  type IstanbulCoverageMap,
} from "./coverage-ratchet.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Construit un coverage-final.json istanbul minimaliste. */
function makeIstanbulFile(
  filePath: string,
  s: Record<string, number>,
  b: Record<string, number[]>,
  f: Record<string, number>,
  statementMap?: Record<string, unknown>,
  branchMap?: Record<string, unknown>,
  fnMap?: Record<string, unknown>
): IstanbulCoverageMap {
  return {
    [filePath]: {
      path: filePath,
      all: false,
      statementMap: statementMap ?? Object.fromEntries(Object.keys(s).map((k) => [k, {}])),
      s,
      branchMap: branchMap ?? Object.fromEntries(Object.keys(b).map((k) => [k, {}])),
      b,
      fnMap: fnMap ?? Object.fromEntries(Object.keys(f).map((k) => [k, {}])),
      f,
    },
  };
}

/** Baseline de référence pour les tests de ratchet. */
const BASELINE: GlobalMetrics = {
  lines: 80.0,
  statements: 80.0,
  branches: 70.0,
  functions: 75.0,
};

// ─── computeGlobalMetrics ────────────────────────────────────────────────────

describe("computeGlobalMetrics", () => {
  it("INFRA-003: calcule les métriques globales à 2 décimales sur un rapport simple", () => {
    // 2 statements, 1 covered → 50%
    const map = makeIstanbulFile("/src/foo.ts", { "0": 1, "1": 0 }, {}, {});
    const metrics = computeGlobalMetrics(map);
    expect(metrics.statements).toBeCloseTo(50.0, 1);
  });

  it("INFRA-003: retourne 100 quand tout est couvert", () => {
    const map = makeIstanbulFile(
      "/src/foo.ts",
      { "0": 1, "1": 5 },
      { "0": [2, 3] },
      { "0": 1 }
    );
    const metrics = computeGlobalMetrics(map);
    expect(metrics.statements).toBe(100);
    expect(metrics.branches).toBe(100);
    expect(metrics.functions).toBe(100);
  });

  it("INFRA-003: retourne 0 quand aucun item n'est couvert", () => {
    const map = makeIstanbulFile(
      "/src/bar.ts",
      { "0": 0, "1": 0 },
      { "0": [0, 0] },
      { "0": 0 }
    );
    const metrics = computeGlobalMetrics(map);
    expect(metrics.statements).toBe(0);
    expect(metrics.branches).toBe(0);
    expect(metrics.functions).toBe(0);
  });
});

// ─── mergeIstanbulReports ────────────────────────────────────────────────────

describe("mergeIstanbulReports", () => {
  it("INFRA-003: fusion istanbul de ≥2 coverage-final.json → totaux exacts", () => {
    // Rapport 1 : fichier A — 1/3 statements couverts, 1/1 function
    const report1 = makeIstanbulFile("/src/a.ts", { "0": 1, "1": 0, "2": 0 }, {}, { "0": 1 });
    // Rapport 2 : fichier B — 3/3 statements couverts, 0/1 function
    const report2 = makeIstanbulFile("/src/b.ts", { "0": 3, "1": 2, "2": 1 }, {}, { "0": 0 });

    const merged = mergeIstanbulReports([report1, report2]);
    const metrics = computeGlobalMetrics(merged);

    // Total : 6 statements, 4 couverts → 66,67%
    expect(metrics.statements).toBeCloseTo(66.67, 1);
    // Total : 2 functions, 1 couverte → 50%
    expect(metrics.functions).toBe(50);
  });

  it("INFRA-003: fusion avec le même fichier dans les deux rapports — additionne les hits", () => {
    // Même fichier dans deux rapports (exécuté deux fois)
    const report1 = makeIstanbulFile("/src/a.ts", { "0": 1, "1": 0 }, {}, {});
    const report2 = makeIstanbulFile("/src/a.ts", { "0": 2, "1": 1 }, {}, {});

    const merged = mergeIstanbulReports([report1, report2]);
    // Le fichier doit avoir s["0"]=3, s["1"]=1 → 4/4 ? Non : 2 statements, tous >0 → 100%
    const metrics = computeGlobalMetrics(merged);
    expect(metrics.statements).toBe(100);
  });

  it("INFRA-003: un seul rapport retourne les mêmes métriques que computeGlobalMetrics direct", () => {
    const report = makeIstanbulFile(
      "/src/c.ts",
      { "0": 5, "1": 3 },
      { "0": [1, 0] },
      { "0": 1 }
    );
    const merged = mergeIstanbulReports([report]);
    const directMetrics = computeGlobalMetrics(report);
    const mergedMetrics = computeGlobalMetrics(merged);

    expect(mergedMetrics.statements).toBeCloseTo(directMetrics.statements, 2);
    expect(mergedMetrics.branches).toBeCloseTo(directMetrics.branches, 2);
    expect(mergedMetrics.functions).toBeCloseTo(directMetrics.functions, 2);
  });
});

// ─── runRatchet ─────────────────────────────────────────────────────────────

describe("runRatchet", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Crée une baseline JSON dans tmpDir. */
  function writeBaseline(metrics: GlobalMetrics): string {
    const p = path.join(tmpDir, "coverage-baseline.json");
    fs.writeFileSync(p, JSON.stringify({ global: metrics }, null, 2));
    return p;
  }

  /** Options communes de test. */
  function makeOpts(overrides: Partial<RatchetOptions> = {}): RatchetOptions {
    return {
      baselinePath: path.join(tmpDir, "coverage-baseline.json"),
      coverageReports: [],
      context: "push",
      newFiles: [],
      artifactDir: tmpDir,
      ...overrides,
    };
  }

  it("INFRA-003: diff vide (aucun rapport) → exit 0 sans erreur", async () => {
    writeBaseline(BASELINE);
    const result = await runRatchet(makeOpts({ coverageReports: [] }));
    expect(result.exitCode).toBe(0);
  });

  it("INFRA-003: baisse simulée >0,1pt sur une métrique → ratchet rouge avec delta par métrique", async () => {
    writeBaseline(BASELINE);

    // Couverture en baisse sur 'lines' uniquement (−5pt)
    const lowerCoverage: IstanbulCoverageMap = makeIstanbulFile(
      "/src/foo.ts",
      // statements: ~75% (baisse de 5pt vs baseline 80%)
      { "0": 75, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0, "8": 0, "9": 0,
        "10": 0, "11": 0, "12": 0, "13": 0, "14": 0, "15": 0, "16": 0, "17": 0, "18": 0, "19": 0,
        "20": 0, "21": 0, "22": 0, "23": 0, "24": 0 },
      {},
      {}
    );

    const result = await runRatchet(
      makeOpts({ coverageReports: [lowerCoverage], context: "push" })
    );

    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/delta/i);
    // Doit nommer la métrique en baisse
    expect(result.message).toMatch(/statements|lines|branches|functions/i);
  });

  it("INFRA-003: hausse simulée → exit 0 + baseline régénérée écrite + message actionnable", async () => {
    writeBaseline(BASELINE);

    // Couverture à 100% sur tous les compteurs
    const highCoverage: IstanbulCoverageMap = makeIstanbulFile(
      "/src/foo.ts",
      { "0": 10, "1": 10 },
      { "0": [5, 5] },
      { "0": 3 }
    );

    const stdoutLines: string[] = [];
    const result = await runRatchet(
      makeOpts({
        coverageReports: [highCoverage],
        context: "push",
        onLog: (msg) => stdoutLines.push(msg),
      })
    );

    expect(result.exitCode).toBe(0);
    // La baseline régénérée doit être écrite dans artifactDir
    const artifactBaseline = path.join(tmpDir, "coverage-baseline.json");
    expect(fs.existsSync(artifactBaseline)).toBe(true);
    // Message actionnable sur stdout
    const fullLog = stdoutLines.join("\n");
    expect(fullLog).toMatch(/baseline améliorée.*commitez coverage-baseline\.json/i);
  });

  it("INFRA-003: nouveau fichier simulé <85% en contexte PR → rouge le nommant", async () => {
    writeBaseline(BASELINE);

    // Fichier avec couverture ~50% (< 85%)
    const lowFileCoverage: IstanbulCoverageMap = makeIstanbulFile(
      "/src/new-feature.ts",
      { "0": 1, "1": 0 },
      {},
      { "0": 0, "1": 0 }
    );

    const result = await runRatchet(
      makeOpts({
        coverageReports: [lowFileCoverage],
        context: "pull_request",
        newFiles: ["/src/new-feature.ts"],
      })
    );

    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/new-feature\.ts/);
  });

  it("INFRA-003: contexte push → vérification par fichier sautée (nouveau fichier <85% ne bloque pas)", async () => {
    writeBaseline({ lines: 50, statements: 50, branches: 50, functions: 50 });

    // Fichier avec couverture ~50% (< 85%) mais contexte push
    const lowFileCoverage: IstanbulCoverageMap = makeIstanbulFile(
      "/src/new-feature.ts",
      { "0": 1, "1": 0 },
      {},
      { "0": 1 }
    );

    const result = await runRatchet(
      makeOpts({
        coverageReports: [lowFileCoverage],
        context: "push",
        newFiles: ["/src/new-feature.ts"],
      })
    );

    // En push, la vérif par fichier est sautée → exit 0 si la couverture globale est stable ou en hausse
    expect(result.exitCode).toBe(0);
  });

  it("INFRA-003: baisse inférieure ou égale à 0,1pt → exit 0 (tolérance)", async () => {
    // Baseline à exactement 80%
    writeBaseline({ lines: 80.0, statements: 80.0, branches: 80.0, functions: 80.0 });

    // Couverture à 79.95% (baisse de 0.05pt, dans la tolérance)
    const slightlyLower: IstanbulCoverageMap = makeIstanbulFile(
      "/src/foo.ts",
      // 1599/2000 = 79.95%
      { ...Object.fromEntries(Array.from({ length: 1599 }, (_, i) => [String(i), 1])),
        ...Object.fromEntries(Array.from({ length: 401 }, (_, i) => [String(i + 1599), 0])) },
      {},
      {}
    );

    const result = await runRatchet(
      makeOpts({ coverageReports: [slightlyLower], context: "push" })
    );
    expect(result.exitCode).toBe(0);
  });
});
