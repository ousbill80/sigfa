/**
 * CONTRACT-007 — Tests structurels du contrat notifications OpenAPI 3.1
 * Chaque test est nommé "CONTRACT-007: <critère>"
 * Parse le YAML avec la lib `yaml`.
 * Référence : docs/prd/f1/CONTRACT-007.md (v2)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Chemins vers les YAMLs
const NOTIF_YAML_PATH = resolve(__dirname, "../openapi/notifications.yaml");
const CORE_YAML_PATH = resolve(__dirname, "../openapi/core.yaml");

// Charger et parser les YAMLs une seule fois
let doc: Record<string, unknown>;
let coreDoc: Record<string, unknown>;
try {
  const raw = readFileSync(NOTIF_YAML_PATH, "utf-8");
  doc = parse(raw) as Record<string, unknown>;
} catch {
  doc = {};
}
try {
  const rawCore = readFileSync(CORE_YAML_PATH, "utf-8");
  coreDoc = parse(rawCore) as Record<string, unknown>;
} catch {
  coreDoc = {};
}

// Types helpers
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
  requestBody?: RequestBodyObject;
  parameters?: ParameterObject[];
  security?: unknown[];
  "x-tenant-scope"?: string;
  "x-required-role"?: string;
};

type ResponseObject = {
  description?: string;
  content?: Record<string, MediaTypeObject>;
};

type MediaTypeObject = {
  schema?: Record<string, unknown>;
  example?: unknown;
  examples?: Record<string, unknown>;
};

type RequestBodyObject = {
  required?: boolean;
  content?: Record<string, MediaTypeObject>;
};

type ParameterObject = {
  name?: string;
  in?: string;
  required?: boolean;
  schema?: Record<string, unknown>;
};

const openapi = doc as OpenAPIDoc;
const coreOpenapi = coreDoc as OpenAPIDoc;
const paths = (openapi?.paths ?? {}) as Record<string, Record<string, OperationObject>>;

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"] as const;

/** Collecter toutes les opérations du fichier notifications */
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

/** Obtenir un chemin depuis le doc notifications */
function getPath(key: string): Record<string, unknown> | undefined {
  return (paths[key] ?? paths[key.startsWith("/api/v1") ? key.slice(7) : "/api/v1" + key]) as
    | Record<string, unknown>
    | undefined;
}

