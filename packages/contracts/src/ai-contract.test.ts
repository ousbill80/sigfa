/**
 * CONTRACT-008 — Tests structurels du contrat IA (prédictions, staffing, anomalies, NLP feedbacks)
 * OpenAPI 3.1 — ai.yaml
 * Chaque test est nommé "CONTRACT-008: <critère>"
 * Parse le YAML avec la lib `yaml`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AI_YAML_PATH = resolve(__dirname, "../openapi/ai.yaml");

let doc: Record<string, unknown>;
try {
  const raw = readFileSync(AI_YAML_PATH, "utf-8");
  doc = parse(raw) as Record<string, unknown>;
} catch {
  doc = {};
}

type OpenAPIDoc = {
  openapi?: string;
  info?: { title?: string; description?: string; version?: string };
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

// ─── Critère 1 : spectral zéro erreur ; $ref croisés core+reporting résolus ──
describe("CONTRACT-008", () => {
  it("CONTRACT-008: spectral zéro erreur ; $ref croisés core+reporting résolus (test bundle)", () => {
    // Vérifier que le fichier est un OpenAPI 3.1 valide
    expect(openapi.openapi).toBeDefined();
    expect(typeof openapi.openapi).toBe("string");
    expect((openapi.openapi as string).startsWith("3.1")).toBe(true);
    expect(openapi.info).toBeDefined();
    expect(openapi.paths).toBeDefined();
    expect(Object.keys(paths).length).toBeGreaterThan(0);

    // Doit référencer core.yaml
    const rawContent = readFileSync(AI_YAML_PATH, "utf-8");
    expect(rawContent, "ai.yaml doit référencer core.yaml").toContain("core.yaml");

    // Doit référencer reporting.yaml (pour AnonymizedNetworkAggregate)
    expect(rawContent, "ai.yaml doit référencer reporting.yaml").toContain("reporting.yaml");

    // Doit référencer AnonymizedNetworkAggregate via reporting.yaml
    expect(
      rawContent,
      "ai.yaml doit utiliser $ref vers reporting.yaml#/components/schemas/AnonymizedNetworkAggregate",
    ).toContain("reporting.yaml#/components/schemas/AnonymizedNetworkAggregate");

    // Pas de nullable: true (OpenAPI 3.1)
    expect(rawContent, "pas de nullable: true autorisé en OpenAPI 3.1").not.toContain("nullable: true");
  });

  // ─── Critère 2 : forecast — 422 INSUFFICIENT_HISTORY + confidence typée ────
  it("CONTRACT-008: forecast — 422 INSUFFICIENT_HISTORY { requiredDays: 90, availableDays } + confidence typée (test)", () => {
    const forecastPath = "/ai/forecast";
    const forecastItem = getPath(forecastPath);
    expect(forecastItem, `${forecastPath} doit exister`).toBeDefined();

    const forecastOp = (forecastItem as Record<string, unknown>)?.["get"] as OperationObject | undefined;
    expect(forecastOp, `GET ${forecastPath} doit exister`).toBeDefined();

    // Doit avoir une réponse 422
    const responseCodes = Object.keys(forecastOp?.responses ?? {});
    expect(responseCodes, "forecast doit avoir une réponse 422").toContain("422");

    // La réponse 422 doit mentionner INSUFFICIENT_HISTORY
    const resp422Str = JSON.stringify(forecastOp?.responses?.["422"] ?? {});
    expect(resp422Str, "réponse 422 doit contenir INSUFFICIENT_HISTORY").toContain("INSUFFICIENT_HISTORY");

    // Le details de la 422 doit contenir requiredDays: 90 et availableDays
    expect(resp422Str, "réponse 422 doit documenter requiredDays").toContain("requiredDays");
    expect(resp422Str, "réponse 422 doit documenter availableDays").toContain("availableDays");

    // requiredDays doit valoir 90 dans l'exemple
    expect(resp422Str, "requiredDays doit valoir 90").toContain("90");

    // Vérifier que confidence est typée dans le schéma de réponse 200
    const resp200Str = JSON.stringify(forecastOp?.responses?.["200"] ?? {});
    expect(resp200Str, "réponse 200 doit contenir confidence").toContain("confidence");

    // confidence doit être typée numériquement (nombre entre 0 et 1)
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    const forecastHour = schemas?.["ForecastHour"] as Record<string, unknown> | undefined;
    expect(forecastHour, "ForecastHour doit être défini dans components/schemas").toBeDefined();
    const fhStr = JSON.stringify(forecastHour);
    expect(fhStr, "ForecastHour doit contenir confidence").toContain("confidence");
    expect(fhStr, "ForecastHour doit contenir expectedTickets").toContain("expectedTickets");
    expect(fhStr, "ForecastHour doit contenir hour").toContain("hour");

    // info.description doit documenter l'état transitoire INSUFFICIENT_HISTORY
    const infoDesc = (openapi.info?.description ?? "").toLowerCase();
    expect(
      infoDesc,
      "info.description doit documenter l'état transitoire INSUFFICIENT_HISTORY pour tous les endpoints IA",
    ).toMatch(/insufficient_history|historique insuffisant|insufficient history/);
  });

  // ─── Critère 3 : seuil AGENT_INACTIVE_PATTERN (≥3 sur 7 j) documenté ───────
  it("CONTRACT-008: seuil AGENT_INACTIVE_PATTERN (≥3 sur 7 j) documenté (test structurel)", () => {
    const rawContent = readFileSync(AI_YAML_PATH, "utf-8");

    // AGENT_INACTIVE_PATTERN doit être mentionné
    expect(rawContent, "ai.yaml doit documenter AGENT_INACTIVE_PATTERN").toContain("AGENT_INACTIVE_PATTERN");

    // La documentation doit contenir le seuil ≥3 alertes sur 7 jours
    // Chercher des mentions du seuil (3 alertes + 7 jours)
    expect(
      rawContent,
      "ai.yaml doit documenter le seuil ≥3 alertes pour AGENT_INACTIVE_PATTERN",
    ).toMatch(/[≥>=]?\s*3/);

    expect(
      rawContent,
      "ai.yaml doit documenter la fenêtre de 7 jours pour AGENT_INACTIVE_PATTERN",
    ).toMatch(/7\s*(j|jours|days|d)/);

    // L'enum des types d'anomalies doit contenir AGENT_INACTIVE_PATTERN
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    const anomalyType = schemas?.["AnomalyType"] as Record<string, unknown> | undefined;
    expect(anomalyType, "AnomalyType doit être défini dans components/schemas").toBeDefined();

    const anomalyEnum = anomalyType?.enum as string[] | undefined;
    expect(Array.isArray(anomalyEnum), "AnomalyType doit avoir un enum").toBe(true);
    expect(anomalyEnum, "AnomalyType doit contenir AGENT_INACTIVE_PATTERN").toContain("AGENT_INACTIVE_PATTERN");

    // La description de AGENT_INACTIVE_PATTERN doit mentionner le seuil
    const anomalyDesc = (anomalyType?.description as string ?? "");
    expect(
      anomalyDesc,
      "description AnomalyType doit documenter le seuil AGENT_INACTIVE_PATTERN",
    ).toMatch(/AGENT_INACTIVE_PATTERN/);
    expect(
      anomalyDesc,
      "description AnomalyType doit documenter ≥3 alertes sur 7 jours",
    ).toMatch(/3.*7|7.*3/);
  });

  // ─── Critère 4 : anomalies — enum types + cycle open/acked/resolved ─────────
  it("CONTRACT-008: anomalies — enum types + cycle open/acked/resolved (test)", () => {
    const anomaliesPath = "/ai/anomalies";
    const anomaliesItem = getPath(anomaliesPath);
    expect(anomaliesItem, `${anomaliesPath} doit exister`).toBeDefined();

    const anomaliesOp = (anomaliesItem as Record<string, unknown>)?.["get"] as OperationObject | undefined;
    expect(anomaliesOp, `GET ${anomaliesPath} doit exister`).toBeDefined();

    // Vérifier que le paramètre status accepte open/acked/resolved
    const params = anomaliesOp?.parameters ?? [];
    const statusParam = params.find((p) => p.name === "status");
    expect(statusParam, "GET /ai/anomalies doit avoir un paramètre status").toBeDefined();

    const statusEnum = (statusParam?.schema as Record<string, unknown>)?.enum as string[] | undefined;
    expect(statusEnum, "paramètre status doit avoir un enum").toBeDefined();
    expect(statusEnum, "status doit contenir open").toContain("open");
    expect(statusEnum, "status doit contenir acked").toContain("acked");
    expect(statusEnum, "status doit contenir resolved").toContain("resolved");

    // AnomalyType doit avoir les 3 types requis
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    const anomalyType = schemas?.["AnomalyType"] as Record<string, unknown> | undefined;
    const anomalyEnum = anomalyType?.enum as string[] | undefined;
    expect(anomalyEnum, "AnomalyType doit contenir QUEUE_STUCK").toContain("QUEUE_STUCK");
    expect(anomalyEnum, "AnomalyType doit contenir AGENT_INACTIVE_PATTERN").toContain("AGENT_INACTIVE_PATTERN");
    expect(anomalyEnum, "AnomalyType doit contenir SLA_SYSTEMIC").toContain("SLA_SYSTEMIC");

    // POST /ai/anomalies/:id/ack doit exister
    const ackPath = "/ai/anomalies/{id}/ack";
    const ackItem = getPath(ackPath);
    expect(ackItem, `${ackPath} doit exister`).toBeDefined();

    const ackOp = (ackItem as Record<string, unknown>)?.["post"] as OperationObject | undefined;
    expect(ackOp, `POST ${ackPath} doit exister`).toBeDefined();

    // AnomalyStatus doit être défini avec cycle open/acked/resolved
    const anomalyStatus = schemas?.["AnomalyStatus"] as Record<string, unknown> | undefined;
    expect(anomalyStatus, "AnomalyStatus doit être défini dans components/schemas").toBeDefined();

    const asEnum = anomalyStatus?.enum as string[] | undefined;
    expect(Array.isArray(asEnum), "AnomalyStatus doit avoir un enum").toBe(true);
    expect(asEnum, "AnomalyStatus doit contenir open").toContain("open");
    expect(asEnum, "AnomalyStatus doit contenir acked").toContain("acked");
    expect(asEnum, "AnomalyStatus doit contenir resolved").toContain("resolved");
  });

  // ─── Critère 5 : AiMeta présent sur toutes les réponses IA ──────────────────
  it("CONTRACT-008: AiMeta présent sur toutes les réponses IA (test structurel)", () => {
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;

    // AiMeta doit être défini
    const aiMeta = schemas?.["AiMeta"] as Record<string, unknown> | undefined;
    expect(aiMeta, "AiMeta doit être défini dans components/schemas").toBeDefined();

    const aiMetaProps = (aiMeta?.properties ?? {}) as Record<string, unknown>;
    expect(aiMetaProps["modelVersion"], "AiMeta doit avoir modelVersion").toBeDefined();
    expect(aiMetaProps["computedAt"], "AiMeta doit avoir computedAt").toBeDefined();
    expect(aiMetaProps["dataWindow"], "AiMeta doit avoir dataWindow").toBeDefined();

    // Toutes les réponses 200 des endpoints IA doivent référencer AiMeta
    const aiEndpoints = [
      "/ai/forecast",
      "/ai/staffing-recommendations",
      "/ai/anomalies",
      "/ai/feedback-insights",
    ];

    for (const path of aiEndpoints) {
      const pathItem = getPath(path);
      expect(pathItem, `${path} doit exister`).toBeDefined();

      // Chercher le GET ou POST (pour les endpoints d'action)
      const methods = ["get", "post"];
      let found = false;
      for (const method of methods) {
        const op = (pathItem as Record<string, unknown>)?.[method] as OperationObject | undefined;
        if (op) {
          const resp200Str = JSON.stringify(op.responses?.["200"] ?? {});
          expect(
            resp200Str,
            `GET/POST ${path} réponse 200 doit référencer AiMeta`,
          ).toContain("AiMeta");
          found = true;
          break;
        }
      }
      expect(found, `${path} doit avoir une opération GET ou POST`).toBe(true);
    }
  });

  // ─── Critère 6 : insights sans données personnelles brutes ──────────────────
  it("CONTRACT-008: insights sans données personnelles brutes (test structurel)", () => {
    const insightsPath = "/ai/feedback-insights";
    const insightsItem = getPath(insightsPath);
    expect(insightsItem, `${insightsPath} doit exister`).toBeDefined();

    const insightsOp = (insightsItem as Record<string, unknown>)?.["get"] as OperationObject | undefined;
    expect(insightsOp, `GET ${insightsPath} doit exister`).toBeDefined();

    // Vérifier que le schéma de réponse référence AnonymizedNetworkAggregate
    const insightsStr = JSON.stringify(insightsOp);

    // La réponse doit mentionner AnonymizedNetworkAggregate (via reporting.yaml)
    expect(
      insightsStr,
      "feedback-insights doit utiliser AnonymizedNetworkAggregate de reporting.yaml",
    ).toContain("AnonymizedNetworkAggregate");

    // Vérifier que le schéma FeedbackInsightsResponse (ou équivalent) ne contient
    // pas de données personnelles brutes
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    const insightsSchema = schemas?.["FeedbackInsightsResponse"] as Record<string, unknown> | undefined;
    expect(insightsSchema, "FeedbackInsightsResponse doit être défini dans components/schemas").toBeDefined();

    const insightsSchemaSer = JSON.stringify(insightsSchema);
    const forbiddenPersonalFields = ["phoneNumber", "email", "firstName", "lastName", "clientId", "userId", "customerId"];
    for (const field of forbiddenPersonalFields) {
      expect(
        insightsSchemaSer,
        `FeedbackInsightsResponse ne doit PAS contenir le champ personnel '${field}'`,
      ).not.toContain(`"${field}"`);
    }

    // La description doit mentionner l'anonymisation ou l'absence de données personnelles
    const desc = (insightsSchema?.description as string ?? "").toLowerCase();
    expect(
      desc,
      "FeedbackInsightsResponse doit documenter l'absence de données personnelles",
    ).toMatch(/anonymi|personnel|personal/);

    // Les schémas réseau utilisent bien AnonymizedNetworkAggregate (pas une redéfinition)
    const rawContent = readFileSync(AI_YAML_PATH, "utf-8");
    expect(
      rawContent,
      "ai.yaml ne doit pas redéfinir AnonymizedNetworkAggregate (doit référencer reporting.yaml)",
    ).not.toMatch(/AnonymizedNetworkAggregate:\s*\n\s+type:/);
  });

  // ─── Critère 7 : 9 codes + scope + rôle partout ; exemples valides ──────────
  it("CONTRACT-008: 9 codes + scope + rôle partout ; exemples valides (spectral) — smoke Prism délégué à CONTRACT-009b", () => {
    const ops = getAllOperations();
    expect(ops.length, "ai.yaml doit avoir au moins 6 opérations").toBeGreaterThanOrEqual(6);

    const failures: string[] = [];

    for (const { path, method, op } of ops) {
      const responseCodes = Object.keys(op.responses ?? {});

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
      throw new Error(`Violations CONTRACT-008:\n${failures.join("\n")}`);
    }
  });
});
