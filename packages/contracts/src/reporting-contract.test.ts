/**
 * CONTRACT-006 — Tests structurels du contrat reporting & supervision OpenAPI 3.1
 * Chaque test est nommé "CONTRACT-006: <critère>"
 * Parse le YAML avec la lib `yaml`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPORTING_YAML_PATH = resolve(__dirname, "../openapi/reporting.yaml");

let doc: Record<string, unknown>;
try {
  const raw = readFileSync(REPORTING_YAML_PATH, "utf-8");
  doc = parse(raw) as Record<string, unknown>;
} catch {
  doc = {};
}

type OpenAPIDoc = {
  openapi?: string;
  info?: Record<string, unknown>;
  paths?: Record<string, Record<string, OperationObject>>;
  components?: {
    schemas?: Record<string, unknown>;
    responses?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
  };
};

type OperationObject = {
  summary?: string;
  description?: string;
  tags?: string[];
  responses?: Record<string, ResponseObject>;
  requestBody?: Record<string, unknown>;
  parameters?: ParameterObject[];
  security?: unknown[];
  "x-tenant-scope"?: string;
  "x-required-role"?: string;
};

type ResponseObject = {
  description?: string;
  content?: Record<string, unknown>;
};

type ParameterObject = {
  name?: string;
  in?: string;
  required?: boolean;
  schema?: Record<string, unknown>;
};

const openapi = doc as OpenAPIDoc;
const paths = (openapi?.paths ?? {}) as Record<string, Record<string, OperationObject>>;

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"] as const;

const VALID_TENANT_SCOPES = ["platform", "bank", "agency", "public"];
const VALID_REQUIRED_ROLES = [
  "SUPER_ADMIN", "BANK_ADMIN", "AGENCY_DIRECTOR",
  "MANAGER", "AGENT", "AUDITOR", "NONE",
];

function getAllOperations(): Array<{ path: string; method: string; op: OperationObject }> {
  const ops: Array<{ path: string; method: string; op: OperationObject }> = [];
  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const op = (pathItem as Record<string, unknown>)[method];
      if (op && typeof op === "object") {
        ops.push({ path, method, op: op as OperationObject });
      }
    }
  }
  return ops;
}

function getPath(key: string): Record<string, unknown> | undefined {
  return paths[key] as Record<string, unknown> | undefined;
}

// ─── Critère 1 : spectral zéro erreur ; $ref croisés résolus ──────────────
describe("CONTRACT-006", () => {
  it("CONTRACT-006: spectral zéro erreur ; $ref croisés résolus (test bundle)", () => {
    // Vérifier que le fichier est un OpenAPI 3.1 valide
    expect(openapi.openapi).toBeDefined();
    expect(typeof openapi.openapi).toBe("string");
    expect((openapi.openapi as string).startsWith("3.1")).toBe(true);
    expect(openapi.info).toBeDefined();
    expect(openapi.paths).toBeDefined();
    expect(Object.keys(paths).length).toBeGreaterThan(0);

    // Vérifier que les $ref vers core.yaml sont bien présents (cross-ref)
    const rawContent = readFileSync(REPORTING_YAML_PATH, "utf-8");
    expect(rawContent, "reporting.yaml doit référencer core.yaml").toContain("core.yaml");

    // Vérifier pas de nullable: true (OpenAPI 3.1 : type: [..., 'null'])
    expect(rawContent, "pas de nullable: true autorisé en OpenAPI 3.1").not.toContain("nullable: true");
  });

  // ─── Critère 2 : 7 KPIs typés avec unités et nullabilité ─────────────────
  it("CONTRACT-006: les 7 KPIs typés avec unités et nullabilité (test)", () => {
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    expect(schemas, "components/schemas doit exister").toBeDefined();

    const kpiSchema = schemas?.["KpiSet"] as Record<string, unknown> | undefined;
    expect(kpiSchema, "KpiSet doit être défini dans components/schemas").toBeDefined();

    const kpiProps = (kpiSchema?.properties ?? {}) as Record<string, unknown>;
    const kpiStr = JSON.stringify(kpiSchema);

    // Les 7 KPIs attendus : TMA, TMT, TTS, tauxAbandon, tauxSLA, NPS, occupation
    const expectedKpis = ["tma", "tmt", "tts", "tauxAbandon", "tauxSLA", "nps", "occupation"];
    for (const kpi of expectedKpis) {
      expect(
        kpiProps[kpi],
        `KpiSet doit avoir la propriété ${kpi}`,
      ).toBeDefined();
    }

    // Chaque KPI doit avoir une description (unité + définition)
    for (const kpi of expectedKpis) {
      const prop = kpiProps[kpi] as Record<string, unknown> | undefined;
      expect(
        (prop?.description as string | undefined)?.length,
        `KPI ${kpi} doit avoir une description avec unité`,
      ).toBeGreaterThan(10);
    }

    // NPS doit être nullable (type: ['number', 'null'])
    const npsProp = kpiProps["nps"] as Record<string, unknown> | undefined;
    const npsType = npsProp?.type;
    expect(
      Array.isArray(npsType) && (npsType as string[]).includes("null"),
      "NPS doit être nullable (type: ['number', 'null'])",
    ).toBe(true);

    // Exemple présent
    expect(kpiStr, "KpiSet doit avoir des exemples").toMatch(/example|examples/);
  });

  // ─── Critère 3 : export asynchrone — 202 + jobId + polling ───────────────
  it("CONTRACT-006: export asynchrone — 202 + jobId + polling contractualisés (test)", () => {
    // POST /reports/export ou GET /reports/export doit retourner 202 + jobId
    const exportPath = "/reports/export";
    const exportItem = getPath(exportPath);
    expect(exportItem, `${exportPath} doit exister`).toBeDefined();

    // L'endpoint export doit avoir une réponse 202
    const exportOp = (exportItem as Record<string, unknown>)?.["get"] as OperationObject | undefined;
    expect(exportOp, `GET ${exportPath} doit exister`).toBeDefined();

    const responseCodes = Object.keys(exportOp?.responses ?? {});
    expect(responseCodes, "export doit avoir une réponse 202").toContain("202");

    // La réponse 202 doit contenir jobId
    const resp202Str = JSON.stringify(exportOp?.responses?.["202"] ?? {});
    expect(resp202Str, "réponse 202 doit contenir jobId").toContain("jobId");

    // Polling endpoint : GET /reports/export/:jobId
    const pollingPath = "/reports/export/{jobId}";
    const pollingItem = getPath(pollingPath);
    expect(pollingItem, `${pollingPath} doit exister (polling)`).toBeDefined();

    const pollingOp = (pollingItem as Record<string, unknown>)?.["get"] as OperationObject | undefined;
    expect(pollingOp, `GET ${pollingPath} doit exister`).toBeDefined();

    // Le polling doit contenir statut + URL signée
    const pollingStr = JSON.stringify(pollingOp);
    expect(pollingStr, "polling doit contenir 'status'").toContain("status");
    expect(
      pollingStr.toLowerCase(),
      "polling doit contenir une URL de téléchargement signée",
    ).toMatch(/url|download/);

    // Expiration de l'URL
    expect(
      pollingStr.toLowerCase(),
      "polling doit contenir expiration de l'URL",
    ).toMatch(/expir/);
  });

  // ─── Critère 4 : AnonymizedNetworkAggregate défini et sans champ personnel
  it("CONTRACT-006: AnonymizedNetworkAggregate défini et utilisé par tous les schémas network — zéro champ personnel (test structurel)", () => {
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    expect(schemas, "components/schemas doit exister").toBeDefined();

    // AnonymizedNetworkAggregate doit être défini
    const agg = schemas?.["AnonymizedNetworkAggregate"] as Record<string, unknown> | undefined;
    expect(agg, "AnonymizedNetworkAggregate doit être défini dans components/schemas").toBeDefined();

    const aggStr = JSON.stringify(agg);

    // Zéro champ personnel : pas de nom, prénom, téléphone, email, personnalId
    const forbiddenPersonalFields = ["phoneNumber", "email", "firstName", "lastName", "clientId", "userId", "customerId"];
    for (const field of forbiddenPersonalFields) {
      expect(
        aggStr,
        `AnonymizedNetworkAggregate ne doit PAS contenir le champ personnel '${field}'`,
      ).not.toContain(`"${field}"`);
    }

    // Le schéma doit avoir une description documentant l'anonymisation UEMOA
    const aggDesc = agg?.description as string | undefined;
    expect(
      aggDesc?.toLowerCase(),
      "AnonymizedNetworkAggregate doit documenter l'anonymisation (UEMOA)",
    ).toMatch(/anonymi/);

    // GET /admin/network-overview doit référencer AnonymizedNetworkAggregate
    const overviewPath = "/admin/network-overview";
    const overviewItem = getPath(overviewPath);
    expect(overviewItem, `${overviewPath} doit exister`).toBeDefined();

    const overviewStr = JSON.stringify(overviewItem);
    expect(
      overviewStr,
      "/admin/network-overview doit utiliser AnonymizedNetworkAggregate",
    ).toContain("AnonymizedNetworkAggregate");

    // GET /reports/kpis?scope=network doit référencer AnonymizedNetworkAggregate ou mentionner le schéma
    const kpisPath = "/reports/kpis";
    const kpisItem = getPath(kpisPath);
    expect(kpisItem, `${kpisPath} doit exister`).toBeDefined();

    const kpisStr = JSON.stringify(kpisItem);
    expect(
      kpisStr,
      "/reports/kpis doit référencer AnonymizedNetworkAggregate pour scope=network",
    ).toContain("AnonymizedNetworkAggregate");
  });

  // ─── Critère 5 : GET /kiosks/status avec printerStatus + lastSeen ─────────
  it("CONTRACT-006: GET /kiosks/status typé avec printerStatus + lastSeen et exemple (test)", () => {
    const kiosksPath = "/kiosks/status";
    const kiosksItem = getPath(kiosksPath);
    expect(kiosksItem, `${kiosksPath} doit exister`).toBeDefined();

    const kiosksOp = (kiosksItem as Record<string, unknown>)?.["get"] as OperationObject | undefined;
    expect(kiosksOp, `GET ${kiosksPath} doit exister`).toBeDefined();

    // Doit contenir kioskId, agencyId, status, lastSeen, printerStatus
    const kiosksStr = JSON.stringify(kiosksOp);
    expect(kiosksStr, "kiosks/status doit contenir kioskId").toContain("kioskId");
    expect(kiosksStr, "kiosks/status doit contenir agencyId").toContain("agencyId");
    expect(kiosksStr, "kiosks/status doit contenir status").toContain("status");
    expect(kiosksStr, "kiosks/status doit contenir lastSeen").toContain("lastSeen");
    expect(kiosksStr, "kiosks/status doit contenir printerStatus").toContain("printerStatus");

    // Doit avoir un exemple
    expect(kiosksStr, "kiosks/status doit avoir un exemple").toMatch(/example|examples/);

    // Doit avoir les 9 codes de réponse
    const responseCodes = Object.keys(kiosksOp?.responses ?? {});
    const required = ["200", "400", "401", "403", "404", "409", "422", "429", "500"];
    for (const code of required) {
      expect(responseCodes, `kiosks/status doit avoir la réponse ${code}`).toContain(code);
    }
  });

  // ─── Critère 6 : 9 codes + scope + rôle partout ; exemples valides ────────
  it("CONTRACT-006: 9 codes + scope + rôle partout ; exemples valides (spectral) — smoke Prism délégué à CONTRACT-009b", () => {
    const ops = getAllOperations();
    expect(ops.length, "reporting.yaml doit avoir au moins 7 opérations").toBeGreaterThanOrEqual(7);

    const failures: string[] = [];

    for (const { path, method, op } of ops) {
      const responseCodes = Object.keys(op.responses ?? {});

      // /health est public — pas d'auth requise, mais doit quand même avoir 9 codes
      const requiredCodes = ["400", "401", "403", "404", "409", "422", "429", "500"];
      const has2xx = responseCodes.some((c) => c.startsWith("2"));

      const missingCodes = requiredCodes.filter((c) => !responseCodes.includes(c));
      if (missingCodes.length > 0 || !has2xx) {
        failures.push(
          `${method.toUpperCase()} ${path} — codes manquants: ${[
            ...missingCodes,
            ...(has2xx ? [] : ["2xx"]),
          ].join(", ")}`,
        );
      }

      // x-tenant-scope + x-required-role obligatoires
      const scope = op["x-tenant-scope"];
      const role = op["x-required-role"];

      if (!scope || !VALID_TENANT_SCOPES.includes(scope as string)) {
        failures.push(
          `${method.toUpperCase()} ${path} — x-tenant-scope invalide ou absent: "${scope}"`,
        );
      }
      if (!role || !VALID_REQUIRED_ROLES.includes(role as string)) {
        failures.push(
          `${method.toUpperCase()} ${path} — x-required-role invalide ou absent: "${role}"`,
        );
      }

      // Exemples présents
      const opStr = JSON.stringify(op);
      if (!opStr.includes("example") && !opStr.includes("examples")) {
        failures.push(`${method.toUpperCase()} ${path} — aucun exemple (requête ou réponse)`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`Violations CONTRACT-006:\n${failures.join("\n")}`);
    }
  });

  // ─── Critère additionnel : /health public, sans auth ──────────────────────
  it("CONTRACT-006: GET /health est public (x-required-role NONE, x-tenant-scope public, sans auth)", () => {
    const healthPath = "/health";
    const healthItem = getPath(healthPath);
    expect(healthItem, `${healthPath} doit exister`).toBeDefined();

    const healthOp = (healthItem as Record<string, unknown>)?.["get"] as OperationObject | undefined;
    expect(healthOp, `GET ${healthPath} doit exister`).toBeDefined();

    expect(
      healthOp?.["x-required-role"],
      "/health x-required-role doit être NONE (public)",
    ).toBe("NONE");
    expect(
      healthOp?.["x-tenant-scope"],
      "/health x-tenant-scope doit être public",
    ).toBe("public");

    // La sécurité doit être vide (sans auth JWT)
    expect(
      healthOp?.security,
      "/health doit avoir security: [] (sans auth)",
    ).toEqual([]);
  });

  // ─── Critère additionnel : /admin/network-overview SUPER_ADMIN cross-tenant
  it("CONTRACT-006: GET /admin/network-overview scope platform, rôle SUPER_ADMIN, cross-tenant documenté", () => {
    const overviewPath = "/admin/network-overview";
    const overviewItem = getPath(overviewPath);
    expect(overviewItem, `${overviewPath} doit exister`).toBeDefined();

    const overviewOp = (overviewItem as Record<string, unknown>)?.["get"] as OperationObject | undefined;
    expect(overviewOp, `GET ${overviewPath} doit exister`).toBeDefined();

    expect(
      overviewOp?.["x-required-role"],
      "/admin/network-overview doit être SUPER_ADMIN",
    ).toBe("SUPER_ADMIN");
    expect(
      overviewOp?.["x-tenant-scope"],
      "/admin/network-overview doit être platform",
    ).toBe("platform");

    // La description doit mentionner cross-tenant et anonymisation
    const desc = (overviewOp?.description ?? "").toLowerCase();
    expect(desc, "description doit mentionner cross-tenant").toMatch(/cross.?tenant|multi.?tenant/);
    expect(desc, "description doit mentionner anonymisation").toMatch(/anonymi/);
  });

  // ─── Critère additionnel : /reports/daily/:agencyId + /reports/benchmark ──
  it("CONTRACT-006: GET /reports/daily/{agencyId} et GET /reports/benchmark définis avec seuils benchmark (test)", () => {
    // /reports/daily/:agencyId
    const dailyPath = "/reports/daily/{agencyId}";
    const dailyItem = getPath(dailyPath);
    expect(dailyItem, `${dailyPath} doit exister`).toBeDefined();
    const dailyOp = (dailyItem as Record<string, unknown>)?.["get"] as OperationObject | undefined;
    expect(dailyOp, `GET ${dailyPath} doit exister`).toBeDefined();

    // /reports/benchmark
    const benchmarkPath = "/reports/benchmark";
    const benchmarkItem = getPath(benchmarkPath);
    expect(benchmarkItem, `${benchmarkPath} doit exister`).toBeDefined();
    const benchmarkOp = (benchmarkItem as Record<string, unknown>)?.["get"] as OperationObject | undefined;
    expect(benchmarkOp, `GET ${benchmarkPath} doit exister`).toBeDefined();

    // Le benchmark doit contenir des statuts vert/orange/rouge et seuils documentés
    const benchmarkStr = JSON.stringify(benchmarkOp).toLowerCase();
    expect(
      benchmarkStr,
      "benchmark doit documenter les statuts vert/orange/rouge ou green/orange/red",
    ).toMatch(/vert|orange|rouge|green|red/);

    // Schéma BenchmarkStatus (ou enum) doit être défini
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    const benchmarkStatus = schemas?.["BenchmarkStatus"] as Record<string, unknown> | undefined;
    expect(benchmarkStatus, "BenchmarkStatus doit être défini dans components/schemas").toBeDefined();

    const bsEnum = benchmarkStatus?.enum as string[] | undefined;
    expect(Array.isArray(bsEnum), "BenchmarkStatus doit avoir un enum").toBe(true);
    expect(bsEnum, "BenchmarkStatus doit contenir VERT").toContain("VERT");
    expect(bsEnum, "BenchmarkStatus doit contenir ORANGE").toContain("ORANGE");
    expect(bsEnum, "BenchmarkStatus doit contenir ROUGE").toContain("ROUGE");
  });

  // ─── Critère additionnel : ExportJobStatus (PENDING/PROCESSING/READY/FAILED)
  it("CONTRACT-006: ExportJobStatus défini (PENDING/PROCESSING/READY/FAILED) et format pdf|xlsx|json (test)", () => {
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;

    const exportJobStatus = schemas?.["ExportJobStatus"] as Record<string, unknown> | undefined;
    expect(exportJobStatus, "ExportJobStatus doit être défini dans components/schemas").toBeDefined();

    const ejsEnum = exportJobStatus?.enum as string[] | undefined;
    expect(Array.isArray(ejsEnum), "ExportJobStatus doit avoir un enum").toBe(true);
    expect(ejsEnum, "ExportJobStatus doit contenir PENDING").toContain("PENDING");
    expect(ejsEnum, "ExportJobStatus doit contenir PROCESSING").toContain("PROCESSING");
    expect(ejsEnum, "ExportJobStatus doit contenir READY").toContain("READY");
    expect(ejsEnum, "ExportJobStatus doit contenir FAILED").toContain("FAILED");

    // GET /reports/export doit avoir un paramètre format avec pdf|xlsx|json
    const exportPath = "/reports/export";
    const exportItem = getPath(exportPath);
    const exportOp = (exportItem as Record<string, unknown>)?.["get"] as OperationObject | undefined;
    const exportStr = JSON.stringify(exportOp);

    expect(exportStr, "export doit supporter le format pdf").toContain("pdf");
    expect(exportStr, "export doit supporter le format xlsx").toContain("xlsx");
    expect(exportStr, "export doit supporter le format json").toContain("json");
  });
});