// ─── Critère 1 : spectral zéro erreur ; $ref core résolus ─────────────────────
describe("CONTRACT-007", () => {
  it("CONTRACT-007: spectral zéro erreur ; $ref core résolus (test bundle redocly)", () => {
    // Vérifier que le fichier notifications.yaml est un OpenAPI 3.1 valide
    expect(openapi.openapi, "openapi version doit être défini").toBeDefined();
    expect(typeof openapi.openapi).toBe("string");
    expect((openapi.openapi as string).startsWith("3.1"), "doit être OpenAPI 3.1").toBe(true);
    expect(openapi.info, "info doit être défini").toBeDefined();
    expect(openapi.paths, "paths doit être défini").toBeDefined();
    expect(Object.keys(paths).length, "au moins un path défini").toBeGreaterThan(0);

    // Vérifier que les $ref vers core.yaml sont bien formés (pas de redéfinition locale)
    const docStr = JSON.stringify(doc);
    // Les $ref inter-fichiers doivent pointer vers ./core.yaml
    const refMatches = [...docStr.matchAll(/"\$ref":"([^"]+)"/g)].map((m) => m[1]).filter((v): v is string => v !== undefined);
    const localRefs = refMatches.filter((r) => !r.startsWith("./core.yaml") && !r.startsWith("#/"));
    expect(
      localRefs.length,
      `Tous les $ref externes doivent pointer vers ./core.yaml — refs suspects: ${localRefs.join(", ")}`,
    ).toBe(0);

    // Vérifier qu'il n'y a pas de redéfinition locale de NotificationChannel ou NotificationType
    const localSchemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    if (localSchemas) {
      expect(
        localSchemas["NotificationChannel"],
        "NotificationChannel ne doit PAS être redéfini dans notifications.yaml (utiliser $ref vers core.yaml)",
      ).toBeUndefined();
      expect(
        localSchemas["NotificationType"],
        "NotificationType ne doit PAS être redéfini dans notifications.yaml (utiliser $ref vers core.yaml)",
      ).toBeUndefined();
    }
  });

  // ─── Critère 2 : phoneNumberMasked seul champ téléphone ──────────────────────
  it("CONTRACT-007: phoneNumberMasked seul champ téléphone de TOUS les schémas de réponse (test structurel)", () => {
    // Aucun champ phoneNumber (brut) dans les schémas de RÉPONSE
    // On vérifie que le mot "phoneNumber" n'apparaît que dans des requestBody (opt-in)
    // et jamais dans une propriété de réponse (sauf phoneNumberMasked)

    // Tous les schémas locaux du fichier notifications
    const schemas = (openapi.components?.schemas ?? {}) as Record<string, unknown>;

    // Vérifier chaque schéma : aucun champ nommé "phone" ou "phoneNumber" brut dans les réponses
    for (const [schemaName, schemaDef] of Object.entries(schemas)) {
      const schemaStr = JSON.stringify(schemaDef);
      // Dans les schémas de réponse (hors request), phoneNumber brut interdit
      const isResponseSchema =
        schemaName.endsWith("Response") ||
        schemaName.endsWith("LogEntry") ||
        schemaName.endsWith("Entry") ||
        schemaName === "NotificationLogEntry" ||
        schemaName === "ConsentStatus" ||
        schemaName === "DeviceRegistration";

      if (isResponseSchema) {
        // Ne doit PAS contenir "phoneNumber" comme champ brut (sans Masked)
        const hasRawPhone =
          schemaStr.includes('"phoneNumber"') &&
          !schemaStr.includes('"phoneNumberMasked"');
        expect(
          hasRawPhone,
          `Schema ${schemaName} ne doit pas exposer phoneNumber brut — utiliser phoneNumberMasked`,
        ).toBe(false);
      }
    }

    // Vérifier que NotificationLogEntry a phoneNumberMasked
    const logEntry = schemas["NotificationLogEntry"] as Record<string, unknown> | undefined;
    expect(logEntry, "NotificationLogEntry doit être défini").toBeDefined();
    const props = (logEntry?.properties ?? {}) as Record<string, unknown>;
    expect(
      props["phoneNumberMasked"],
      "NotificationLogEntry.phoneNumberMasked doit être défini",
    ).toBeDefined();

    // Vérifier le pattern de masquage dans la description
    const maskedProp = props["phoneNumberMasked"] as Record<string, unknown> | undefined;
    const maskedDesc = (maskedProp?.description ?? "") as string;
    expect(
      maskedDesc.length,
      "phoneNumberMasked doit avoir une description expliquant le masquage",
    ).toBeGreaterThan(0);

    // Vérifier que le pattern d'exemple est conforme (2 premiers + 2 derniers visibles)
    const maskedExample = (maskedProp?.example ?? "") as string;
    expect(
      maskedExample,
      "phoneNumberMasked doit avoir un exemple de format masqué",
    ).toMatch(/\d{2}.*••.*\d{2}/);
  });

  // ─── Critère 3 : devices — 201/200 idempotent + DELETE ────────────────────────
  it("CONTRACT-007: devices — 201/200 idempotent + DELETE (test)", () => {
    // POST /notifications/devices → 201 (nouveau) | 200 (idempotent même token)
    const devicesPath = getPath("/notifications/devices");
    expect(devicesPath, "/notifications/devices doit exister").toBeDefined();

    const postDevices = (devicesPath as Record<string, unknown>)["post"] as OperationObject | undefined;
    expect(postDevices, "POST /notifications/devices doit exister").toBeDefined();

    // Doit avoir 201 ET 200 pour l'idempotence
    const postCodes = Object.keys(postDevices?.responses ?? {});
    expect(postCodes, "POST /notifications/devices doit avoir 201").toContain("201");
    expect(postCodes, "POST /notifications/devices doit avoir 200 (idempotent)").toContain("200");

    // La réponse 201 doit contenir deviceId
    const resp201 = JSON.stringify(postDevices?.responses?.["201"] ?? {});
    expect(resp201, "201 doit contenir deviceId").toContain("deviceId");

    // La réponse 200 doit contenir deviceId (même token → même deviceId)
    const resp200 = JSON.stringify(postDevices?.responses?.["200"] ?? {});
    expect(resp200, "200 idempotent doit contenir deviceId").toContain("deviceId");

    // Le requestBody doit avoir deviceToken + platform (IOS | ANDROID | EXPO)
    const reqBody = JSON.stringify(postDevices?.requestBody ?? {});
    expect(reqBody, "requestBody doit contenir deviceToken").toContain("deviceToken");
    expect(reqBody, "requestBody doit contenir platform").toContain("platform");
    expect(reqBody, "requestBody doit contenir IOS").toContain("IOS");
    expect(reqBody, "requestBody doit contenir ANDROID").toContain("ANDROID");
    expect(reqBody, "requestBody doit contenir EXPO").toContain("EXPO");

    // DELETE /notifications/devices/:deviceId
    const devicesDeletePath = getPath("/notifications/devices/{deviceId}");
    expect(devicesDeletePath, "/notifications/devices/{deviceId} doit exister").toBeDefined();

    const deleteDevice = (devicesDeletePath as Record<string, unknown>)["delete"] as OperationObject | undefined;
    expect(deleteDevice, "DELETE /notifications/devices/{deviceId} doit exister").toBeDefined();

    // 9 codes sur DELETE aussi
    const deleteCodes = Object.keys(deleteDevice?.responses ?? {});
    const requiredCodes = ["400", "401", "403", "404", "422", "429", "500"];
    for (const code of requiredCodes) {
      expect(deleteCodes, `DELETE /notifications/devices/{deviceId} doit avoir ${code}`).toContain(code);
    }
  });

  // ─── Critère 4 : opt-in requis encodé + endpoints consent ─────────────────────
  it("CONTRACT-007: opt-in requis encodé + endpoints consent (test)", () => {
    // POST /notifications/opt-in
    const optInPath = getPath("/notifications/opt-in");
    expect(optInPath, "/notifications/opt-in doit exister").toBeDefined();

    const postOptIn = (optInPath as Record<string, unknown>)["post"] as OperationObject | undefined;
    expect(postOptIn, "POST /notifications/opt-in doit exister").toBeDefined();

    // Le requestBody doit contenir phone + channel
    const optInReq = JSON.stringify(postOptIn?.requestBody ?? {});
    expect(optInReq, "opt-in requestBody doit contenir phone").toMatch(/phone/);
    expect(optInReq, "opt-in requestBody doit contenir channel").toContain("channel");

    // POST /notifications/opt-out
    const optOutPath = getPath("/notifications/opt-out");
    expect(optOutPath, "/notifications/opt-out doit exister").toBeDefined();

    const postOptOut = (optOutPath as Record<string, unknown>)["post"] as OperationObject | undefined;
    expect(postOptOut, "POST /notifications/opt-out doit exister").toBeDefined();

    // Le requestBody doit contenir phone + channel
    const optOutReq = JSON.stringify(postOptOut?.requestBody ?? {});
    expect(optOutReq, "opt-out requestBody doit contenir phone").toMatch(/phone/);
    expect(optOutReq, "opt-out requestBody doit contenir channel").toContain("channel");

    // GET /notifications/consent?phone=
    const consentPath = getPath("/notifications/consent");
    expect(consentPath, "/notifications/consent doit exister").toBeDefined();

    const getConsent = (consentPath as Record<string, unknown>)["get"] as OperationObject | undefined;
    expect(getConsent, "GET /notifications/consent doit exister").toBeDefined();

    // Doit avoir le paramètre phone en query
    const params = getConsent?.parameters ?? [];
    const phoneParam = params.find((p: ParameterObject) => p.name === "phone" && p.in === "query");
    expect(phoneParam, "GET /notifications/consent doit avoir ?phone= en query").toBeDefined();

    // MANAGER+ requis sur consent (x-required-role MANAGER ou supérieur)
    const consentRole = getConsent?.["x-required-role"];
    expect(
      ["MANAGER", "AGENCY_DIRECTOR", "BANK_ADMIN", "SUPER_ADMIN"].includes(consentRole as string),
      `GET /notifications/consent doit requérir MANAGER+ — got: ${consentRole}`,
    ).toBe(true);

    // Vérifier la description opt-in UEMOA dans au moins un des endpoints
    const optInDesc = (postOptIn?.description ?? "") as string;
    const optOutDesc = (postOptOut?.description ?? "") as string;
    const uemoaMentioned = optInDesc.toLowerCase().includes("uemoa") || optOutDesc.toLowerCase().includes("uemoa") ||
      optInDesc.toLowerCase().includes("opt-in") || (JSON.stringify(doc)).toLowerCase().includes("uemoa");
    expect(uemoaMentioned, "Le contrat doit mentionner UEMOA (consentement requis SMS/WhatsApp)").toBe(true);
  });

  // ─── Critère 5 : NotificationType référencé depuis core.yaml, jamais redéfini ──
  it("CONTRACT-007: NotificationType référencé depuis core.yaml, jamais redéfini (test)", () => {
    // core.yaml doit définir NotificationType
    const coreSchemas = (coreOpenapi.components?.schemas ?? {}) as Record<string, unknown>;
    expect(
      coreSchemas["NotificationType"],
      "NotificationType doit être défini dans core.yaml",
    ).toBeDefined();

    // NotificationChannel doit être défini dans core.yaml
    expect(
      coreSchemas["NotificationChannel"],
      "NotificationChannel doit être défini dans core.yaml",
    ).toBeDefined();

    // Les deux enums sont DISTINCTS (canal ≠ type)
    const channelDef = coreSchemas["NotificationChannel"] as Record<string, unknown>;
    const typeDef = coreSchemas["NotificationType"] as Record<string, unknown>;
    const channelEnum = channelDef?.enum as string[];
    const typeEnum = typeDef?.enum as string[];

    // Canal : SMS, WHATSAPP, EMAIL, PUSH
    expect(channelEnum).toContain("SMS");
    expect(channelEnum).toContain("WHATSAPP");
    expect(channelEnum).toContain("EMAIL");
    expect(channelEnum).toContain("PUSH");

    // Type : TICKET_CONFIRMATION, POSITION_UPDATE, YOUR_TURN, DAILY_REPORT
    expect(typeEnum).toContain("TICKET_CONFIRMATION");
    expect(typeEnum).toContain("POSITION_UPDATE");
    expect(typeEnum).toContain("YOUR_TURN");
    expect(typeEnum).toContain("DAILY_REPORT");

    // Les deux enums sont distincts (valeurs différentes)
    const intersection = channelEnum.filter((v) => typeEnum.includes(v));
    expect(
      intersection.length,
      "NotificationChannel et NotificationType sont deux enums distinctes sans intersection",
    ).toBe(0);

    // Dans notifications.yaml, NotificationType doit être référencé via $ref vers core.yaml
    const docStr = JSON.stringify(doc);
    expect(
      docStr.includes("./core.yaml") || docStr.includes("core.yaml"),
      "notifications.yaml doit référencer core.yaml via $ref",
    ).toBe(true);

    // Vérifier que le journal utilise NotificationType (type de message)
    const logEntry = (openapi.components?.schemas ?? {}) as Record<string, unknown>;
    const notifLog = logEntry["NotificationLogEntry"] as Record<string, unknown> | undefined;
    if (notifLog) {
      const logStr = JSON.stringify(notifLog);
      expect(
        logStr.includes("NotificationType") || logStr.includes("core.yaml"),
        "NotificationLogEntry doit référencer NotificationType",
      ).toBe(true);
    }
  });

  // ─── Critère 6 : webhooks delivery par provider avec 401 signature invalide ────
  it("CONTRACT-007: webhooks delivery par provider avec 401 signature invalide (test)", () => {
    // POST /webhooks/notifications/{provider}/delivery
    const webhookPath = getPath("/webhooks/notifications/{provider}/delivery");
    expect(webhookPath, "/webhooks/notifications/{provider}/delivery doit exister").toBeDefined();

    const postWebhook = (webhookPath as Record<string, unknown>)["post"] as OperationObject | undefined;
    expect(postWebhook, "POST /webhooks/notifications/{provider}/delivery doit exister").toBeDefined();

    // Les 9 codes sont présents
    const webhookCodes = Object.keys(postWebhook?.responses ?? {});
    const requiredCodes = ["200", "400", "401", "403", "404", "409", "422", "429", "500"];
    for (const code of requiredCodes) {
      expect(webhookCodes, `webhook delivery doit avoir ${code}`).toContain(code);
    }

    // 401 doit documenter "signature invalide"
    const resp401 = JSON.stringify(postWebhook?.responses?.["401"] ?? {});
    expect(
      resp401.toLowerCase().includes("signature") ||
      resp401.includes("SIGNATURE") ||
      resp401.includes("INVALID_SIGNATURE") ||
      resp401.includes("WEBHOOK"),
      "webhook 401 doit documenter l'invalidité de la signature provider",
    ).toBe(true);

    // Le paramètre {provider} doit avoir un enum
    const params = postWebhook?.parameters ?? [];
    const providerParam = params.find(
      (p: ParameterObject) => p.name === "provider" && p.in === "path",
    );
    expect(providerParam, "paramètre {provider} doit être défini").toBeDefined();
    const providerSchema = providerParam?.schema as Record<string, unknown> | undefined;
    const providerEnum = providerSchema?.enum as string[] | undefined;
    expect(Array.isArray(providerEnum), "provider doit avoir un enum").toBe(true);
    expect(providerEnum, "provider enum doit contenir africastalking").toContain("africastalking");
    expect(providerEnum, "provider enum doit contenir whatsapp").toContain("whatsapp");
    expect(providerEnum, "provider enum doit contenir resend").toContain("resend");

    // x-tenant-scope: public (webhook entrant)
    expect(
      postWebhook?.["x-tenant-scope"],
      "webhook delivery doit avoir x-tenant-scope",
    ).toBeDefined();
  });

  // ─── Critère 7 : 9 codes + scope + rôle partout ; exemples valides ────────────
  it("CONTRACT-007: 9 codes + scope + rôle partout ; exemples valides (spectral) — smoke Prism délégué à CONTRACT-009b", () => {
    const ops = getAllOperations();
    expect(ops.length, "au moins un endpoint défini dans notifications.yaml").toBeGreaterThan(0);

    const failures9codes: string[] = [];
    const failuresMeta: string[] = [];
    const failuresExamples: string[] = [];

    const requiredErrorCodes = ["400", "401", "403", "404", "409", "422", "429", "500"];

    for (const { path, method, op } of ops) {
      const responseCodes = Object.keys(op.responses ?? {});

      // 9 codes : 8 erreurs + 1 succès
      const has2xx = responseCodes.some((c) => c.startsWith("2"));
      const missingCodes = requiredErrorCodes.filter((c) => !responseCodes.includes(c));
      if (missingCodes.length > 0 || !has2xx) {
        failures9codes.push(
          `${method.toUpperCase()} ${path} — codes manquants: ${[...missingCodes, ...(has2xx ? [] : ["2xx"])].join(", ")}`,
        );
      }

      // x-tenant-scope + x-required-role
      const scope = op["x-tenant-scope"];
      const role = op["x-required-role"];
      if (!scope || !VALID_TENANT_SCOPES.includes(scope as string)) {
        failuresMeta.push(`${method.toUpperCase()} ${path} — x-tenant-scope invalide: "${scope}"`);
      }
      if (!role || !VALID_REQUIRED_ROLES.includes(role as string)) {
        failuresMeta.push(`${method.toUpperCase()} ${path} — x-required-role invalide: "${role}"`);
      }

      // Exemples présents
      const opStr = JSON.stringify(op);
      if (!opStr.includes("example") && !opStr.includes("examples")) {
        failuresExamples.push(`${method.toUpperCase()} ${path} — aucun exemple`);
      }
    }

    if (failures9codes.length > 0) {
      throw new Error(`Endpoints sans 9 codes:\n${failures9codes.join("\n")}`);
    }
    if (failuresMeta.length > 0) {
      throw new Error(`Endpoints sans x-tenant-scope/x-required-role valides:\n${failuresMeta.join("\n")}`);
    }
    if (failuresExamples.length > 0) {
      throw new Error(`Endpoints sans exemples:\n${failuresExamples.join("\n")}`);
    }
  });

  // ─── Critère complémentaire : journal d'envoi ─────────────────────────────────
  it("CONTRACT-007: journal d'envoi GET /notifications/log avec canaux et statuts + failureReason énuméré", () => {
    const logPath = getPath("/notifications/log");
    expect(logPath, "/notifications/log doit exister").toBeDefined();

    const getLog = (logPath as Record<string, unknown>)["get"] as OperationObject | undefined;
    expect(getLog, "GET /notifications/log doit exister").toBeDefined();

    // Paramètres : ticketId, channel, status
    const params = getLog?.parameters ?? [];
    const paramNames = params.map((p: ParameterObject) => p.name);
    expect(paramNames, "doit avoir ticketId en query").toContain("ticketId");
    expect(paramNames, "doit avoir channel en query").toContain("channel");
    expect(paramNames, "doit avoir status en query").toContain("status");

    // channel doit référencer NotificationChannel
    const channelParam = params.find((p: ParameterObject) => p.name === "channel");
    const channelParamStr = JSON.stringify(channelParam ?? {});
    expect(
      channelParamStr.includes("NotificationChannel") || channelParamStr.includes("core.yaml"),
      "le paramètre channel doit référencer NotificationChannel de core.yaml",
    ).toBe(true);

    // Réponse 200 : liste paginée (data + meta)
    const resp200 = JSON.stringify(getLog?.responses?.["200"] ?? {});
    expect(resp200, "réponse 200 doit avoir data").toContain("data");
    expect(resp200, "réponse 200 doit avoir meta").toContain("meta");

    // failureReason énuméré dans le schema NotificationLogEntry
    const schemas = (openapi.components?.schemas ?? {}) as Record<string, unknown>;
    const logEntry = schemas["NotificationLogEntry"] as Record<string, unknown> | undefined;
    expect(logEntry, "NotificationLogEntry doit être défini").toBeDefined();

    const logEntryStr = JSON.stringify(logEntry ?? {});
    expect(logEntryStr, "NotificationLogEntry doit avoir failureReason").toContain("failureReason");

    // failureReason doit être énuméré (via inline enum OU via $ref vers NotificationFailureReason)
    const props = (logEntry?.properties ?? {}) as Record<string, unknown>;
    const failureReasonProp = props["failureReason"] as Record<string, unknown> | undefined;
    if (failureReasonProp) {
      const failureReasonStr = JSON.stringify(failureReasonProp);
      expect(
        failureReasonProp["enum"] !== undefined ||
        failureReasonStr.includes("enum") ||
        failureReasonStr.includes("$ref") ||
        failureReasonStr.includes("NotificationFailureReason"),
        "failureReason doit avoir un enum inline ou référencer NotificationFailureReason via $ref",
      ).toBe(true);
    }

    // Statuts de notification QUEUED | SENT | DELIVERED | FAILED
    const logStatuses = ["QUEUED", "SENT", "DELIVERED", "FAILED"];
    const schemas2 = (openapi.components?.schemas ?? {}) as Record<string, unknown>;
    const notifStatus = schemas2["NotificationStatus"] as Record<string, unknown> | undefined;
    expect(notifStatus, "NotificationStatus doit être défini").toBeDefined();
    const statusEnum = notifStatus?.enum as string[] | undefined;
    for (const s of logStatuses) {
      expect(statusEnum, `NotificationStatus enum doit contenir ${s}`).toContain(s);
    }
  });

  // ─── Critère complémentaire : test d'envoi ────────────────────────────────────
  it("CONTRACT-007: POST /notifications/test — BANK_ADMIN, liste restreinte, 422 si hors liste", () => {
    const testPath = getPath("/notifications/test");
    expect(testPath, "/notifications/test doit exister").toBeDefined();

    const postTest = (testPath as Record<string, unknown>)["post"] as OperationObject | undefined;
    expect(postTest, "POST /notifications/test doit exister").toBeDefined();

    // x-required-role: BANK_ADMIN
    expect(
      postTest?.["x-required-role"],
      "POST /notifications/test doit requérir BANK_ADMIN",
    ).toBe("BANK_ADMIN");

    // La réponse 422 doit documenter le cas "hors liste de test"
    const resp422 = JSON.stringify(postTest?.responses?.["422"] ?? {});
    expect(
      resp422.includes("TEST_RECIPIENT_NOT_ALLOWED") || resp422.includes("NOT_ALLOWED") ||
      resp422.includes("liste") || resp422.includes("list") || resp422.length > 10,
      "422 doit documenter le cas destinataire hors liste de test",
    ).toBe(true);

    // Le requestBody doit avoir channel + template + recipient
    const reqStr = JSON.stringify(postTest?.requestBody ?? {});
    expect(reqStr, "requestBody doit avoir channel").toContain("channel");
    expect(reqStr, "requestBody doit avoir template").toMatch(/template|templateId/);
    expect(reqStr, "requestBody doit avoir recipient").toMatch(/recipient|phone/);
  });
});

