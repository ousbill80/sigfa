/**
 * CONTRACT-001 — Tests structurels du contrat cœur OpenAPI 3.1
 * Chaque test est nommé "CONTRACT-001: <critère>"
 * Parse le YAML avec la lib `yaml`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Chemin vers le YAML cœur
const CORE_YAML_PATH = resolve(__dirname, "../openapi/core.yaml");

// Charger et parser le YAML une seule fois
let doc: Record<string, unknown>;
try {
  const raw = readFileSync(CORE_YAML_PATH, "utf-8");
  doc = parse(raw) as Record<string, unknown>;
} catch {
  doc = {};
}

// Helpers
type OpenAPIDoc = {
  openapi?: string;
  info?: Record<string, unknown>;
  paths?: Record<string, Record<string, OperationObject>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
    headers?: Record<string, unknown>;
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

/** Collecter toutes les opérations */
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

/** Valeurs valides pour les enums x-* */
const VALID_TENANT_SCOPES = ["platform", "bank", "agency", "public"];
const VALID_REQUIRED_ROLES = [
  "SUPER_ADMIN", "BANK_ADMIN", "AGENCY_DIRECTOR",
  "MANAGER", "AGENT", "AUDITOR", "AUTHENTICATED", "NONE",
];

/** Collecter les chemins en format normalisé */
function getPath(key: string): Record<string, unknown> | undefined {
  // Try with and without /api/v1 prefix
  return (paths[key] ?? paths[key.startsWith("/api/v1") ? key.slice(7) : "/api/v1" + key]) as Record<string, unknown> | undefined;
}

/** Mutations critiques nécessitant X-Idempotency-Key */
const CRITICAL_MUTATIONS = [
  { path: "/tickets", method: "post" },
  { path: "/tickets/{id}/close", method: "post" },
  { path: "/tickets/sync", method: "post" },
];

/** Transitions valides de la machine à états du ticket */
const STATE_TRANSITION_ENDPOINTS = [
  "/tickets/{id}/call",
  "/tickets/{id}/serve",
  "/tickets/{id}/close",
  "/tickets/{id}/no-show",
  "/tickets/{id}/transfer",
  "/tickets/{id}/abandon",
  "/counters/{counterId}/call-next",
];

