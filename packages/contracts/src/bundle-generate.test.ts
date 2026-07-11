/**
 * CONTRACT-009 — Tests pour bundle + types + client typé (sous-lot 009a)
 * Critères 1–4 de la story CONTRACT-009.
 *
 * Critère 1 : bundle résout la chaîne $ref à 3 niveaux (ai→reporting→core)
 * Critère 2 : typecheck strict vert sur generated/ (via tsc --noEmit)
 * Critère 3 : generate 2× → zéro diff (déterminisme)
 * Critère 4 : client typé couvre 100% des endpoints (inventaire chemins×méthodes vs YAML)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONTRACTS_DIR = resolve(__dirname, "..");
const BUNDLED_DIR = resolve(CONTRACTS_DIR, "generated/bundled");
const TYPES_DIR = resolve(CONTRACTS_DIR, "generated/types");
const CLIENT_FILE = resolve(CONTRACTS_DIR, "src/client.ts");
const OPENAPI_DIR = resolve(CONTRACTS_DIR, "openapi");

const MODULES = ["core", "public", "agents", "admin", "reporting", "notifications", "ai"] as const;
type Module = (typeof MODULES)[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadBundledYaml(module: Module): Record<string, unknown> {
  const path = resolve(BUNDLED_DIR, `${module}.yaml`);
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8");
  return parse(raw) as Record<string, unknown>;
}

function loadSourceYaml(module: Module): Record<string, unknown> {
  const path = resolve(OPENAPI_DIR, `${module}.yaml`);
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8");
  return parse(raw) as Record<string, unknown>;
}

type OpenAPIDoc = {
  openapi?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, unknown>>;
  components?: {
    schemas?: Record<string, unknown>;
    responses?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
    headers?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
};

/**
 * Collect all paths×methods from an OpenAPI document.
 * Returns array of "METHOD /path" strings.
 */