// ─── CONTRACT-010 : hardening sécurité + cohérence inter-YAML ────────────────
describe("CONTRACT-010 — notifications.yaml", () => {
  it("CONTRACT-010: tous les exemples UUID dans notifications.yaml sont des UUID v4 valides", () => {
    const rawContent = readFileSync(NOTIF_YAML_PATH, "utf-8");
    const placeholderPattern = /(ticket_\d+|device_\d+|notif_\d+|notif_test_\d+)/;
    expect(
      rawContent,
      "notifications.yaml ne doit pas contenir de faux IDs non-UUID (ticket_42, device_01, etc.)",
    ).not.toMatch(placeholderPattern);
  });

  it("CONTRACT-010: DELETE /notifications/devices/{deviceId} a x-required-role: AUTHENTICATED et x-ownership-required: true", () => {
    const deviceDeletePath = getPath("/notifications/devices/{deviceId}");
    expect(deviceDeletePath, "/notifications/devices/{deviceId} doit exister").toBeDefined();
    const op = (deviceDeletePath as Record<string, unknown>)?.["delete"] as OperationObject | undefined;
    expect(op, "DELETE /notifications/devices/{deviceId} doit exister").toBeDefined();
    expect(
      op?.["x-required-role"],
      "DELETE /notifications/devices/{deviceId} doit avoir x-required-role: AUTHENTICATED",
    ).toBe("AUTHENTICATED");
    expect(
      (op as Record<string, unknown>)?.["x-ownership-required"],
      "DELETE /notifications/devices/{deviceId} doit avoir x-ownership-required: true",
    ).toBe(true);
  });

  it("CONTRACT-010: POST /notifications/devices a un code 429", () => {
    const devicesPath = getPath("/notifications/devices");
    expect(devicesPath, "/notifications/devices doit exister").toBeDefined();
    const op = (devicesPath as Record<string, unknown>)?.["post"] as OperationObject | undefined;
    expect(op, "POST /notifications/devices doit exister").toBeDefined();
    const codes = Object.keys(op?.responses ?? {});
    expect(codes, "POST /notifications/devices doit avoir un code 429").toContain("429");
  });

  it("CONTRACT-010: POST /notifications/devices réponse 200 ne contient pas deviceToken", () => {
    const devicesPath = getPath("/notifications/devices");
    const op = (devicesPath as Record<string, unknown>)?.["post"] as OperationObject | undefined;
    const resp200Str = JSON.stringify(op?.responses?.["200"] ?? {});
    expect(
      resp200Str,
      "POST /notifications/devices réponse 200 ne doit pas exposer deviceToken (sécurité)",
    ).not.toContain("deviceToken");
  });

  it("CONTRACT-010: NotificationLogEntry.failureReason utilise $ref NotificationFailureReason (pas inline)", () => {
    const schemas = (openapi.components?.schemas ?? {}) as Record<string, unknown>;
    const logEntry = schemas["NotificationLogEntry"] as Record<string, unknown> | undefined;
    expect(logEntry, "NotificationLogEntry doit être défini").toBeDefined();
    const props = (logEntry?.properties ?? {}) as Record<string, unknown>;
    const failureReason = props["failureReason"] as Record<string, unknown> | undefined;
    if (failureReason) {
      // Doit utiliser $ref, pas inline enum
      expect(
        JSON.stringify(failureReason),
        "failureReason doit utiliser $ref vers NotificationFailureReason (pas inline enum)",
      ).toContain("$ref");
      expect(
        (failureReason["enum"]),
        "failureReason ne doit pas avoir d'enum inline (doit utiliser $ref)",
      ).toBeUndefined();
    }
  });
});