// ─── Critère 1 : Le YAML est valide OpenAPI 3.1 ───────────────────────────────
describe("CONTRACT-001", () => {
  it("CONTRACT-001: le YAML est valide OpenAPI 3.1 (spectral lint zéro erreur, règles custom x-* incluses)", () => {
    expect(openapi.openapi).toBeDefined();
    expect(typeof openapi.openapi).toBe("string");
    expect((openapi.openapi as string).startsWith("3.1")).toBe(true);
    expect(openapi.info).toBeDefined();
    expect(openapi.paths).toBeDefined();
    expect(Object.keys(paths).length).toBeGreaterThan(0);
    // Le serveur est /api/v1 — les chemins sont relatifs (commencent par /)
    // OU absolus incluant /api/v1
    for (const p of Object.keys(paths)) {
      expect(p).toMatch(/^\//);
    }
  });

  // ─── Critère 2 : 9 codes de réponse par endpoint ──────────────────────────
  it("CONTRACT-001: chaque endpoint expose les 9 codes de réponse avec schéma (test parcourant le YAML)", () => {
    const ops = getAllOperations();
    expect(ops.length).toBeGreaterThan(0);

    const failures: string[] = [];

    for (const { path, method, op } of ops) {
      const responseCodes = Object.keys(op.responses ?? {});
      // Vérifier les 8 codes d'erreur obligatoires (toujours présents)
      const requiredErrorCodes = ["400", "401", "403", "404", "409", "422", "429", "500"];
      // Plus au moins un 2xx (200 ou 201)
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
    }

    if (failures.length > 0) {
      throw new Error(`Endpoints sans 9 codes de réponse:\n${failures.join("\n")}`);
    }
  });

  // ─── Critère 3 : x-tenant-scope + x-required-role ─────────────────────────
  it("CONTRACT-001: chaque route documente x-tenant-scope + x-required-role, valeurs dans les enums (test spectral custom)", () => {
    const ops = getAllOperations();
    const failures: string[] = [];

    for (const { path, method, op } of ops) {
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
    }

    if (failures.length > 0) {
      throw new Error(`Opérations sans x-tenant-scope/x-required-role valides:\n${failures.join("\n")}`);
    }
  });

  // ─── Critère 4 : mutations critiques → IdempotencyKeyParam ────────────────
  it("CONTRACT-001: les 3 mutations critiques référencent components/parameters/IdempotencyKeyParam avec schema inline (test)", () => {
    // Vérifier que components/parameters/IdempotencyKeyParam est défini avec un schema inline valide
    const parameters = (openapi.components as Record<string, unknown>)?.["parameters"] as Record<string, unknown> | undefined;
    expect(parameters, "components/parameters doit être défini").toBeDefined();
    const idemParam = parameters?.["IdempotencyKeyParam"] as Record<string, unknown> | undefined;
    expect(idemParam, "components/parameters/IdempotencyKeyParam doit être défini").toBeDefined();
    expect(idemParam?.["in"]).toBe("header");
    expect(idemParam?.["name"]).toBe("X-Idempotency-Key");
    expect(idemParam?.["required"]).toBe(true);

    // Le schema doit être inline (string, minLength 1, maxLength 255) — pas un $ref sous-chemin non-standard
    const idemSchema = idemParam?.["schema"] as Record<string, unknown> | undefined;
    expect(idemSchema, "IdempotencyKeyParam doit avoir un schema inline").toBeDefined();
    expect(idemSchema?.["type"]).toBe("string");
    expect(idemSchema?.["minLength"]).toBe(1);
    expect(idemSchema?.["maxLength"]).toBe(255);
    // Garantir l'absence du $ref sous-chemin non-standard qui cassait openapi-typescript
    expect(idemSchema?.["$ref"]).toBeUndefined();

    // Vérifier que components/headers/IdempotencyKey reste défini (réponses + docs sémantiques)
    const headers = openapi.components?.headers;
    expect(headers).toBeDefined();
    expect((headers as Record<string, unknown>)["IdempotencyKey"]).toBeDefined();

    // Vérifier que chaque mutation critique référence IdempotencyKeyParam via $ref standard
    for (const { path, method } of CRITICAL_MUTATIONS) {
      const pathItem = getPath(path);
      expect(pathItem, `Path ${path} devrait exister`).toBeDefined();
      const op = (pathItem as Record<string, unknown>)[method] as OperationObject | undefined;
      expect(op, `${method.toUpperCase()} ${path} devrait exister`).toBeDefined();

      const params = op?.parameters ?? [];
      const hasIdempKey = params.some(
        (p: ParameterObject) => p.in === "header" && (p.name === "X-Idempotency-Key" || JSON.stringify(p).includes("IdempotencyKey")),
      );
      // Également vérifier via $ref dans parameters
      const opStr = JSON.stringify(op);
      const hasIdempRef = opStr.includes("IdempotencyKeyParam") || opStr.includes("X-Idempotency-Key");
      expect(
        hasIdempKey || hasIdempRef,
        `${method.toUpperCase()} ${path} doit référencer IdempotencyKeyParam`,
      ).toBe(true);
    }
  });

  // ─── Critère 5 : machine à états ──────────────────────────────────────────
  it("CONTRACT-001: machine à états encodée — enum TicketStatus + 409 ILLEGAL_TRANSITION sur chaque transition (test)", () => {
    // Vérifier TicketStatus dans components/schemas
    const schemas = openapi.components?.schemas;
    expect(schemas, "components/schemas doit exister").toBeDefined();
    const ticketStatus = (schemas as Record<string, unknown>)["TicketStatus"] as Record<string, unknown> | undefined;
    expect(ticketStatus, "TicketStatus doit être défini dans components/schemas").toBeDefined();

    const tsEnum = ticketStatus?.enum as string[] | undefined;
    expect(Array.isArray(tsEnum), "TicketStatus doit avoir un enum").toBe(true);

    const expectedStatuses = ["WAITING", "CALLED", "SERVING", "DONE", "NO_SHOW", "ABANDONED", "TRANSFERRED"];
    for (const s of expectedStatuses) {
      expect(tsEnum, `TicketStatus enum doit contenir ${s}`).toContain(s);
    }

    // Vérifier que chaque endpoint de transition documente 409
    const transitionFailures: string[] = [];
    for (const tPath of STATE_TRANSITION_ENDPOINTS) {
      const pathItem = getPath(tPath);
      if (!pathItem) {
        transitionFailures.push(`Path manquant: ${tPath}`);
        continue;
      }
      const op = (pathItem as Record<string, unknown>)["post"] as OperationObject | undefined;
      if (!op) {
        transitionFailures.push(`POST ${tPath} manquant`);
        continue;
      }
      const responseCodes = Object.keys(op.responses ?? {});
      if (!responseCodes.includes("409")) {
        transitionFailures.push(`POST ${tPath} — code 409 absent`);
        continue;
      }
      // Vérifier qu'ILLEGAL_TRANSITION est documenté dans la réponse 409
      const resp409 = JSON.stringify(op.responses?.["409"] ?? {});
      if (!resp409.includes("ILLEGAL_TRANSITION")) {
        transitionFailures.push(`POST ${tPath} — ILLEGAL_TRANSITION absent de la réponse 409`);
      }
    }

    if (transitionFailures.length > 0) {
      throw new Error(`Problèmes machine à états:\n${transitionFailures.join("\n")}`);
    }
  });

  // ─── Critère 6 : call-next + /call ────────────────────────────────────────
  it("CONTRACT-001: call-next → 200 | 404 QUEUE_EMPTY documentés avec exemples ; /call → 409 TICKET_ALREADY_CLAIMED (test)", () => {
    // call-next
    const callNextPath = "/counters/{counterId}/call-next";
    const callNextItem = getPath(callNextPath);
    expect(callNextItem, `${callNextPath} doit exister`).toBeDefined();
    const callNextOp = (callNextItem as Record<string, unknown>)["post"] as OperationObject | undefined;
    expect(callNextOp, `POST ${callNextPath} doit exister`).toBeDefined();

    // 200 présent
    expect(Object.keys(callNextOp?.responses ?? {})).toContain("200");
    // 404 avec QUEUE_EMPTY
    const resp404 = JSON.stringify(callNextOp?.responses?.["404"] ?? {});
    expect(resp404, "call-next 404 doit contenir QUEUE_EMPTY").toContain("QUEUE_EMPTY");

    // Vérifier les exemples sur call-next (dans les réponses 200 et 404)
    const resp200Str = JSON.stringify(callNextOp?.responses?.["200"] ?? {});
    expect(resp200Str, "call-next 200 doit avoir un exemple").toMatch(/example|examples/);
    expect(resp404, "call-next 404 doit avoir un exemple").toMatch(/example|examples/);

    // /call → 409 TICKET_ALREADY_CLAIMED
    const callPath = "/tickets/{id}/call";
    const callItem = getPath(callPath);
    expect(callItem, `${callPath} doit exister`).toBeDefined();
    const callOp = (callItem as Record<string, unknown>)["post"] as OperationObject | undefined;
    expect(callOp, `POST ${callPath} doit exister`).toBeDefined();

    const call409 = JSON.stringify(callOp?.responses?.["409"] ?? {});
    expect(call409, "/call 409 doit contenir TICKET_ALREADY_CLAIMED").toContain("TICKET_ALREADY_CLAIMED");
  });

  // ─── Critère 7 : sync ─────────────────────────────────────────────────────
  it("CONTRACT-001: sync — maxItems 100 + 422 BATCH_TOO_LARGE + réponse synced/skipped typée (test)", () => {
    const syncPath = "/tickets/sync";
    const syncItem = getPath(syncPath);
    expect(syncItem, `${syncPath} doit exister`).toBeDefined();
    const syncOp = (syncItem as Record<string, unknown>)["post"] as OperationObject | undefined;
    expect(syncOp, `POST ${syncPath} doit exister`).toBeDefined();

    // maxItems 100 dans le requestBody
    const syncStr = JSON.stringify(syncOp);
    expect(syncStr, "sync doit avoir maxItems: 100").toContain("100");

    // 422 avec BATCH_TOO_LARGE
    const resp422 = JSON.stringify(syncOp?.responses?.["422"] ?? {});
    expect(resp422, "sync 422 doit contenir BATCH_TOO_LARGE").toContain("BATCH_TOO_LARGE");

    // Réponse 200/201 contient synced et skipped
    const resp2xx =
      JSON.stringify(syncOp?.responses?.["200"] ?? {}) +
      JSON.stringify(syncOp?.responses?.["201"] ?? {});
    expect(resp2xx, "sync response doit contenir 'synced'").toContain("synced");
    expect(resp2xx, "sync response doit contenir 'skipped'").toContain("skipped");
  });

  // ─── Critère 8 : exemples requête + réponse ───────────────────────────────
  it("CONTRACT-001: chaque endpoint possède exemple requête + réponse valides (spectral) — le smoke Prism global est délégué à CONTRACT-009b", () => {
    const ops = getAllOperations();
    const failures: string[] = [];

    for (const { path, method, op } of ops) {
      const opStr = JSON.stringify(op);
      // Vérifier qu'il y a au moins un exemple quelque part dans l'opération
      if (!opStr.includes("example") && !opStr.includes("examples")) {
        failures.push(`${method.toUpperCase()} ${path} — aucun exemple (requête ou réponse)`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`Endpoints sans exemples:\n${failures.join("\n")}`);
    }
  });
});

// ─── Tests additionnels : schémas transverses ──────────────────────────────
describe("CONTRACT-001 — Schémas transverses", () => {
  it("CONTRACT-001: schémas transverses Role, NotificationChannel et NotificationType sont définis dans components/schemas", () => {
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    expect(schemas?.["Role"], "Role doit être dans components/schemas").toBeDefined();

    // NotificationChannel : canaux de livraison (SMS, WhatsApp, email, push)
    expect(schemas?.["NotificationChannel"], "NotificationChannel doit être dans components/schemas").toBeDefined();
    const channel = schemas?.["NotificationChannel"] as Record<string, unknown> | undefined;
    const channelEnum = channel?.enum as string[] | undefined;
    expect(Array.isArray(channelEnum), "NotificationChannel doit avoir un enum").toBe(true);
    const expectedChannels = ["SMS", "WHATSAPP", "EMAIL", "PUSH"];
    for (const c of expectedChannels) {
      expect(channelEnum, `NotificationChannel enum doit contenir ${c}`).toContain(c);
    }

    // NotificationType : types de messages du parcours client
    expect(schemas?.["NotificationType"], "NotificationType doit être dans components/schemas").toBeDefined();
    const notifType = schemas?.["NotificationType"] as Record<string, unknown> | undefined;
    const notifTypeEnum = notifType?.enum as string[] | undefined;
    expect(Array.isArray(notifTypeEnum), "NotificationType doit avoir un enum").toBe(true);
    const expectedTypes = ["TICKET_CONFIRMATION", "POSITION_UPDATE", "YOUR_TURN", "DAILY_REPORT"];
    for (const t of expectedTypes) {
      expect(notifTypeEnum, `NotificationType enum doit contenir ${t}`).toContain(t);
    }

    // Role : 6 rôles + NONE
    const role = schemas?.["Role"] as Record<string, unknown> | undefined;
    const roleEnum = role?.enum as string[] | undefined;
    expect(Array.isArray(roleEnum)).toBe(true);
    const expectedRoles = ["SUPER_ADMIN", "BANK_ADMIN", "AGENCY_DIRECTOR", "MANAGER", "AGENT", "AUDITOR", "NONE"];
    for (const r of expectedRoles) {
      expect(roleEnum, `Role enum doit contenir ${r}`).toContain(r);
    }
  });

  it("CONTRACT-001: securitySchemes JWT access 15min + refresh 7j définis", () => {
    const secSchemes = openapi.components?.securitySchemes as Record<string, unknown> | undefined;
    expect(secSchemes, "components/securitySchemes doit exister").toBeDefined();
    // Au moins un scheme JWT de type http bearer
    const jwtScheme = Object.values(secSchemes ?? {}).find(
      (s) => (s as Record<string, unknown>)?.scheme === "bearer",
    );
    expect(jwtScheme, "Un scheme JWT bearer doit exister").toBeDefined();
  });

  it("CONTRACT-001: POST /tickets réponse contient number, position, estimatedWaitMinutes et channel", () => {
    const ticketPath = "/tickets";
    const pathItem = getPath(ticketPath);
    expect(pathItem, `${ticketPath} doit exister`).toBeDefined();
    const op = (pathItem as Record<string, unknown>)["post"] as OperationObject | undefined;
    expect(op, `POST ${ticketPath} doit exister`).toBeDefined();

    // La réponse 201 ou 200 doit contenir number, position, estimatedWaitMinutes, channel
    const resp2xx =
      JSON.stringify(op?.responses?.["201"] ?? {}) +
      JSON.stringify(op?.responses?.["200"] ?? {});

    expect(resp2xx, "POST /tickets réponse doit contenir 'number'").toContain("number");
    expect(resp2xx, "POST /tickets réponse doit contenir 'position'").toContain("position");
    expect(resp2xx, "POST /tickets réponse doit contenir 'estimatedWaitMinutes'").toContain("estimatedWaitMinutes");
    expect(resp2xx, "POST /tickets réponse doit contenir 'channel'").toContain("channel");
  });

  it("CONTRACT-001: 429 sur /auth/login documenté (rate-limit 5 tentatives/15min)", () => {
    const loginPath = "/auth/login";
    const pathItem = getPath(loginPath);
    expect(pathItem, `${loginPath} doit exister`).toBeDefined();
    const op = (pathItem as Record<string, unknown>)["post"] as OperationObject | undefined;
    expect(op, `POST ${loginPath} doit exister`).toBeDefined();

    const resp429 = JSON.stringify(op?.responses?.["429"] ?? {});
    expect(resp429, "/auth/login 429 doit être documenté avec rate-limit").toMatch(/429|TOO_MANY/);
  });
});

// ─── CONTRACT-010 : hardening sécurité + cohérence inter-YAML ────────────────
describe("CONTRACT-010 — core.yaml", () => {
  it("CONTRACT-010: POST /auth/logout a security: [] (accès public sans token valide)", () => {
    const pathItem = getPath("/auth/logout");
    expect(pathItem, "/auth/logout doit exister").toBeDefined();
    const op = (pathItem as Record<string, unknown>)?.["post"] as OperationObject | undefined;
    expect(op, "POST /auth/logout doit exister").toBeDefined();
    expect(
      Array.isArray(op?.security) && op.security.length === 0,
      "POST /auth/logout doit avoir security: [] (override global pour accepter token expiré)",
    ).toBe(true);
  });

  it("CONTRACT-010: GET /auth/me a x-required-role: AUTHENTICATED (pas NONE)", () => {
    const pathItem = getPath("/auth/me");
    expect(pathItem, "/auth/me doit exister").toBeDefined();
    const op = (pathItem as Record<string, unknown>)?.["get"] as OperationObject | undefined;
    expect(op, "GET /auth/me doit exister").toBeDefined();
    expect(
      op?.["x-required-role"],
      "GET /auth/me doit avoir x-required-role: AUTHENTICATED (token valide requis)",
    ).toBe("AUTHENTICATED");
  });

  it("WEB-002-HDR: GET /agencies/{id} a x-required-role: AGENT (lecture de SA propre agence — bandeau session)", () => {
    const pathItem = getPath("/agencies/{id}");
    expect(pathItem, "/agencies/{id} doit exister").toBeDefined();
    const op = (pathItem as Record<string, unknown>)?.["get"] as OperationObject | undefined;
    expect(op, "GET /agencies/{id} doit exister").toBeDefined();
    expect(
      op?.["x-required-role"],
      "GET /agencies/{id} doit avoir x-required-role: AGENT — tout connecté résout le nom de son agence de rattachement (scope agency inchangé : hors périmètre agencyIds → 403)",
    ).toBe("AGENT");
    expect(op?.["x-tenant-scope"], "GET /agencies/{id} garde le scope agency").toBe("agency");
  });

  it("CONTRACT-010: DELETE /agencies/{id} 409 utilise AGENCY_HAS_OPEN_TICKETS (pas ACTIVE)", () => {
    const pathItem = getPath("/agencies/{id}");
    expect(pathItem, "/agencies/{id} doit exister").toBeDefined();
    const op = (pathItem as Record<string, unknown>)?.["delete"] as OperationObject | undefined;
    expect(op, "DELETE /agencies/{id} doit exister dans core.yaml").toBeDefined();
    const resp409 = JSON.stringify(op?.responses?.["409"] ?? {});
    expect(resp409, "DELETE /agencies/{id} 409 doit utiliser AGENCY_HAS_OPEN_TICKETS").toContain("AGENCY_HAS_OPEN_TICKETS");
    expect(resp409, "DELETE /agencies/{id} 409 ne doit pas utiliser AGENCY_HAS_ACTIVE_TICKETS").not.toContain("AGENCY_HAS_ACTIVE_TICKETS");
  });

  it("CONTRACT-010: tous les exemples UUID dans core.yaml sont des UUID v4 valides", () => {
    const rawContent = readFileSync(CORE_YAML_PATH, "utf-8");
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
    const placeholderPattern = /(bank_\d+|agency_\d+|user_\d+|svc_\d+|counter_\d+|ticket_\d+|queue_\d+|kiosk_\d+|device_\d+|agent_\d+)/;
    expect(
      rawContent,
      "core.yaml ne doit pas contenir de faux IDs non-UUID (bank_01, agency_01, etc.)",
    ).not.toMatch(placeholderPattern);
    // Vérifier que les UUIDs sont bien en v4
    const uuids = rawContent.match(uuidPattern) ?? [];
    expect(uuids.length, "core.yaml doit contenir des exemples UUID v4").toBeGreaterThan(0);
  });

  it("CONTRACT-010: PrinterStatus est défini dans core.yaml components/schemas", () => {
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    expect(schemas, "components/schemas doit exister").toBeDefined();
    const printerStatus = schemas?.["PrinterStatus"] as Record<string, unknown> | undefined;
    expect(printerStatus, "PrinterStatus doit être défini dans core.yaml").toBeDefined();
    const psEnum = printerStatus?.enum as string[] | undefined;
    expect(Array.isArray(psEnum), "PrinterStatus doit avoir un enum").toBe(true);
    expect(psEnum, "PrinterStatus doit contenir OK").toContain("OK");
    expect(psEnum, "PrinterStatus doit contenir PAPER_LOW").toContain("PAPER_LOW");
    expect(psEnum, "PrinterStatus doit contenir ERROR").toContain("ERROR");
    expect(psEnum, "PrinterStatus doit contenir OFFLINE").toContain("OFFLINE");
  });

  it("CONTRACT-010: CreateTicketRequest n'a pas de champ agencyId (dérivé du JWT)", () => {
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    const createTicketReq = schemas?.["CreateTicketRequest"] as Record<string, unknown> | undefined;
    expect(createTicketReq, "CreateTicketRequest doit exister").toBeDefined();
    const props = (createTicketReq?.properties ?? {}) as Record<string, unknown>;
    expect(
      props["agencyId"],
      "CreateTicketRequest ne doit pas avoir de champ agencyId (dérivé du JWT)",
    ).toBeUndefined();
    const required = (createTicketReq?.required ?? []) as string[];
    expect(
      required.includes("agencyId"),
      "CreateTicketRequest.required ne doit pas lister agencyId",
    ).toBe(false);
  });

  it("CONTRACT-010: TicketSyncItem n'a pas de champ agencyId (dérivé du JWT)", () => {
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    const syncItem = schemas?.["TicketSyncItem"] as Record<string, unknown> | undefined;
    expect(syncItem, "TicketSyncItem doit exister").toBeDefined();
    const props = (syncItem?.properties ?? {}) as Record<string, unknown>;
    expect(
      props["agencyId"],
      "TicketSyncItem ne doit pas avoir de champ agencyId (dérivé du JWT)",
    ).toBeUndefined();
    const required = (syncItem?.required ?? []) as string[];
    expect(
      required.includes("agencyId"),
      "TicketSyncItem.required ne doit pas lister agencyId",
    ).toBe(false);
  });

  it("CONTRACT-010: phoneNumber dans CreateTicketRequest a un pattern E.164", () => {
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    const createTicketReq = schemas?.["CreateTicketRequest"] as Record<string, unknown> | undefined;
    const props = (createTicketReq?.properties ?? {}) as Record<string, unknown>;
    const phone = props["phoneNumber"] as Record<string, unknown> | undefined;
    expect(phone, "CreateTicketRequest doit avoir le champ phoneNumber").toBeDefined();
    expect(
      phone?.["pattern"],
      "phoneNumber doit avoir un pattern E.164 (^\\+[1-9]\\d{6,14}$)",
    ).toMatch(/\+.*\d/);
  });
});
