/**
 * MODEL-CONTRACT-A — Tests structurels du contrat Opérations (additif, non-breaking)
 * Chaque test est nommé "MODEL-CONTRACT-A: <critère>".
 *
 * Couvre :
 *  - Entité Operation (schéma, code regex, slaMinutes nullable, PAS de priority)
 *  - CRUD admin operations (core.yaml)
 *  - Liste publique borne (public.yaml)
 *  - operationId OPTIONNEL sur CreateTicketRequest / PublicTicketBase (serviceId reste required)
 *  - Réponse ticket gagne operationId? (nullable additif)
 *  - Codes d'erreur : OPERATION_NOT_FOUND, OPERATION_CODE_DUPLICATE, SERVICE_OPERATION_MISMATCH
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CORE_YAML_PATH = resolve(__dirname, "../openapi/core.yaml");
const PUBLIC_YAML_PATH = resolve(__dirname, "../openapi/public.yaml");

function loadDoc(path: string): Record<string, unknown> {
  try {
    return parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const coreRaw = (() => {
  try {
    return readFileSync(CORE_YAML_PATH, "utf-8");
  } catch {
    return "";
  }
})();

const core = loadDoc(CORE_YAML_PATH);
const publicDoc = loadDoc(PUBLIC_YAML_PATH);

type Doc = {
  paths?: Record<string, Record<string, OperationObject>>;
  components?: { schemas?: Record<string, unknown> };
};

type OperationObject = {
  responses?: Record<string, unknown>;
  parameters?: Array<Record<string, unknown>>;
  requestBody?: Record<string, unknown>;
  "x-tenant-scope"?: string;
  "x-required-role"?: string;
};

const corePaths = ((core as Doc).paths ?? {}) as Record<string, Record<string, OperationObject>>;
const coreSchemas = ((core as Doc).components?.schemas ?? {}) as Record<string, Record<string, unknown>>;
const publicPaths = ((publicDoc as Doc).paths ?? {}) as Record<string, Record<string, OperationObject>>;
const publicSchemas = ((publicDoc as Doc).components?.schemas ?? {}) as Record<string, Record<string, unknown>>;

const REQUIRED_ERROR_CODES = ["400", "401", "403", "404", "409", "422", "429", "500"];

function getOp(paths: Record<string, Record<string, OperationObject>>, path: string, method: string): OperationObject | undefined {
  return paths[path]?.[method];
}

// ─── 1. Entité Operation ──────────────────────────────────────────────────────
describe("MODEL-CONTRACT-A — entité Operation", () => {
  it("MODEL-CONTRACT-A: Operation schema défini (id, serviceId, code regex ^[A-Z0-9]{2,6}$, name, slaMinutes nullable, displayOrder, isActive, iconKey?)", () => {
    const op = coreSchemas["Operation"];
    expect(op, "Operation doit être défini dans core.yaml components/schemas").toBeDefined();

    const props = (op?.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = (op?.required ?? []) as string[];

    // Champs présents
    for (const field of ["id", "serviceId", "code", "name", "slaMinutes", "displayOrder", "isActive", "iconKey"]) {
      expect(props[field], `Operation doit avoir la propriété ${field}`).toBeDefined();
    }

    // id + serviceId format uuid
    expect(props["id"]?.["format"]).toBe("uuid");
    expect(props["serviceId"]?.["format"]).toBe("uuid");

    // code regex
    expect(props["code"]?.["pattern"], "Operation.code doit avoir le pattern ^[A-Z0-9]{2,6}$").toBe("^[A-Z0-9]{2,6}$");

    // slaMinutes nullable
    const slaType = props["slaMinutes"]?.["type"];
    expect(
      Array.isArray(slaType) ? (slaType as string[]).includes("null") : false,
      "Operation.slaMinutes doit être nullable (type ['integer','null'])",
    ).toBe(true);

    // displayOrder int
    expect(props["displayOrder"]?.["type"]).toBe("integer");
    // isActive bool
    expect(props["isActive"]?.["type"]).toBe("boolean");

    // Champs requis
    for (const field of ["id", "serviceId", "code", "name", "displayOrder", "isActive"]) {
      expect(required.includes(field), `Operation.required doit lister ${field}`).toBe(true);
    }
    // slaMinutes + iconKey NON requis (héritables / optionnels)
    expect(required.includes("slaMinutes"), "Operation.slaMinutes ne doit PAS être required (hérite du service)").toBe(false);
    expect(required.includes("iconKey"), "Operation.iconKey ne doit PAS être required").toBe(false);
  });

  it("MODEL-CONTRACT-A: Operation n'a AUCUNE propriété priority (D4 — la priorité reste l'enum porteur TicketPriority)", () => {
    const op = coreSchemas["Operation"];
    const props = (op?.properties ?? {}) as Record<string, unknown>;
    expect(props["priority"], "Operation ne doit PAS avoir de champ priority (D4)").toBeUndefined();

    const createReq = coreSchemas["CreateOperationRequest"];
    const createProps = (createReq?.properties ?? {}) as Record<string, unknown>;
    expect(createProps["priority"], "CreateOperationRequest ne doit PAS avoir de champ priority (D4)").toBeUndefined();

    const updateReq = coreSchemas["UpdateOperationRequest"];
    const updateProps = (updateReq?.properties ?? {}) as Record<string, unknown>;
    expect(updateProps["priority"], "UpdateOperationRequest ne doit PAS avoir de champ priority (D4)").toBeUndefined();
  });

  it("MODEL-CONTRACT-A: CreateOperationRequest additionalProperties:false + code required regex, slaMinutes nullable optionnel", () => {
    const req = coreSchemas["CreateOperationRequest"];
    expect(req, "CreateOperationRequest doit être défini").toBeDefined();
    expect(req?.["additionalProperties"], "CreateOperationRequest doit avoir additionalProperties:false").toBe(false);

    const props = (req?.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = (req?.required ?? []) as string[];
    expect(required.includes("code"), "CreateOperationRequest.code doit être required").toBe(true);
    expect(required.includes("name"), "CreateOperationRequest.name doit être required").toBe(true);
    expect(props["code"]?.["pattern"]).toBe("^[A-Z0-9]{2,6}$");

    // serviceId dérivé du path → ne doit pas être dans le corps
    expect(props["serviceId"], "CreateOperationRequest ne doit pas avoir serviceId (dérivé du path)").toBeUndefined();
  });

  it("MODEL-CONTRACT-A: UpdateOperationRequest additionalProperties:false, tous champs optionnels", () => {
    const req = coreSchemas["UpdateOperationRequest"];
    expect(req, "UpdateOperationRequest doit être défini").toBeDefined();
    expect(req?.["additionalProperties"]).toBe(false);
    const required = (req?.required ?? []) as string[];
    expect(required.length, "UpdateOperationRequest ne doit avoir aucun champ required").toBe(0);
  });
});

// ─── 2. CRUD admin operations ─────────────────────────────────────────────────
describe("MODEL-CONTRACT-A — CRUD admin operations (core.yaml)", () => {
  const CRUD = [
    { path: "/services/{serviceId}/operations", methods: ["get", "post"] },
    { path: "/operations/{id}", methods: ["get", "patch", "delete"] },
  ];

  it("MODEL-CONTRACT-A: routes CRUD admin operations existent (GET/POST /services/{serviceId}/operations, GET/PATCH/DELETE /operations/{id})", () => {
    for (const { path, methods } of CRUD) {
      expect(corePaths[path], `${path} doit exister dans core.yaml`).toBeDefined();
      for (const m of methods) {
        expect(getOp(corePaths, path, m), `${m.toUpperCase()} ${path} doit exister`).toBeDefined();
      }
    }
  });

  it("MODEL-CONTRACT-A: chaque route CRUD operations expose les 8 codes d'erreur + un 2xx, x-tenant-scope:agency, x-required-role cohérent (BANK_ADMIN|AGENCY_DIRECTOR)", () => {
    const failures: string[] = [];
    for (const { path, methods } of CRUD) {
      for (const m of methods) {
        const op = getOp(corePaths, path, m);
        if (!op) continue;
        const codes = Object.keys(op.responses ?? {});
        const missing = REQUIRED_ERROR_CODES.filter((c) => !codes.includes(c));
        const has2xx = codes.some((c) => c.startsWith("2"));
        if (missing.length || !has2xx) {
          failures.push(`${m.toUpperCase()} ${path} — codes manquants: ${[...missing, ...(has2xx ? [] : ["2xx"])].join(", ")}`);
        }
        if (op["x-tenant-scope"] !== "agency") {
          failures.push(`${m.toUpperCase()} ${path} — x-tenant-scope doit être 'agency' (a: ${op["x-tenant-scope"]})`);
        }
        const role = op["x-required-role"];
        if (role !== "BANK_ADMIN" && role !== "AGENCY_DIRECTOR") {
          failures.push(`${m.toUpperCase()} ${path} — x-required-role doit être BANK_ADMIN ou AGENCY_DIRECTOR (a: ${role})`);
        }
      }
    }
    if (failures.length) throw new Error(`CRUD operations non conformes:\n${failures.join("\n")}`);
  });

  it("MODEL-CONTRACT-A: POST /services/{serviceId}/operations documente 404 SERVICE_NOT_FOUND + 409 OPERATION_CODE_DUPLICATE", () => {
    const op = getOp(corePaths, "/services/{serviceId}/operations", "post");
    expect(op).toBeDefined();
    const resp404 = JSON.stringify(op?.responses?.["404"] ?? {});
    expect(resp404, "POST operations 404 doit référencer SERVICE_NOT_FOUND").toContain("SERVICE_NOT_FOUND");
    const resp409 = JSON.stringify(op?.responses?.["409"] ?? {});
    expect(resp409, "POST operations 409 doit documenter OPERATION_CODE_DUPLICATE").toContain("OPERATION_CODE_DUPLICATE");
  });

  it("MODEL-CONTRACT-A: GET/PATCH/DELETE /operations/{id} documentent 404 OPERATION_NOT_FOUND", () => {
    for (const m of ["get", "patch", "delete"]) {
      const op = getOp(corePaths, "/operations/{id}", m);
      const resp404 = JSON.stringify(op?.responses?.["404"] ?? {});
      expect(resp404, `${m.toUpperCase()} /operations/{id} 404 doit documenter OPERATION_NOT_FOUND`).toContain("OPERATION_NOT_FOUND");
    }
  });
});

// ─── 3. Liste publique borne ──────────────────────────────────────────────────
describe("MODEL-CONTRACT-A — liste publique borne (public.yaml)", () => {
  const PATH = "/public/agencies/{agencyId}/operations";

  it("MODEL-CONTRACT-A: GET /public/agencies/{agencyId}/operations?serviceId= existe, role NONE, scope public", () => {
    const op = getOp(publicPaths, PATH, "get");
    expect(op, `GET ${PATH} doit exister dans public.yaml`).toBeDefined();
    expect(op?.["x-required-role"], "liste publique operations doit avoir role NONE").toBe("NONE");
    expect(op?.["x-tenant-scope"], "liste publique operations doit avoir scope public").toBe("public");

    // query param serviceId
    const params = op?.parameters ?? [];
    const hasServiceId = params.some((p) => p["name"] === "serviceId" && p["in"] === "query");
    expect(hasServiceId, `GET ${PATH} doit exposer le query param serviceId`).toBe(true);
  });

  it("MODEL-CONTRACT-A: PublicOperation expose id, code, name, slaMinutes (RÉSOLU), iconKey? — pas de PII ni serviceId interne obligatoire", () => {
    const schema = publicSchemas["PublicOperation"];
    expect(schema, "PublicOperation doit être défini dans public.yaml").toBeDefined();
    const props = (schema?.properties ?? {}) as Record<string, unknown>;
    for (const field of ["id", "code", "name", "slaMinutes"]) {
      expect(props[field], `PublicOperation doit exposer ${field}`).toBeDefined();
    }
    // iconKey optionnel présent comme propriété
    expect(props["iconKey"], "PublicOperation doit déclarer iconKey (optionnel)").toBeDefined();
    // slaMinutes résolu → description doit mentionner la résolution
    const desc = JSON.stringify(schema);
    expect(desc, "PublicOperation.slaMinutes doit documenter la résolution opération?.service").toMatch(/résolu|resolu|hérit|herit|service/i);
  });
});

// ─── 4. operationId optionnel (rétrocompat, non-breaking) ─────────────────────
describe("MODEL-CONTRACT-A — operationId optionnel (D1, non-breaking)", () => {
  it("MODEL-CONTRACT-A: CreateTicketRequest gagne operationId OPTIONNEL ; serviceId reste required INCHANGÉ", () => {
    const schema = coreSchemas["CreateTicketRequest"];
    expect(schema).toBeDefined();
    const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = (schema?.required ?? []) as string[];

    expect(props["operationId"], "CreateTicketRequest doit avoir operationId").toBeDefined();
    expect(props["operationId"]?.["format"]).toBe("uuid");
    expect(required.includes("operationId"), "operationId ne doit PAS être required (additif)").toBe(false);

    // serviceId TOUJOURS required — jamais retiré (garant non-breaking)
    expect(required.includes("serviceId"), "serviceId doit RESTER required (non-breaking)").toBe(true);
  });

  it("MODEL-CONTRACT-A: PublicTicketBase gagne operationId OPTIONNEL ; serviceId reste required", () => {
    const schema = publicSchemas["PublicTicketBase"];
    expect(schema).toBeDefined();
    const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = (schema?.required ?? []) as string[];

    expect(props["operationId"], "PublicTicketBase doit avoir operationId").toBeDefined();
    expect(required.includes("operationId"), "operationId ne doit PAS être required").toBe(false);
    expect(required.includes("serviceId"), "PublicTicketBase.serviceId doit RESTER required").toBe(true);
  });

  it("MODEL-CONTRACT-A: TicketSyncItem gagne operationId OPTIONNEL ; serviceId reste required (offline-sync D8)", () => {
    const schema = coreSchemas["TicketSyncItem"];
    expect(schema).toBeDefined();
    const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = (schema?.required ?? []) as string[];
    expect(props["operationId"], "TicketSyncItem doit avoir operationId").toBeDefined();
    expect(required.includes("operationId"), "operationId ne doit PAS être required").toBe(false);
    expect(required.includes("serviceId"), "TicketSyncItem.serviceId doit RESTER required").toBe(true);
  });

  it("MODEL-CONTRACT-A: réponses ticket gagnent operationId? nullable additif (Ticket, TicketCreatedResponse, PublicTicketCreatedResponse, PublicTicketStatus)", () => {
    for (const name of ["Ticket", "TicketCreatedResponse"]) {
      const schema = coreSchemas[name];
      const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
      const required = (schema?.required ?? []) as string[];
      expect(props["operationId"], `${name} doit avoir operationId`).toBeDefined();
      expect(required.includes("operationId"), `${name}.operationId ne doit PAS être required (additif)`).toBe(false);
    }
    for (const name of ["PublicTicketCreatedResponse", "PublicTicketStatus"]) {
      const schema = publicSchemas[name];
      const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
      const required = (schema?.required ?? []) as string[];
      expect(props["operationId"], `${name} doit avoir operationId`).toBeDefined();
      expect(required.includes("operationId"), `${name}.operationId ne doit PAS être required`).toBe(false);
    }
  });
});

// ─── 5. Règle de résolution documentée + code SERVICE_OPERATION_MISMATCH ──────
describe("MODEL-CONTRACT-A — résolution operationId→serviceId & codes d'erreur", () => {
  it("MODEL-CONTRACT-A: CreateTicketRequest documente la règle operationId→serviceId dérivé + mismatch 422 SERVICE_OPERATION_MISMATCH", () => {
    const schema = coreSchemas["CreateTicketRequest"];
    const desc = JSON.stringify(schema);
    expect(desc, "CreateTicketRequest doit documenter operationId").toContain("operationId");
    expect(desc, "CreateTicketRequest doit documenter SERVICE_OPERATION_MISMATCH").toContain("SERVICE_OPERATION_MISMATCH");
  });

  it("MODEL-CONTRACT-A: POST /tickets documente 422 SERVICE_OPERATION_MISMATCH et 404 OPERATION_NOT_FOUND", () => {
    const op = getOp(corePaths, "/tickets", "post");
    const opStr = JSON.stringify(op);
    expect(opStr, "POST /tickets doit documenter SERVICE_OPERATION_MISMATCH").toContain("SERVICE_OPERATION_MISMATCH");
    expect(opStr, "POST /tickets doit documenter OPERATION_NOT_FOUND").toContain("OPERATION_NOT_FOUND");
  });

  it("MODEL-CONTRACT-A: les 3 codes d'erreur additifs sont présents dans core.yaml (OPERATION_NOT_FOUND, OPERATION_CODE_DUPLICATE, SERVICE_OPERATION_MISMATCH)", () => {
    for (const code of ["OPERATION_NOT_FOUND", "OPERATION_CODE_DUPLICATE", "SERVICE_OPERATION_MISMATCH"]) {
      expect(coreRaw, `core.yaml doit contenir le code ${code}`).toContain(code);
    }
  });
});

// ─── 6. Non-breaking : serviceId jamais retiré du required ────────────────────
describe("MODEL-CONTRACT-A — garde non-breaking (oasdiff vert)", () => {
  it("MODEL-CONTRACT-A: serviceId reste required sur TOUS les schémas de création (aucun passage required→optionnel)", () => {
    const cases: Array<[string, Record<string, Record<string, unknown>>]> = [
      ["CreateTicketRequest", coreSchemas],
      ["TicketSyncItem", coreSchemas],
      ["PublicTicketBase", publicSchemas],
    ];
    for (const [name, schemas] of cases) {
      const required = (schemas[name]?.required ?? []) as string[];
      expect(required.includes("serviceId"), `${name}.serviceId doit rester required (non-breaking)`).toBe(true);
    }
  });
});
