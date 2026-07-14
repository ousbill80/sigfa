/**
 * WEB-002-OP — Tests structurels du contrat « opération visible à l'appel »
 * (additif, non-breaking). Chaque test est nommé "WEB-002-OP: <critère>".
 *
 * Couvre :
 *  - TicketCallResponse gagne operationId?/operationName? (nullable) + serviceName?
 *  - Ticket (GET /tickets/{id}) gagne operationName? (nullable) + serviceName?
 *  - Aucun de ces champs n'est requis (rétrocompat totale — non-breaking)
 * @module ticket-call-operation.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CORE_YAML_PATH = resolve(__dirname, "../openapi/core.yaml");

type SchemaObject = {
  required?: string[];
  properties?: Record<string, { type?: string | string[]; format?: string }>;
};

const core = parse(readFileSync(CORE_YAML_PATH, "utf-8")) as {
  components?: { schemas?: Record<string, SchemaObject> };
};

const schemas = core.components?.schemas ?? {};

describe("WEB-002-OP — TicketCallResponse (call-next / call)", () => {
  const schema = schemas["TicketCallResponse"];

  it("WEB-002-OP: TicketCallResponse expose operationName nullable (additif)", () => {
    const prop = schema?.properties?.["operationName"];
    expect(prop, "operationName doit exister").toBeDefined();
    expect(prop?.type).toEqual(["string", "null"]);
  });

  it("WEB-002-OP: TicketCallResponse expose serviceName (string, additif)", () => {
    const prop = schema?.properties?.["serviceName"];
    expect(prop, "serviceName doit exister").toBeDefined();
    expect(prop?.type).toBe("string");
  });

  it("WEB-002-OP: TicketCallResponse expose operationId nullable uuid (additif)", () => {
    const prop = schema?.properties?.["operationId"];
    expect(prop, "operationId doit exister").toBeDefined();
    expect(prop?.type).toEqual(["string", "null"]);
    expect(prop?.format).toBe("uuid");
  });

  it("WEB-002-OP: aucun champ ajouté n'est requis (non-breaking)", () => {
    const required = schema?.required ?? [];
    expect(required).not.toContain("operationId");
    expect(required).not.toContain("operationName");
    expect(required).not.toContain("serviceName");
  });
});

describe("WEB-002-OP — Ticket (GET /tickets/{id})", () => {
  const schema = schemas["Ticket"];

  it("WEB-002-OP: Ticket expose operationName nullable (additif)", () => {
    const prop = schema?.properties?.["operationName"];
    expect(prop, "operationName doit exister").toBeDefined();
    expect(prop?.type).toEqual(["string", "null"]);
  });

  it("WEB-002-OP: Ticket expose serviceName (string, additif)", () => {
    const prop = schema?.properties?.["serviceName"];
    expect(prop, "serviceName doit exister").toBeDefined();
    expect(prop?.type).toBe("string");
  });

  it("WEB-002-OP: aucun champ ajouté n'est requis (non-breaking)", () => {
    const required = schema?.required ?? [];
    expect(required).not.toContain("operationName");
    expect(required).not.toContain("serviceName");
  });
});
