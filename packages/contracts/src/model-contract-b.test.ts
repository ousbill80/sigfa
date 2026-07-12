/**
 * MODEL-CONTRACT-B — Tests structurels du contrat Conseillers (additif, non-breaking)
 * Chaque test est nommé "MODEL-CONTRACT-B: <critère>".
 *
 * Couvre :
 *  - Flag conseiller sur User/AgentProfile (isRelationshipManager, displayName, photoUrl?) — additif
 *  - Route admin de marquage conseiller (PATCH profil agent, RBAC AGENCY_DIRECTOR+)
 *  - Liste publique NOMINATIVE zéro PII : GET /public/agencies/{agencyId}/relationship-managers
 *    → schéma exposant UNIQUEMENT { id, displayName, photoUrl? } (D5)
 *  - targetManagerId OPTIONNEL sur CreateTicketRequest / PublicTicketBase / TicketSyncItem (serviceId reste required)
 *  - Réponse ticket gagne targetManagerId? (nullable additif)
 *  - Code d'erreur : RELATIONSHIP_MANAGER_NOT_FOUND (404 opaque)
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
const AGENTS_YAML_PATH = resolve(__dirname, "../openapi/agents.yaml");

function loadDoc(path: string): Record<string, unknown> {
  try {
    return parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function rawOf(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

const core = loadDoc(CORE_YAML_PATH);
const publicDoc = loadDoc(PUBLIC_YAML_PATH);
const agentsDoc = loadDoc(AGENTS_YAML_PATH);
const publicRaw = rawOf(PUBLIC_YAML_PATH);

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
  security?: unknown;
};

const corePaths = ((core as Doc).paths ?? {}) as Record<string, Record<string, OperationObject>>;
const coreSchemas = ((core as Doc).components?.schemas ?? {}) as Record<string, Record<string, unknown>>;
const publicPaths = ((publicDoc as Doc).paths ?? {}) as Record<string, Record<string, OperationObject>>;
const publicSchemas = ((publicDoc as Doc).components?.schemas ?? {}) as Record<string, Record<string, unknown>>;
const agentSchemas = ((agentsDoc as Doc).components?.schemas ?? {}) as Record<string, Record<string, unknown>>;
const agentPaths = ((agentsDoc as Doc).paths ?? {}) as Record<string, Record<string, OperationObject>>;

function getOp(
  paths: Record<string, Record<string, OperationObject>>,
  path: string,
  method: string,
): OperationObject | undefined {
  return paths[path]?.[method];
}

// ─── 1. Flag conseiller sur le profil agent (additif) ─────────────────────────
describe("MODEL-CONTRACT-B — flag conseiller sur le profil agent", () => {
  it("MODEL-CONTRACT-B: AgentProfile gagne isRelationshipManager (bool) + displayName + photoUrl? — additifs, non required", () => {
    const schema = agentSchemas["AgentProfile"];
    expect(schema, "AgentProfile doit être défini").toBeDefined();
    const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = (schema?.required ?? []) as string[];

    expect(props["isRelationshipManager"], "AgentProfile doit avoir isRelationshipManager").toBeDefined();
    expect(props["isRelationshipManager"]?.["type"], "isRelationshipManager doit être boolean").toBe("boolean");
    expect(props["displayName"], "AgentProfile doit avoir displayName").toBeDefined();
    expect(props["photoUrl"], "AgentProfile doit avoir photoUrl").toBeDefined();

    // Additifs → JAMAIS required (non-breaking)
    for (const field of ["isRelationshipManager", "displayName", "photoUrl"]) {
      expect(required.includes(field), `${field} ne doit PAS être required (additif non-breaking)`).toBe(false);
    }
  });

  it("MODEL-CONTRACT-B: UpdateAgentProfileRequest gagne isRelationshipManager + displayName + photoUrl (config admin), additionalProperties:false préservé", () => {
    const schema = agentSchemas["UpdateAgentProfileRequest"];
    expect(schema, "UpdateAgentProfileRequest doit être défini").toBeDefined();
    expect(schema?.["additionalProperties"], "UpdateAgentProfileRequest doit garder additionalProperties:false").toBe(false);
    const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const field of ["isRelationshipManager", "displayName", "photoUrl"]) {
      expect(props[field], `UpdateAgentProfileRequest doit exposer ${field} (marquage conseiller)`).toBeDefined();
    }
    // aucun champ nouveau required
    const required = (schema?.required ?? []) as string[];
    expect(required.length, "UpdateAgentProfileRequest ne doit avoir aucun champ required").toBe(0);
  });

  it("MODEL-CONTRACT-B: PATCH /agents/{id} reste RBAC AGENCY_DIRECTOR (marquage conseiller aligné)", () => {
    const op = getOp(agentPaths, "/agents/{id}", "patch");
    expect(op, "PATCH /agents/{id} doit exister").toBeDefined();
    expect(op?.["x-required-role"], "PATCH /agents/{id} doit être AGENCY_DIRECTOR (RBAC conseiller)").toBe("AGENCY_DIRECTOR");
    expect(op?.["x-tenant-scope"]).toBe("agency");
  });
});

// ─── 2. Liste publique NOMINATIVE zéro PII (D5) ───────────────────────────────
describe("MODEL-CONTRACT-B — liste publique conseillers (zéro PII, D5)", () => {
  const PATH = "/public/agencies/{agencyId}/relationship-managers";

  it("MODEL-CONTRACT-B: GET /public/agencies/{agencyId}/relationship-managers existe, role NONE, scope public, sans auth", () => {
    const op = getOp(publicPaths, PATH, "get");
    expect(op, `GET ${PATH} doit exister dans public.yaml`).toBeDefined();
    expect(op?.["x-required-role"], "liste conseillers doit avoir role NONE").toBe("NONE");
    expect(op?.["x-tenant-scope"], "liste conseillers doit avoir scope public").toBe("public");
    expect(Array.isArray(op?.security) && (op?.security as unknown[]).length === 0, "security doit être [] (public)").toBe(true);

    const params = op?.parameters ?? [];
    const hasAgencyId = params.some((p) => p["name"] === "agencyId" && p["in"] === "path");
    expect(hasAgencyId, `GET ${PATH} doit exposer le path param agencyId`).toBe(true);
  });

  it("MODEL-CONTRACT-B: PublicRelationshipManager expose UNIQUEMENT id, displayName, photoUrl? — ZÉRO PII", () => {
    const schema = publicSchemas["PublicRelationshipManager"];
    expect(schema, "PublicRelationshipManager doit être défini dans public.yaml").toBeDefined();

    const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
    const propNames = Object.keys(props).sort();

    // EXACTEMENT ces 3 champs, ni plus ni moins
    expect(propNames, "PublicRelationshipManager ne doit exposer QUE id/displayName/photoUrl").toEqual([
      "displayName",
      "id",
      "photoUrl",
    ]);

    // id requis, displayName requis, photoUrl optionnel
    const required = (schema?.required ?? []) as string[];
    expect(required.includes("id"), "id doit être required").toBe(true);
    expect(required.includes("displayName"), "displayName doit être required").toBe(true);
    expect(required.includes("photoUrl"), "photoUrl NE doit PAS être required (optionnel)").toBe(false);

    expect(props["id"]?.["format"]).toBe("uuid");

    // additionalProperties:false → aucune fuite possible
    expect(schema?.["additionalProperties"], "PublicRelationshipManager doit avoir additionalProperties:false (garde anti-PII)").toBe(false);
  });

  it("MODEL-CONTRACT-B: PublicRelationshipManager n'expose AUCUNE PII (email/role/phone/agencyId/bankId/serviceIds)", () => {
    const schema = publicSchemas["PublicRelationshipManager"];
    const props = (schema?.properties ?? {}) as Record<string, unknown>;
    for (const forbidden of ["email", "role", "phone", "phoneNumber", "phoneMasked", "agencyId", "bankId", "serviceIds", "languages", "status"]) {
      expect(props[forbidden], `PublicRelationshipManager NE doit PAS exposer ${forbidden} (PII/interne, D5)`).toBeUndefined();
    }
  });

  it("MODEL-CONTRACT-B: PublicRelationshipManagerListResponse enveloppe une liste de PublicRelationshipManager", () => {
    const schema = publicSchemas["PublicRelationshipManagerListResponse"];
    expect(schema, "PublicRelationshipManagerListResponse doit être défini").toBeDefined();
    const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
    expect(props["data"], "doit avoir data[]").toBeDefined();
    expect(props["data"]?.["type"]).toBe("array");
    const items = props["data"]?.["items"] as Record<string, unknown> | undefined;
    expect(JSON.stringify(items), "data.items doit référencer PublicRelationshipManager").toContain("PublicRelationshipManager");
  });

  it("MODEL-CONTRACT-B: la route conseillers documente le filtre implicite (actifs) et zéro-PII", () => {
    const op = getOp(publicPaths, PATH, "get");
    const desc = JSON.stringify(op);
    expect(desc, "la route doit documenter le filtre conseillers actifs").toMatch(/actif|active|is_active|isActive/i);
  });
});

// ─── 3. targetManagerId optionnel (D6, non-breaking) ──────────────────────────
describe("MODEL-CONTRACT-B — targetManagerId optionnel (D6, non-breaking)", () => {
  it("MODEL-CONTRACT-B: CreateTicketRequest gagne targetManagerId OPTIONNEL (uuid) ; serviceId reste required INCHANGÉ", () => {
    const schema = coreSchemas["CreateTicketRequest"];
    expect(schema).toBeDefined();
    const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = (schema?.required ?? []) as string[];

    expect(props["targetManagerId"], "CreateTicketRequest doit avoir targetManagerId").toBeDefined();
    expect(props["targetManagerId"]?.["format"]).toBe("uuid");
    expect(required.includes("targetManagerId"), "targetManagerId ne doit PAS être required (additif)").toBe(false);

    // serviceId TOUJOURS required — jamais retiré
    expect(required.includes("serviceId"), "serviceId doit RESTER required (non-breaking)").toBe(true);
  });

  it("MODEL-CONTRACT-B: PublicTicketBase gagne targetManagerId OPTIONNEL ; serviceId reste required", () => {
    const schema = publicSchemas["PublicTicketBase"];
    expect(schema).toBeDefined();
    const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = (schema?.required ?? []) as string[];

    expect(props["targetManagerId"], "PublicTicketBase doit avoir targetManagerId").toBeDefined();
    expect(required.includes("targetManagerId"), "targetManagerId ne doit PAS être required").toBe(false);
    expect(required.includes("serviceId"), "PublicTicketBase.serviceId doit RESTER required").toBe(true);
  });

  it("MODEL-CONTRACT-B: TicketSyncItem gagne targetManagerId OPTIONNEL ; serviceId reste required (offline-sync)", () => {
    const schema = coreSchemas["TicketSyncItem"];
    expect(schema).toBeDefined();
    const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = (schema?.required ?? []) as string[];
    expect(props["targetManagerId"], "TicketSyncItem doit avoir targetManagerId").toBeDefined();
    expect(required.includes("targetManagerId"), "targetManagerId ne doit PAS être required").toBe(false);
    expect(required.includes("serviceId"), "TicketSyncItem.serviceId doit RESTER required").toBe(true);
  });

  it("MODEL-CONTRACT-B: réponses ticket gagnent targetManagerId? nullable additif (Ticket, TicketCreatedResponse, PublicTicketCreatedResponse, PublicTicketStatus)", () => {
    for (const name of ["Ticket", "TicketCreatedResponse"]) {
      const schema = coreSchemas[name];
      const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
      const required = (schema?.required ?? []) as string[];
      expect(props["targetManagerId"], `${name} doit avoir targetManagerId`).toBeDefined();
      const t = props["targetManagerId"]?.["type"];
      expect(
        Array.isArray(t) ? (t as string[]).includes("null") : false,
        `${name}.targetManagerId doit être nullable`,
      ).toBe(true);
      expect(required.includes("targetManagerId"), `${name}.targetManagerId ne doit PAS être required (additif)`).toBe(false);
    }
    for (const name of ["PublicTicketCreatedResponse", "PublicTicketStatus"]) {
      const schema = publicSchemas[name];
      const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
      const required = (schema?.required ?? []) as string[];
      expect(props["targetManagerId"], `${name} doit avoir targetManagerId`).toBeDefined();
      expect(required.includes("targetManagerId"), `${name}.targetManagerId ne doit PAS être required`).toBe(false);
    }
  });
});

// ─── 4. Code d'erreur RELATIONSHIP_MANAGER_NOT_FOUND ──────────────────────────
describe("MODEL-CONTRACT-B — code d'erreur RELATIONSHIP_MANAGER_NOT_FOUND (404 opaque)", () => {
  it("MODEL-CONTRACT-B: POST /tickets documente 404 RELATIONSHIP_MANAGER_NOT_FOUND", () => {
    const op = getOp(corePaths, "/tickets", "post");
    const opStr = JSON.stringify(op);
    expect(opStr, "POST /tickets doit documenter RELATIONSHIP_MANAGER_NOT_FOUND").toContain("RELATIONSHIP_MANAGER_NOT_FOUND");
  });

  it("MODEL-CONTRACT-B: POST /public/tickets documente 404 RELATIONSHIP_MANAGER_NOT_FOUND (opaque)", () => {
    expect(publicRaw, "public.yaml doit contenir RELATIONSHIP_MANAGER_NOT_FOUND").toContain("RELATIONSHIP_MANAGER_NOT_FOUND");
  });

  it("MODEL-CONTRACT-B: CreateTicketRequest documente la sémantique targetManagerId (file conseiller)", () => {
    const schema = coreSchemas["CreateTicketRequest"];
    const desc = JSON.stringify(schema);
    expect(desc, "CreateTicketRequest doit documenter targetManagerId").toContain("targetManagerId");
    expect(desc, "CreateTicketRequest doit documenter RELATIONSHIP_MANAGER_NOT_FOUND").toContain("RELATIONSHIP_MANAGER_NOT_FOUND");
  });
});

// ─── 5. Garde non-breaking : serviceId jamais retiré ──────────────────────────
describe("MODEL-CONTRACT-B — garde non-breaking (oasdiff vert)", () => {
  it("MODEL-CONTRACT-B: serviceId reste required sur TOUS les schémas de création (aucun passage required→optionnel)", () => {
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

  it("MODEL-CONTRACT-B: aucun champ conseiller/targetManagerId n'est required (100% additif)", () => {
    const additiveChecks: Array<[string, Record<string, Record<string, unknown>>, string]> = [
      ["AgentProfile", agentSchemas, "isRelationshipManager"],
      ["AgentProfile", agentSchemas, "displayName"],
      ["AgentProfile", agentSchemas, "photoUrl"],
      ["CreateTicketRequest", coreSchemas, "targetManagerId"],
      ["PublicTicketBase", publicSchemas, "targetManagerId"],
      ["TicketSyncItem", coreSchemas, "targetManagerId"],
      ["Ticket", coreSchemas, "targetManagerId"],
      ["TicketCreatedResponse", coreSchemas, "targetManagerId"],
      ["PublicTicketCreatedResponse", publicSchemas, "targetManagerId"],
      ["PublicTicketStatus", publicSchemas, "targetManagerId"],
    ];
    for (const [name, schemas, field] of additiveChecks) {
      const required = (schemas[name]?.required ?? []) as string[];
      expect(required.includes(field), `${name}.${field} ne doit PAS être required (additif)`).toBe(false);
    }
  });
});
