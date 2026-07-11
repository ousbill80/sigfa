/**
 * Tests d'inspection du fichier ci.yml — INFRA-003
 *
 * Vérifie par parse YAML :
 * - La chaîne needs : lint → typecheck → test → build
 * - Les triggers push/PR sur main et staging
 * - La présence des caches pnpm et turbo
 * - INFRA-007: permissions, SHA des actions, restore-keys scoped par branche
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { parse as parseYaml } from "yaml";

// Remonte depuis tools/ci/src jusqu'à la racine du monorepo
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../");
const CI_YML_PATH = path.join(REPO_ROOT, ".github/workflows/ci.yml");

/** Lit et parse le ci.yml. Lance une erreur si le fichier n'existe pas. */
function loadCiYml(): Record<string, unknown> {
  const raw = fs.readFileSync(CI_YML_PATH, "utf-8");
  return parseYaml(raw) as Record<string, unknown>;
}

describe("ci.yml — structure", () => {
  it("INFRA-003: le fichier .github/workflows/ci.yml existe", () => {
    expect(fs.existsSync(CI_YML_PATH)).toBe(true);
  });

  it("INFRA-003: la chaîne needs lint→typecheck→test→build est attestée", () => {
    const ci = loadCiYml();
    const jobs = ci["jobs"] as Record<string, { needs?: string | string[] }>;

    expect(jobs).toBeDefined();

    // Tous ces jobs doivent exister
    const required = ["lint", "typecheck", "test", "build"];
    for (const job of required) {
      expect(jobs[job], `job "${job}" manquant dans ci.yml`).toBeDefined();
    }

    // typecheck dépend de lint
    const typecheckNeeds = normalizeNeeds(jobs["typecheck"]?.needs);
    expect(typecheckNeeds).toContain("lint");

    // test dépend de typecheck
    const testNeeds = normalizeNeeds(jobs["test"]?.needs);
    expect(testNeeds).toContain("typecheck");

    // build dépend de test
    const buildNeeds = normalizeNeeds(jobs["build"]?.needs);
    expect(buildNeeds).toContain("test");
  });

  it("INFRA-003: le trigger push cible main et staging", () => {
    const ci = loadCiYml();
    const on = ci["on"] as Record<string, { branches?: string[] }>;

    expect(on).toBeDefined();
    expect(on["push"]).toBeDefined();
    const pushBranches = on["push"]?.branches ?? [];
    expect(pushBranches).toContain("main");
    expect(pushBranches).toContain("staging");
  });

  it("INFRA-003: le trigger pull_request cible main et staging", () => {
    const ci = loadCiYml();
    const on = ci["on"] as Record<string, { branches?: string[] }>;

    expect(on["pull_request"]).toBeDefined();
    const prBranches = on["pull_request"]?.branches ?? [];
    expect(prBranches).toContain("main");
    expect(prBranches).toContain("staging");
  });

  it("INFRA-003: cache pnpm présent dans au moins un job", () => {
    const rawYml = fs.readFileSync(CI_YML_PATH, "utf-8");
    // Recherche textuelle : la clé de cache doit mentionner pnpm
    expect(rawYml).toMatch(/pnpm/i);
    expect(rawYml).toMatch(/cache/i);
  });

  it("INFRA-003: cache turbo présent dans au moins un job", () => {
    const rawYml = fs.readFileSync(CI_YML_PATH, "utf-8");
    expect(rawYml).toMatch(/turbo/i);
    expect(rawYml).toMatch(/cache/i);
  });
});

// ─── INFRA-007: sécurisation du workflow ──────────────────────────────────────