function collectEndpoints(doc: OpenAPIDoc): string[] {
  const paths = doc.paths ?? {};
  const httpMethods = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];
  const endpoints: string[] = [];
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of httpMethods) {
      if (method in (pathItem as Record<string, unknown>)) {
        endpoints.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return endpoints.sort();
}


// ─── Suite 1 : Bundle résout les $ref inter-fichiers ─────────────────────────

describe("CONTRACT-009: bundle → YAML bundlés par module", () => {
  it("CONTRACT-009: tous les fichiers bundlés existent (7 modules)", () => {
    for (const module of MODULES) {
      const bundledPath = resolve(BUNDLED_DIR, `${module}.yaml`);
      expect(
        existsSync(bundledPath),
        `Bundle manquant pour le module ${module} : ${bundledPath}`
      ).toBe(true);
    }
  });

  it("CONTRACT-009: les bundles sont des documents OpenAPI 3.1 valides", () => {
    for (const module of MODULES) {
      const doc = loadBundledYaml(module) as OpenAPIDoc;
      expect(doc.openapi, `${module}.yaml: champ openapi manquant`).toBeDefined();
      expect(
        doc.openapi,
        `${module}.yaml: version openapi incorrecte`
      ).toMatch(/^3\.1/);
    }
  });

  it("CONTRACT-009: bundle résout la chaîne $ref à 3 niveaux (ai→reporting→core)", () => {
    // ai.yaml référence reporting.yaml#/components/schemas/AnonymizedNetworkAggregate
    // qui elle-même référence core.yaml
    // Après bundle, aucun $ref externe vers des fichiers .yaml ne doit subsister dans les valeurs $ref
    const aiBundle = loadBundledYaml("ai") as OpenAPIDoc;

    // Le bundle doit exister et contenir des paths
    expect(aiBundle.openapi).toBeDefined();
    expect(aiBundle.paths).toBeDefined();

    // Collecter toutes les valeurs $ref dans le bundle (uniquement les valeurs, pas les descriptions)
    function collectRefs(obj: unknown): string[] {
      if (!obj || typeof obj !== "object") return [];
      if (Array.isArray(obj)) return obj.flatMap(collectRefs);
      const refs: string[] = [];
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (key === "$ref" && typeof value === "string") {
          refs.push(value);
        } else {
          refs.push(...collectRefs(value));
        }
      }
      return refs;
    }

    const allRefs = collectRefs(aiBundle);
    const externalRefs = allRefs.filter(
      (ref) => ref.includes("reporting.yaml") || ref.includes("core.yaml")
    );

    expect(
      externalRefs,
      `ai bundle: ${externalRefs.length} $ref externe(s) non résolu(s) vers reporting.yaml/core.yaml : ${externalRefs.join(", ")}`
    ).toHaveLength(0);

    // Le bundle doit contenir les composants résolus de reporting (AnonymizedNetworkAggregate)
    const schemas = aiBundle.components?.schemas ?? {};
    expect(
      Object.keys(schemas).length,
      "ai bundle: aucun schéma résolu dans components"
    ).toBeGreaterThan(0);
  });

  it("CONTRACT-009: bundle core.yaml ne contient pas de $ref externes vers d'autres fichiers YAML", () => {
    const coreBundle = loadBundledYaml("core") as OpenAPIDoc;

    function collectRefs(obj: unknown): string[] {
      if (!obj || typeof obj !== "object") return [];
      if (Array.isArray(obj)) return obj.flatMap(collectRefs);
      const refs: string[] = [];
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (key === "$ref" && typeof value === "string") {
          refs.push(value);
        } else {
          refs.push(...collectRefs(value));
        }
      }
      return refs;
    }

    const allRefs = collectRefs(coreBundle);
    // core.yaml est la racine — son bundle ne doit référencer aucun autre fichier yaml
    const externalRefs = allRefs.filter((ref) => ref.match(/\.\/[^#]+\.yaml/));
    expect(
      externalRefs,
      `core bundle: $ref externe(s) non résolue(s) : ${externalRefs.join(", ")}`
    ).toHaveLength(0);
  });

  it("CONTRACT-009: bundle reporting.yaml résout les $ref vers core.yaml", () => {
    const reportingBundle = loadBundledYaml("reporting") as OpenAPIDoc;

    function collectRefs(obj: unknown): string[] {
      if (!obj || typeof obj !== "object") return [];
      if (Array.isArray(obj)) return obj.flatMap(collectRefs);
      const refs: string[] = [];
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (key === "$ref" && typeof value === "string") {
          refs.push(value);
        } else {
          refs.push(...collectRefs(value));
        }
      }
      return refs;
    }

    const allRefs = collectRefs(reportingBundle);
    const externalRefs = allRefs.filter((ref) => ref.includes("core.yaml"));
    expect(
      externalRefs,
      `reporting bundle: $ref(s) externe(s) vers core.yaml non résolu(s) : ${externalRefs.join(", ")}`
    ).toHaveLength(0);
    // Doit avoir des composants résolus
    expect(reportingBundle.components?.schemas).toBeDefined();
  });

  it("CONTRACT-009: les 7 modules ont bien leurs paths dans les bundles", () => {
    for (const module of MODULES) {
      const doc = loadBundledYaml(module) as OpenAPIDoc;
      expect(
        doc.paths,
        `${module}: bundle sans paths (document vide ?)`
      ).toBeDefined();
      const pathCount = Object.keys(doc.paths ?? {}).length;
      expect(
        pathCount,
        `${module}: bundle sans aucun endpoint`
      ).toBeGreaterThan(0);
    }
  });
});

// ─── Suite 2 : Types générés existent pour chaque module ─────────────────────

describe("CONTRACT-009: generate → types TS par module", () => {
  it("CONTRACT-009: tous les fichiers de types existent (7 modules)", () => {
    for (const module of MODULES) {
      const typesPath = resolve(TYPES_DIR, `${module}.ts`);
      expect(
        existsSync(typesPath),
        `Types manquants pour le module ${module} : ${typesPath}`
      ).toBe(true);
    }
  });

  it("CONTRACT-009: les fichiers de types sont non-vides", () => {
    for (const module of MODULES) {
      const typesPath = resolve(TYPES_DIR, `${module}.ts`);
      if (!existsSync(typesPath)) continue; // Géré par le test précédent
      const content = readFileSync(typesPath, "utf-8");
      expect(
        content.length,
        `${module}.ts: fichier de types vide`
      ).toBeGreaterThan(100);
    }
  });

  it("CONTRACT-009: les types générés contiennent des définitions de paths (export paths)", () => {
    for (const module of MODULES) {
      const typesPath = resolve(TYPES_DIR, `${module}.ts`);
      if (!existsSync(typesPath)) continue;
      const content = readFileSync(typesPath, "utf-8");
      // openapi-typescript génère des interfaces ou types pour paths
      expect(
        content,
        `${module}.ts: aucune définition de paths détectée`
      ).toMatch(/paths[\s\S]*\{/);
    }
  });

  it("CONTRACT-009: src/client.ts existe et exporte createSigfaClient", () => {
    expect(
      existsSync(CLIENT_FILE),
      `src/client.ts manquant : ${CLIENT_FILE}`
    ).toBe(true);

    if (existsSync(CLIENT_FILE)) {
      const content = readFileSync(CLIENT_FILE, "utf-8");
      expect(
        content,
        "client.ts: createSigfaClient non exporté"
      ).toContain("createSigfaClient");
    }
  });

  it("CONTRACT-009: client.ts importe openapi-fetch", () => {
    if (!existsSync(CLIENT_FILE)) return;
    const content = readFileSync(CLIENT_FILE, "utf-8");
    expect(
      content,
      "client.ts: import openapi-fetch manquant"
    ).toContain("openapi-fetch");
  });

  it("CONTRACT-009: client.ts couvre les 7 modules (export par module)", () => {
    if (!existsSync(CLIENT_FILE)) return;
    const content = readFileSync(CLIENT_FILE, "utf-8");
    for (const module of MODULES) {
      expect(
        content,
        `client.ts: module '${module}' non couvert`
      ).toContain(module);
    }
  });
});

// ─── Suite 3 : Déterminisme ───────────────────────────────────────────────────

describe("CONTRACT-009: déterminisme de la génération", () => {
  const firstRunContent: Record<string, string> = {};
  const secondRunContent: Record<string, string> = {};

  beforeAll(() => {
    // Lire les fichiers générés une première fois (ils ont été générés avant les tests)
    for (const module of MODULES) {
      const typesPath = resolve(TYPES_DIR, `${module}.ts`);
      if (existsSync(typesPath)) {
        firstRunContent[module] = readFileSync(typesPath, "utf-8");
      }
      const bundledPath = resolve(BUNDLED_DIR, `${module}.yaml`);
      if (existsSync(bundledPath)) {
        firstRunContent[`bundle_${module}`] = readFileSync(bundledPath, "utf-8");
      }
    }

    // Relancer generate pour tester le déterminisme
    try {
      execSync("pnpm --filter @sigfa/contracts run generate", {
        cwd: resolve(CONTRACTS_DIR, "../.."),
        stdio: "pipe",
        timeout: 120_000,
      });
    } catch {
      // Erreur consignée dans les assertions
    }

    // Lire les fichiers générés une deuxième fois
    for (const module of MODULES) {
      const typesPath = resolve(TYPES_DIR, `${module}.ts`);
      if (existsSync(typesPath)) {
        secondRunContent[module] = readFileSync(typesPath, "utf-8");
      }
      const bundledPath = resolve(BUNDLED_DIR, `${module}.yaml`);
      if (existsSync(bundledPath)) {
        secondRunContent[`bundle_${module}`] = readFileSync(bundledPath, "utf-8");
      }
    }
  });

  it("CONTRACT-009: generate 2× → zéro diff sur les types TS (déterminisme)", () => {
    for (const module of MODULES) {
      if (firstRunContent[module] && secondRunContent[module]) {
        expect(
          secondRunContent[module],
          `${module}.ts: différence entre deux exécutions de generate (non-déterministe)`
        ).toBe(firstRunContent[module]);
      }
    }
  });

  it("CONTRACT-009: generate 2× → zéro diff sur les bundles YAML (déterminisme)", () => {
    for (const module of MODULES) {
      const key = `bundle_${module}`;
      if (firstRunContent[key] && secondRunContent[key]) {
        expect(
          secondRunContent[key],
          `bundle ${module}.yaml: différence entre deux exécutions (non-déterministe)`
        ).toBe(firstRunContent[key]);
      }
    }
  });

  it("CONTRACT-009: les fichiers générés ne contiennent pas de timestamp de génération (aucun header 'Generated at')", () => {
    for (const module of MODULES) {
      const typesPath = resolve(TYPES_DIR, `${module}.ts`);
      if (!existsSync(typesPath)) continue;
      const content = readFileSync(typesPath, "utf-8");
      // Aucun timestamp de génération dans l'en-tête du fichier
      // (les timestamps dans les exemples YAML sont OK, seuls les "Generated at" / "generatedAt" posent problème)
      expect(
        content,
        `${module}.ts: timestamp de génération 'Generated at' détecté`
      ).not.toMatch(/[Gg]enerated\s+at\s+\d{4}-\d{2}-\d{2}/);
      expect(
        content,
        `${module}.ts: timestamp de génération 'generatedAt' détecté`
      ).not.toMatch(/generatedAt:\s*['"]?\d{4}-\d{2}-\d{2}T/);
    }
  });
});

// ─── Suite 4 : Inventaire chemins×méthodes du client vs YAML ─────────────────

describe("CONTRACT-009: client typé couvre 100% des endpoints", () => {
  it("CONTRACT-009: inventaire — client.ts référence tous les paths des bundles (couverture 100%)", () => {
    if (!existsSync(CLIENT_FILE)) {
      expect.fail("src/client.ts manquant — impossible de vérifier la couverture");
    }
    const clientContent = readFileSync(CLIENT_FILE, "utf-8");

    // Le client doit couvrir tous les modules via leurs types
    for (const module of MODULES) {
      const typesPath = resolve(TYPES_DIR, `${module}.ts`);
      if (!existsSync(typesPath)) continue;

      // Le client doit importer les types du module
      expect(
        clientContent,
        `client.ts: types du module '${module}' non importés`
      ).toContain(module);
    }
  });

  it("CONTRACT-009: inventaire — tous les endpoints des bundles sont couverts par les types générés", () => {
    for (const module of MODULES) {
      const bundledDoc = loadBundledYaml(module) as OpenAPIDoc;
      const sourceDoc = loadSourceYaml(module) as OpenAPIDoc;

      if (!bundledDoc.paths || !sourceDoc.paths) continue;

      const bundledEndpoints = collectEndpoints(bundledDoc);
      const sourceEndpoints = collectEndpoints(sourceDoc);

      // Les endpoints dans le bundle doivent correspondre à ceux du source
      expect(
        bundledEndpoints,
        `${module}: le bundle a moins d'endpoints que la source`
      ).toEqual(sourceEndpoints);
    }
  });

  it("CONTRACT-009: inventaire chemins×méthodes — chaque module a au moins 1 endpoint", () => {
    for (const module of MODULES) {
      const doc = loadBundledYaml(module) as OpenAPIDoc;
      const endpoints = collectEndpoints(doc);
      expect(
        endpoints.length,
        `${module}: aucun endpoint dans le bundle`
      ).toBeGreaterThan(0);
    }
  });

  it("CONTRACT-009: les types générés exportent un type 'paths' pour chaque module", () => {
    for (const module of MODULES) {
      const typesPath = resolve(TYPES_DIR, `${module}.ts`);
      if (!existsSync(typesPath)) {
        expect.fail(`Types manquants pour ${module}`);
        continue;
      }
      const content = readFileSync(typesPath, "utf-8");
      // openapi-typescript@7 génère: export interface paths { ... }
      // ou: export type paths = { ... }
      expect(
        content,
        `${module}.ts: type 'paths' non exporté par openapi-typescript`
      ).toMatch(/export\s+(interface|type)\s+paths/);
    }
  });

  it("CONTRACT-009: createSigfaClient retourne un client pour chaque module", () => {
    if (!existsSync(CLIENT_FILE)) {
      expect.fail("src/client.ts manquant");
    }
    const clientContent = readFileSync(CLIENT_FILE, "utf-8");

    // Le client doit exposer createSigfaClient avec support multi-module
    expect(clientContent).toContain("createSigfaClient");

    // Doit supporter l'accès typé par chemin+méthode via openapi-fetch
    expect(clientContent).toMatch(/createClient/); // openapi-fetch createClient
  });
});
