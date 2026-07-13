/**
 * Tests unitaires pour coverage-ratchet.ts — INFRA-003 + CI-RATCHET-ZONES
 *
 * Couvre tous les cas spécifiés dans la story :
 * - Baisse >0,1pt sur une métrique backend → rouge avec delta par métrique
 * - Hausse → exit 0 + baseline régénérée + message actionnable
 * - Nouveau fichier <85% en contexte PR → rouge le nommant
 * - Contexte push → vérification par fichier sautée
 * - Diff vide
 * - Fusion istanbul de ≥2 coverage-final.json → totaux exacts
 *
 * Ratchet différencié par zone (décision PO, dégraissage) :
 * - zone backend (apps/api + packages/* + tools/*) : tolérance 0,1pt, nouveaux fichiers ≥85%
 * - zone ui (apps/web + apps/kiosk) : tolérance 1,0pt, nouveaux fichiers ≥70%
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Imports des fonctions à tester — elles n'existent pas encore (phase ROUGE)
import {
  computeGlobalMetrics,
  computeZoneMetrics,
  mergeIstanbulReports,
  runRatchet,
  zoneOf,
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

// ─── zoneOf ─────────────────────────────────────────────────────────────────

describe("zoneOf", () => {
  it("CI-RATCHET-ZONES: apps/web et apps/kiosk → zone ui", () => {
    expect(zoneOf("/repo/apps/web/src/components/queue.tsx")).toBe("ui");
    expect(zoneOf("/repo/apps/kiosk/src/screens/ticket.ts")).toBe("ui");
  });

  it("CI-RATCHET-ZONES: apps/api, packages/* et tools/* → zone backend", () => {
    expect(zoneOf("/repo/apps/api/src/routes/tickets.ts")).toBe("backend");
    expect(zoneOf("/repo/packages/schemas/src/ticket.ts")).toBe("backend");
    expect(zoneOf("/repo/tools/ci/src/coverage-ratchet.ts")).toBe("backend");
  });
});

// ─── computeZoneMetrics ─────────────────────────────────────────────────────

describe("computeZoneMetrics", () => {
  it("CI-RATCHET-ZONES: sépare les métriques backend et ui depuis une map fusionnée", () => {
    const backendFile = makeIstanbulFile("/repo/apps/api/src/a.ts", { "0": 1, "1": 0 }, {}, {});
    const uiFile = makeIstanbulFile(
      "/repo/apps/web/src/b.tsx",
      { "0": 1, "1": 1, "2": 1, "3": 0 },
      {},
      {}
    );
    const merged = mergeIstanbulReports([backendFile, uiFile]);
    const zones = computeZoneMetrics(merged);

    expect(zones.backend?.statements).toBeCloseTo(50.0, 1);
    expect(zones.ui?.statements).toBeCloseTo(75.0, 1);
  });

  it("CI-RATCHET-ZONES: zone sans fichier couvert → null (pas de faux 100%)", () => {
    const backendFile = makeIstanbulFile("/repo/apps/api/src/a.ts", { "0": 1 }, {}, {});
    const zones = computeZoneMetrics(mergeIstanbulReports([backendFile]));

    expect(zones.backend).not.toBeNull();
    expect(zones.ui).toBeNull();
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

  /** Crée une baseline JSON par zone dans tmpDir (même métriques pour les 2 zones par défaut). */
  function writeBaseline(metrics: GlobalMetrics, uiMetrics?: GlobalMetrics): string {
    const p = path.join(tmpDir, "coverage-baseline.json");
    fs.writeFileSync(
      p,
      JSON.stringify({ zones: { backend: metrics, ui: uiMetrics ?? metrics } }, null, 2)
    );
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

  // ─── Ratchet différencié par zone (CI-RATCHET-ZONES) ──────────────────────

  /** Construit une map de statements avec `covered` couverts sur `total`. */
  function makeStatements(covered: number, total: number): Record<string, number> {
    return Object.fromEntries(
      Array.from({ length: total }, (_, i) => [String(i), i < covered ? 1 : 0])
    );
  }

  it("CI-RATCHET-ZONES: zone backend en baisse >0,1pt → rouge nommant la zone backend", async () => {
    writeBaseline(
      { lines: 80, statements: 80, branches: 100, functions: 100 },
      { lines: 80, statements: 80, branches: 100, functions: 100 }
    );

    // backend : 75% (−5pt) ; ui : stable à 80%
    const backendDown = makeIstanbulFile("/repo/apps/api/src/a.ts", makeStatements(75, 100), {}, {});
    const uiStable = makeIstanbulFile("/repo/apps/web/src/b.tsx", makeStatements(80, 100), {}, {});

    const result = await runRatchet(
      makeOpts({ coverageReports: [backendDown, uiStable], context: "push" })
    );

    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/zone backend/i);
    expect(result.message).toMatch(/delta/i);
  });

  it("CI-RATCHET-ZONES: zone ui en baisse dans la tolérance (≤1,0pt) → exit 0", async () => {
    writeBaseline(
      { lines: 80, statements: 80, branches: 100, functions: 100 },
      { lines: 80, statements: 80, branches: 100, functions: 100 }
    );

    // backend stable à 80% ; ui à 79,5% (−0,5pt : bloquant en backend, toléré en ui)
    const backendStable = makeIstanbulFile("/repo/apps/api/src/a.ts", makeStatements(80, 100), {}, {});
    const uiSlightlyDown = makeIstanbulFile(
      "/repo/apps/web/src/b.tsx",
      makeStatements(159, 200),
      {},
      {}
    );

    const result = await runRatchet(
      makeOpts({ coverageReports: [backendStable, uiSlightlyDown], context: "push" })
    );

    expect(result.exitCode).toBe(0);
  });

  it("CI-RATCHET-ZONES: zone ui en baisse au-delà de la tolérance (>1,0pt) → rouge nommant la zone ui", async () => {
    writeBaseline(
      { lines: 80, statements: 80, branches: 100, functions: 100 },
      { lines: 80, statements: 80, branches: 100, functions: 100 }
    );

    // backend stable ; ui à 75% (−5pt > tolérance 1,0pt)
    const backendStable = makeIstanbulFile("/repo/apps/api/src/a.ts", makeStatements(80, 100), {}, {});
    const uiDown = makeIstanbulFile("/repo/apps/web/src/b.tsx", makeStatements(75, 100), {}, {});

    const result = await runRatchet(
      makeOpts({ coverageReports: [backendStable, uiDown], context: "push" })
    );

    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/zone ui/i);
  });

  it("CI-RATCHET-ZONES: nouveau fichier ui à 75% en PR → exit 0 (seuil ui 70%)", async () => {
    writeBaseline({ lines: 50, statements: 50, branches: 50, functions: 50 });

    const uiNewFile = makeIstanbulFile(
      "/repo/apps/web/src/new-screen.tsx",
      makeStatements(75, 100),
      {},
      {}
    );

    const result = await runRatchet(
      makeOpts({
        coverageReports: [uiNewFile],
        context: "pull_request",
        newFiles: ["/repo/apps/web/src/new-screen.tsx"],
      })
    );

    expect(result.exitCode).toBe(0);
  });

  it("CI-RATCHET-ZONES: nouveau fichier ui à 60% en PR → rouge (sous le plancher ui 70%)", async () => {
    writeBaseline({ lines: 50, statements: 50, branches: 50, functions: 50 });

    const uiNewFile = makeIstanbulFile(
      "/repo/apps/kiosk/src/low.tsx",
      makeStatements(60, 100),
      {},
      {}
    );

    const result = await runRatchet(
      makeOpts({
        coverageReports: [uiNewFile],
        context: "pull_request",
        newFiles: ["/repo/apps/kiosk/src/low.tsx"],
      })
    );

    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/low\.tsx/);
    expect(result.message).toMatch(/70/);
  });

  it("CI-RATCHET-ZONES: nouveau fichier backend à 75% en PR → rouge (seuil backend 85% inchangé)", async () => {
    writeBaseline({ lines: 50, statements: 50, branches: 50, functions: 50 });

    const backendNewFile = makeIstanbulFile(
      "/repo/apps/api/src/new-route.ts",
      makeStatements(75, 100),
      {},
      {}
    );

    const result = await runRatchet(
      makeOpts({
        coverageReports: [backendNewFile],
        context: "pull_request",
        newFiles: ["/repo/apps/api/src/new-route.ts"],
      })
    );

    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/new-route\.ts/);
    expect(result.message).toMatch(/85/);
  });

  it("CI-RATCHET-ZONES: backend s'améliore, ui baisse dans la tolérance → baseline régénérée SANS abaisser la zone ui", async () => {
    writeBaseline(
      { lines: 80, statements: 80, branches: 100, functions: 100 },
      { lines: 80, statements: 80, branches: 100, functions: 100 }
    );

    // backend : 90% (+10pt) ; ui : 79,5% (−0,5pt, toléré)
    const backendUp = makeIstanbulFile("/repo/apps/api/src/a.ts", makeStatements(90, 100), {}, {});
    const uiSlightlyDown = makeIstanbulFile(
      "/repo/apps/web/src/b.tsx",
      makeStatements(159, 200),
      {},
      {}
    );

    const result = await runRatchet(
      makeOpts({ coverageReports: [backendUp, uiSlightlyDown], context: "push" })
    );

    expect(result.exitCode).toBe(0);
    const regenerated = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "coverage-baseline.json"), "utf-8")
    ) as { zones: Record<string, GlobalMetrics> };
    // backend suit l'amélioration
    expect(regenerated.zones["backend"]!.statements).toBeCloseTo(90.0, 1);
    // ui reste sur sa baseline : la tolérance ne doit JAMAIS éroder la baseline
    expect(regenerated.zones["ui"]!.statements).toBeCloseTo(80.0, 1);
  });
});
