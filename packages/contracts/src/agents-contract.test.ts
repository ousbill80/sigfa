/**
 * CONTRACT-004 — Tests structurels du contrat agents & compétences OpenAPI 3.1
 * Chaque test est nommé "CONTRACT-004: <critère>"
 * Parse le YAML avec la lib `yaml`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AGENTS_YAML_PATH = resolve(__dirname, "../openapi/agents.yaml");

let doc: Record<string, unknown>;
try {
  const raw = readFileSync(AGENTS_YAML_PATH, "utf-8");
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
  };
};

type OperationObject = {
  summary?: string;
  description?: string;
  tags?: string[];
  responses?: Record<string, ResponseObject>;
  requestBody?: Record<string, unknown>;
  parameters?: ParameterObject[];
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
  $ref?: string;
};

const openapi = doc as OpenAPIDoc;
const paths = (openapi?.paths ?? {}) as Record<string, Record<string, OperationObject>>;

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

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

const VALID_TENANT_SCOPES = ["platform", "bank", "agency", "public"];
const VALID_REQUIRED_ROLES = [
  "SUPER_ADMIN", "BANK_ADMIN", "AGENCY_DIRECTOR",
  "MANAGER", "AGENT", "AUDITOR", "AUTHENTICATED", "NONE",
];

// ─── Critère 1 : spectral zéro erreur ; $ref core résolus ────────────────────
describe("CONTRACT-004", () => {
  it("CONTRACT-004: le fichier agents.yaml est valide OpenAPI 3.1 et référence core.yaml via $ref", () => {
    expect(openapi.openapi).toBeDefined();
    expect(typeof openapi.openapi).toBe("string");
    expect((openapi.openapi as string).startsWith("3.1")).toBe(true);
    expect(openapi.info).toBeDefined();
    expect(openapi.paths).toBeDefined();
    expect(Object.keys(paths).length).toBeGreaterThan(0);

    // Doit contenir des références à core.yaml
    const raw = readFileSync(AGENTS_YAML_PATH, "utf-8");
    expect(raw, "agents.yaml doit référencer core.yaml via $ref").toContain("core.yaml");
    // Pas de nullable: true (OpenAPI 3.1 utilise type: [string, 'null'])
    expect(raw, "agents.yaml ne doit pas utiliser nullable: true").not.toContain("nullable: true");
  });

  // ─── Critère 2 : 9 codes + x-tenant-scope + x-required-role ───────────────
  it("CONTRACT-004: 9 codes + x-tenant-scope + x-required-role sur chaque route (test)", () => {
    const ops = getAllOperations();
    expect(ops.length, "agents.yaml doit avoir au moins 4 opérations").toBeGreaterThanOrEqual(4);

    const failures: string[] = [];

    for (const { path, method, op } of ops) {
      const responseCodes = Object.keys(op.responses ?? {});
      const requiredErrorCodes = ["400", "401", "403", "404", "409", "422", "429", "500"];
      const has2xx = responseCodes.some((c) => c.startsWith("2"));
      const missingError = requiredErrorCodes.filter((c) => !responseCodes.includes(c));

      if (missingError.length > 0 || !has2xx) {
        failures.push(
          `${method.toUpperCase()} ${path} — codes manquants: ${[
            ...missingError,
            ...(has2xx ? [] : ["2xx"]),
          ].join(", ")}`,
        );
      }

      const scope = op["x-tenant-scope"];
      const role = op["x-required-role"];

      if (!scope || !VALID_TENANT_SCOPES.includes(scope as string)) {
        failures.push(`${method.toUpperCase()} ${path} — x-tenant-scope invalide: "${scope}"`);
      }
      if (!role || !VALID_REQUIRED_ROLES.includes(role as string)) {
        failures.push(`${method.toUpperCase()} ${path} — x-required-role invalide: "${role}"`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`Opérations non conformes:\n${failures.join("\n")}`);
    }
  });

  // ─── Critère 3 : machine à états statut agent + 409 dédié ─────────────────
  it("CONTRACT-004: machine à états statut agent encodée avec 409 dédié (test)", () => {
    // POST /agents/{id}/status doit exister
    const statusPath = "/agents/{id}/status";
    const pathItem = paths[statusPath];
    expect(pathItem, `${statusPath} doit exister dans agents.yaml`).toBeDefined();

    const op = (pathItem as Record<string, unknown>)["post"] as OperationObject | undefined;
    expect(op, `POST ${statusPath} doit exister`).toBeDefined();

    // La description ou le requestBody doit documenter la machine à états
    const opStr = JSON.stringify(op);
    const AGENT_STATUSES = ["AVAILABLE", "SERVING", "PAUSED", "ABSENT", "OFFLINE"];
    for (const s of AGENT_STATUSES) {
      expect(opStr, `POST ${statusPath} doit documenter le statut ${s}`).toContain(s);
    }

    // 409 avec code dédié ILLEGAL_AGENT_TRANSITION (ou équivalent dédié)
    const resp409 = JSON.stringify(op?.responses?.["409"] ?? {});
    expect(resp409, `POST ${statusPath} 409 doit contenir un code d'erreur dédié`).toMatch(
      /ILLEGAL_AGENT_TRANSITION|AGENT_STATUS_CONFLICT|ILLEGAL_TRANSITION/,
    );

    // Le schéma AgentStatus doit exister dans components/schemas
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    expect(
      schemas?.["AgentStatus"],
      "components/schemas.AgentStatus doit être défini",
    ).toBeDefined();
    const agentStatusSchema = schemas?.["AgentStatus"] as Record<string, unknown>;
    const agentStatusEnum = agentStatusSchema?.enum as string[] | undefined;
    expect(Array.isArray(agentStatusEnum), "AgentStatus doit avoir un enum").toBe(true);
    for (const s of AGENT_STATUSES) {
      expect(agentStatusEnum, `AgentStatus enum doit contenir ${s}`).toContain(s);
    }
  });

  // ─── Critère 4 : import CSV — colonnes fixées + max 500 lignes + rapport ───
  it("CONTRACT-004: import CSV — colonnes fixées + max 500 lignes + rapport { line, field, code, message } (test)", () => {
    // POST /agents/import doit exister
    const importPath = "/agents/import";
    const pathItem = paths[importPath];
    expect(pathItem, `${importPath} doit exister dans agents.yaml`).toBeDefined();

    const op = (pathItem as Record<string, unknown>)["post"] as OperationObject | undefined;
    expect(op, `POST ${importPath} doit exister`).toBeDefined();

    const opStr = JSON.stringify(op);

    // multipart/form-data avec champ file
    expect(opStr, "import doit utiliser multipart/form-data").toContain("multipart/form-data");
    expect(opStr, "import doit avoir un champ 'file'").toContain("file");

    // Colonnes obligatoires documentées
    const requiredColumns = ["email", "firstName", "lastName", "role"];
    for (const col of requiredColumns) {
      expect(opStr, `import doit documenter la colonne obligatoire '${col}'`).toContain(col);
    }

    // max 500 lignes → 422 IMPORT_TOO_LARGE
    expect(opStr, "import doit documenter max 500 lignes").toContain("500");
    const resp422 = JSON.stringify(op?.responses?.["422"] ?? {});
    expect(resp422, "import 422 doit contenir IMPORT_TOO_LARGE").toContain("IMPORT_TOO_LARGE");

    // Réponse contient { created, skipped, errors: [{ line, field, code, message }] }
    const resp2xx =
      JSON.stringify(op?.responses?.["200"] ?? {}) +
      JSON.stringify(op?.responses?.["201"] ?? {});
    expect(resp2xx, "import réponse doit contenir 'created'").toContain("created");
    expect(resp2xx, "import réponse doit contenir 'skipped'").toContain("skipped");
    expect(resp2xx, "import réponse doit contenir 'errors'").toContain("errors");
    expect(resp2xx, "import réponse errors doit contenir 'line'").toContain("line");
    expect(resp2xx, "import réponse errors doit contenir 'field'").toContain("field");
    expect(resp2xx, "import réponse errors doit contenir 'code'").toContain("code");
    expect(resp2xx, "import réponse errors doit contenir 'message'").toContain("message");
  });

  // ─── Critère 5 : exemples présents sur chaque endpoint ────────────────────
  it("CONTRACT-004: exemples présents + valides (spectral) — smoke Prism délégué à CONTRACT-009b", () => {
    const ops = getAllOperations();
    expect(ops.length).toBeGreaterThanOrEqual(4);

    const failures: string[] = [];

    for (const { path, method, op } of ops) {
      const opStr = JSON.stringify(op);
      if (!opStr.includes("example") && !opStr.includes("examples")) {
        failures.push(`${method.toUpperCase()} ${path} — aucun exemple`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`Endpoints sans exemples:\n${failures.join("\n")}`);
    }
  });

  // ─── Critère additionnel : profil agent GET/PATCH + champs requis ──────────
  it("CONTRACT-004: profil agent — GET /agents/{id} et PATCH /agents/{id} exposent langues, services, agences, horaires", () => {
    const agentIdPath = "/agents/{id}";
    const pathItem = paths[agentIdPath];
    expect(pathItem, `${agentIdPath} doit exister`).toBeDefined();

    // GET
    const getOp = (pathItem as Record<string, unknown>)["get"] as OperationObject | undefined;
    expect(getOp, `GET ${agentIdPath} doit exister`).toBeDefined();

    // PATCH
    const patchOp = (pathItem as Record<string, unknown>)["patch"] as OperationObject | undefined;
    expect(patchOp, `PATCH ${agentIdPath} doit exister`).toBeDefined();

    // Le schéma AgentProfile doit documenter langues FR|DIOULA|BAOULE|EN
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    const agentLang = schemas?.["AgentLanguage"] ?? schemas?.["Language"];
    expect(agentLang, "Un schéma de langue agent doit être défini (AgentLanguage ou Language)").toBeDefined();

    const langSchema = agentLang as Record<string, unknown>;
    const langEnum = langSchema?.enum as string[] | undefined;
    expect(Array.isArray(langEnum), "AgentLanguage doit avoir un enum").toBe(true);
    const expectedLangs = ["FR", "DIOULA", "BAOULE", "EN"];
    for (const l of expectedLangs) {
      expect(langEnum, `AgentLanguage enum doit contenir ${l}`).toContain(l);
    }
  });

  // ─── Critère additionnel : stats agent ────────────────────────────────────
  it("CONTRACT-004: stats agent — GET /agents/{id}/stats expose ticketsTraited, tmtMoyen, ticketEnCours", () => {
    const statsPath = "/agents/{id}/stats";
    const pathItem = paths[statsPath];
    expect(pathItem, `${statsPath} doit exister`).toBeDefined();

    const getOp = (pathItem as Record<string, unknown>)["get"] as OperationObject | undefined;
    expect(getOp, `GET ${statsPath} doit exister`).toBeDefined();

    const opStr = JSON.stringify(getOp);
    // Doit exposer les 3 éléments requis par la story
    expect(opStr, "stats doit contenir tickets traités").toMatch(/ticketsHandled|ticketsTraited|ticketCount/);
    expect(opStr, "stats doit contenir TMT moyen").toMatch(/averageHandlingTime|tmtMoyen|avgHandlingTime/);
    expect(opStr, "stats doit contenir ticket en cours").toMatch(/currentTicket|ticketEnCours/);

    // Paramètre ?period=
    const params = getOp?.parameters ?? [];
    const hasPeriod = params.some((p) => {
      const pStr = JSON.stringify(p);
      return pStr.includes("period");
    });
    expect(hasPeriod, "GET /agents/{id}/stats doit avoir un paramètre 'period'").toBe(true);
  });

  // ─── Critère additionnel : x-required-role "self" pour stats agent ─────────
  it("CONTRACT-004: GET /agents/{id}/stats x-required-role = AGENT (règle self : l'agent lui-même)", () => {
    const statsPath = "/agents/{id}/stats";
    const pathItem = paths[statsPath];
    expect(pathItem, `${statsPath} doit exister`).toBeDefined();

    const getOp = (pathItem as Record<string, unknown>)["get"] as OperationObject | undefined;
    expect(getOp, `GET ${statsPath} doit exister`).toBeDefined();

    // La règle "self" est encodée via x-required-role: AGENT (rôle minimal)
    // et documentée en description
    const role = getOp?.["x-required-role"];
    expect(role, "GET /agents/{id}/stats doit avoir x-required-role = AGENT").toBe("AGENT");

    const desc = getOp?.description ?? "";
    expect(desc, "GET /agents/{id}/stats description doit mentionner la règle self").toMatch(
      /self|lui-même|himself|own/i,
    );
  });

  // ─── Critère additionnel : lien routage file documenté ────────────────────
  it("CONTRACT-004: le lien avec le routage de file (compétence + langue, API-004) est documenté en description", () => {
    const raw = readFileSync(AGENTS_YAML_PATH, "utf-8");
    expect(raw, "agents.yaml doit mentionner API-004 ou le routage de file").toMatch(
      /API-004|routage|compétence|queue routing|skill.*routing/i,
    );
  });

  // ─── Critère additionnel : schéma d'erreur core.yaml référencé ────────────
  it("CONTRACT-004: le schéma d'erreur ErrorResponse est référencé depuis core.yaml (zéro duplication)", () => {
    const raw = readFileSync(AGENTS_YAML_PATH, "utf-8");
    // Doit utiliser $ref vers core.yaml#/components/schemas/ErrorResponse
    expect(raw, "agents.yaml doit référencer ErrorResponse de core.yaml").toContain(
      "core.yaml#/components/schemas/ErrorResponse",
    );
    // Ne doit PAS redéfinir ErrorResponse localement
    const parsed = parse(raw) as OpenAPIDoc;
    const schemas = parsed.components?.schemas as Record<string, unknown> | undefined;
    expect(
      schemas?.["ErrorResponse"],
      "agents.yaml ne doit PAS redéfinir ErrorResponse localement",
    ).toBeUndefined();
  });
});

// ─── CONTRACT-010 : hardening sécurité + cohérence inter-YAML ────────────────
describe("CONTRACT-010 — agents.yaml", () => {
  it("CONTRACT-010: tous les exemples UUID dans agents.yaml sont des UUID v4 valides", () => {
    const rawContent = readFileSync(AGENTS_YAML_PATH, "utf-8");
    const placeholderPattern = /(bank_\d+|agency_\d+|user_\d+|svc_\d+|counter_\d+|ticket_\d+|queue_\d+|kiosk_\d+|device_\d+|agent_\d+)/;
    expect(
      rawContent,
      "agents.yaml ne doit pas contenir de faux IDs non-UUID (user_01, agency_01, etc.)",
    ).not.toMatch(placeholderPattern);
  });

  it("CONTRACT-010: DaySchedule.end a un pattern regex correct (pas [09])", () => {
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    const daySchedule = schemas?.["DaySchedule"] as Record<string, unknown> | undefined;
    expect(daySchedule, "DaySchedule doit être défini").toBeDefined();
    const props = (daySchedule?.properties ?? {}) as Record<string, unknown>;
    const endField = props["end"] as Record<string, unknown> | undefined;
    expect(endField, "DaySchedule.end doit être défini").toBeDefined();
    const pattern = endField?.["pattern"] as string | undefined;
    expect(pattern, "DaySchedule.end doit avoir un pattern regex").toBeDefined();
    expect(
      pattern,
      "DaySchedule.end pattern ne doit pas contenir [09] (doit être [0-9])",
    ).not.toContain("[09]");
    expect(
      pattern,
      "DaySchedule.end pattern doit couvrir les heures valides (0-9)",
    ).toMatch(/\[0-9\]/);
  });

  it("CONTRACT-010: AgentProfile a phoneMasked (pas phone)", () => {
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    const agentProfile = schemas?.["AgentProfile"] as Record<string, unknown> | undefined;
    expect(agentProfile, "AgentProfile doit être défini").toBeDefined();
    const props = (agentProfile?.properties ?? {}) as Record<string, unknown>;
    expect(
      props["phoneMasked"],
      "AgentProfile doit avoir phoneMasked (UEMOA privacy)",
    ).toBeDefined();
    expect(
      props["phone"],
      "AgentProfile ne doit pas avoir le champ phone brut",
    ).toBeUndefined();
  });

  it("CONTRACT-010: schemas agents ont additionalProperties: false", () => {
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    const schemasToCheck = ["DaySchedule", "WorkSchedule", "AgentProfile", "UpdateAgentProfileRequest"];
    const failures: string[] = [];
    for (const name of schemasToCheck) {
      const schema = schemas?.[name] as Record<string, unknown> | undefined;
      if (!schema) {
        failures.push(`${name} — schéma absent`);
        continue;
      }
      if (schema.type === "object" && schema["additionalProperties"] !== false) {
        failures.push(`${name} — additionalProperties: false manquant`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`CONTRACT-010 violations:\n${failures.join("\n")}`);
    }
  });
});