describe("ci.yml — INFRA-007: sécurité et épinglage", () => {
  it("INFRA-007: permissions: contents: read déclaré au niveau workflow", () => {
    const ci = loadCiYml();
    const permissions = ci["permissions"] as Record<string, string> | undefined;
    expect(permissions, "bloc permissions manquant dans ci.yml").toBeDefined();
    expect(permissions?.["contents"]).toBe("read");
  });

  it("INFRA-007: zéro action uses: sans SHA de commit (toutes épinglées à un SHA40)", () => {
    const rawYml = fs.readFileSync(CI_YML_PATH, "utf-8");
    // Trouve toutes les lignes `uses: owner/action@ref`
    const usesLines = rawYml
      .split("\n")
      .filter((l) => /^\s+uses:\s+\S+/.test(l));

    expect(usesLines.length, "Aucune ligne uses: trouvée").toBeGreaterThan(0);

    const notPinned = usesLines.filter((l) => {
      const match = l.match(/uses:\s+\S+@(\S+)/);
      if (!match) return true;
      const ref = match[1];
      // Un SHA de commit est exactement 40 caractères hexadécimaux
      return !/^[0-9a-f]{40}$/.test(ref ?? "");
    });

    expect(
      notPinned,
      `Actions non épinglées à un SHA40 :\n${notPinned.join("\n")}`
    ).toHaveLength(0);
  });

  it("INFRA-007: restore-keys du cache turbo scoped par branche (github.ref_name)", () => {
    const rawYml = fs.readFileSync(CI_YML_PATH, "utf-8");
    // La restore-key doit contenir ref_name pour être scopée par branche
    expect(rawYml).toContain("github.ref_name");
  });
});

// ─── INFRA-007: build précède dist ───────────────────────────────────────────

describe("ci.yml — INFRA-007: build tools/ci avant ratchet", () => {
  it(
    "INFRA-007: dans le job test, une étape 'Build tools/ci' (pnpm --filter @sigfa/ci run build) " +
      "précède toute étape dont le run référence tools/ci/dist/",
    () => {
      const rawYml = fs.readFileSync(CI_YML_PATH, "utf-8");
      const ci = loadCiYml();
      const jobs = ci["jobs"] as Record<
        string,
        { steps?: Array<{ name?: string; run?: string }> }
      >;
      const testJob = jobs["test"];
      expect(testJob, 'job "test" manquant dans ci.yml').toBeDefined();

      const steps = testJob?.steps ?? [];

      // Trouve l'index de la première étape référençant tools/ci/dist/
      const distStepIdx = steps.findIndex(
        (s) => typeof s.run === "string" && s.run.includes("tools/ci/dist/")
      );
      expect(
        distStepIdx,
        "Aucune étape dans le job test ne référence tools/ci/dist/"
      ).toBeGreaterThanOrEqual(0);

      // Trouve l'index d'une étape de build @sigfa/ci qui précède distStepIdx
      const buildStepIdx = steps.findIndex(
        (s, idx) =>
          idx < distStepIdx &&
          typeof s.run === "string" &&
          s.run.includes("--filter @sigfa/ci") &&
          s.run.includes("build")
      );

      expect(
        buildStepIdx,
        `Aucune étape 'pnpm --filter @sigfa/ci run build' ne précède l'étape qui importe tools/ci/dist/ (étape à l'index ${distStepIdx}). ` +
          "Ajouter une étape 'Build tools/ci' avant le ratchet."
      ).toBeGreaterThanOrEqual(0);

      // Sanity-check textuel : la commande exacte est présente dans le YAML brut
      expect(rawYml).toMatch(/--filter @sigfa\/ci.*build|--filter=@sigfa\/ci.*build/);
    }
  );
});

// ─── CONTRACT-009c : job contract-diff ───────────────────────────────────────

describe("ci.yml — CONTRACT-009c: job contract-diff", () => {
  it("CONTRACT-009c: le job contract-diff existe dans ci.yml", () => {
    const ci = loadCiYml();
    const jobs = ci["jobs"] as Record<string, unknown>;
    expect(
      jobs["contract-diff"],
      'job "contract-diff" manquant dans ci.yml'
    ).toBeDefined();
  });

  it("CONTRACT-009c: contract-diff nécessite lint (needs: lint)", () => {
    const ci = loadCiYml();
    const jobs = ci["jobs"] as Record<string, { needs?: string | string[] }>;
    const needs = normalizeNeeds(jobs["contract-diff"]?.needs);
    expect(
      needs,
      'contract-diff doit déclarer needs: lint'
    ).toContain("lint");
  });

  it("CONTRACT-009c: contract-diff contient une étape de bundle avant check-generated-sync", () => {
    const ci = loadCiYml();
    const jobs = ci["jobs"] as Record<
      string,
      { steps?: Array<{ name?: string; run?: string }> }
    >;
    const contractDiffJob = jobs["contract-diff"];
    expect(
      contractDiffJob,
      'job "contract-diff" manquant dans ci.yml'
    ).toBeDefined();

    const steps = contractDiffJob?.steps ?? [];

    // Trouver une étape qui exécute le bundle (artefact requis avant check-generated-sync)
    const bundleStepIdx = steps.findIndex(
      (s) =>
        typeof s.run === "string" &&
        (s.run.includes("bundle") || s.run.includes("--filter @sigfa/contracts"))
    );
    expect(
      bundleStepIdx,
      "Aucune étape de bundle trouvée dans le job contract-diff — " +
        "toute étape CI référençant generated/ doit construire l'artefact d'abord (leçon etat-local-residuel)"
    ).toBeGreaterThanOrEqual(0);

    // Trouver l'étape check-generated-sync
    const syncStepIdx = steps.findIndex(
      (s) =>
        typeof s.run === "string" &&
        s.run.includes("check-generated-sync")
    );
    expect(
      syncStepIdx,
      "Aucune étape check-generated-sync.sh trouvée dans le job contract-diff"
    ).toBeGreaterThanOrEqual(0);

    // Bundle DOIT précéder check-generated-sync
    expect(
      bundleStepIdx,
      `L'étape bundle (idx ${bundleStepIdx}) doit précéder check-generated-sync (idx ${syncStepIdx}) — ` +
        "leçon etat-local-residuel-masque-la-ci"
    ).toBeLessThan(syncStepIdx);
  });

  it("CONTRACT-009c: contract-diff contient une étape contract-diff.sh pour les PRs", () => {
    const rawYml = fs.readFileSync(CI_YML_PATH, "utf-8");
    // Le script contract-diff.sh doit être référencé dans le job
    expect(
      rawYml,
      "contract-diff.sh non référencé dans ci.yml"
    ).toContain("contract-diff.sh");
  });

  it("CONTRACT-009c: le breaking-change check est conditionnel (PR uniquement)", () => {
    const ci = loadCiYml();
    const jobs = ci["jobs"] as Record<
      string,
      { steps?: Array<{ name?: string; run?: string; if?: string }> }
    >;
    const contractDiffJob = jobs["contract-diff"];
    const steps = contractDiffJob?.steps ?? [];

    // Une étape doit être conditionnelle : github.event_name == 'pull_request'
    const prOnlyStep = steps.find(
      (s) =>
        typeof s["if"] === "string" &&
        s["if"].includes("pull_request")
    );
    expect(
      prOnlyStep,
      "Aucune étape conditionnelle 'pull_request' dans contract-diff — " +
        "le breaking-check doit être exécuté uniquement en PR"
    ).toBeDefined();
  });

  it("CONTRACT-009c: contract-diff fait fetch-depth: 0 pour avoir l'historique git complet", () => {
    const ci = loadCiYml();
    const jobs = ci["jobs"] as Record<
      string,
      { steps?: Array<{ name?: string; uses?: string; with?: Record<string, unknown> }> }
    >;
    const contractDiffJob = jobs["contract-diff"];
    const steps = contractDiffJob?.steps ?? [];

    // Trouver l'étape checkout
    const checkoutStep = steps.find(
      (s) => typeof s.uses === "string" && s.uses.includes("actions/checkout")
    );
    expect(checkoutStep, "Aucune étape checkout dans contract-diff").toBeDefined();

    const fetchDepth = checkoutStep?.with?.["fetch-depth"];
    expect(
      fetchDepth,
      "contract-diff checkout doit avoir fetch-depth: 0 pour comparer avec origin/main"
    ).toBe(0);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalise le champ `needs` d'un job GitHub Actions en tableau.
 * @param needs - Valeur brute du champ needs (string ou string[])
 * @returns Tableau de noms de jobs
 */
function normalizeNeeds(needs: string | string[] | undefined): string[] {
  if (!needs) return [];
  if (typeof needs === "string") return [needs];
  return needs;
}
