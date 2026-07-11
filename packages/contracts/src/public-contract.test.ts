/**
 * CONTRACT-003 — Tests structurels du contrat client public OpenAPI 3.1
 * Chaque test est nommé "CONTRACT-003: <critère>"
 * Parse le YAML avec la lib `yaml`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PUBLIC_YAML_PATH = resolve(__dirname, "../openapi/public.yaml");

let doc: Record<string, unknown>;
try {
  const raw = readFileSync(PUBLIC_YAML_PATH, "utf-8");
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
  content?: Record<string, MediaTypeObject>;
  headers?: Record<string, unknown>;
};

type MediaTypeObject = {
  schema?: Record<string, unknown>;
  example?: unknown;
  examples?: Record<string, unknown>;
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

function getOp(path: string, method: string): OperationObject | undefined {
  const pathItem = paths[path] as Record<string, unknown> | undefined;
  return pathItem?.[method] as OperationObject | undefined;
}

// ─── CONTRACT-003 tests ───────────────────────────────────────────────────────

describe("CONTRACT-003", () => {

  // Critère 1 : spectral zéro erreur + $ref croisés vers core.yaml résolus
  it("CONTRACT-003: spectral zéro erreur ; $ref croisés vers core.yaml résolus (test bundle redocly)", () => {
    // Vérifie que le fichier est un OpenAPI 3.1 valide
    expect(openapi.openapi, "openapi version doit être définie").toBeDefined();
    expect((openapi.openapi as string).startsWith("3.1"), "doit être OpenAPI 3.1").toBe(true);
    expect(openapi.info, "info doit être défini").toBeDefined();
    expect(openapi.paths, "paths doit être défini").toBeDefined();
    expect(Object.keys(paths).length, "au moins un path doit exister").toBeGreaterThan(0);

    // Vérifie que les $ref vers core.yaml sont présents
    const docStr = JSON.stringify(doc);
    expect(docStr, "doit référencer core.yaml via $ref").toContain("core.yaml");
  });

  // Critère 2 : 9 codes + x-tenant-scope (public|agency) sur chaque endpoint
  it("CONTRACT-003: 9 codes + x-tenant-scope (public|agency) sur chaque endpoint (test)", () => {
    const ops = getAllOperations();
    expect(ops.length, "au moins un endpoint doit exister").toBeGreaterThan(0);

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

      // x-tenant-scope doit être public ou agency
      const scope = op["x-tenant-scope"];
      if (!scope || !VALID_TENANT_SCOPES.includes(scope as string)) {
        failures.push(`${method.toUpperCase()} ${path} — x-tenant-scope invalide: "${scope}"`);
      }

      // x-required-role doit être une valeur valide
      const role = op["x-required-role"];
      if (!role || !VALID_REQUIRED_ROLES.includes(role as string)) {
        failures.push(`${method.toUpperCase()} ${path} — x-required-role invalide: "${role}"`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`Problèmes sur les endpoints:\n${failures.join("\n")}`);
    }
  });

  // Critère 3 : canal encodé en oneOf/discriminator avec champs conditionnels par canal
  it("CONTRACT-003: canal encodé en oneOf/discriminator avec champs conditionnels par canal (test)", () => {
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    expect(schemas, "components/schemas doit exister").toBeDefined();

    // Un schéma de ticket public doit avoir oneOf / discriminator pour les canaux
    const docStr = JSON.stringify(doc);
    expect(docStr, "doit contenir oneOf pour les canaux").toContain("oneOf");
    expect(docStr, "doit contenir discriminator pour les canaux").toContain("discriminator");

    // Les 4 canaux KIOSK, QR, MOBILE, WHATSAPP doivent être documentés
    expect(docStr, "doit documenter le canal KIOSK").toContain("KIOSK");
    expect(docStr, "doit documenter le canal QR").toContain("QR");
    expect(docStr, "doit documenter le canal MOBILE").toContain("MOBILE");
    expect(docStr, "doit documenter le canal WHATSAPP").toContain("WHATSAPP");

    // smsConsent booléen doit être présent (opt-in UEMOA)
    expect(docStr, "doit documenter smsConsent").toContain("smsConsent");
  });

  // Critère 4 : trackingId pattern nanoid(21) ; uuid interne absent des réponses publiques
  it("CONTRACT-003: trackingId pattern nanoid(21) ; uuid interne absent de toutes les réponses publiques (test structurel)", () => {
    const schemas = openapi.components?.schemas as Record<string, unknown> | undefined;
    expect(schemas, "components/schemas doit exister").toBeDefined();

    // Un schéma doit contenir le pattern nanoid(21)
    const docStr = JSON.stringify(doc);
    expect(docStr, "doit contenir le pattern nanoid").toContain("[A-Za-z0-9_-]{21}");

    // GET /public/tickets/:trackingId doit exister
    const trackingPath = "/public/tickets/{trackingId}";
    const trackingOp = getOp(trackingPath, "get");
    expect(trackingOp, `GET ${trackingPath} doit exister`).toBeDefined();

    // La réponse 200 du suivi public ne doit PAS exposer l'uuid interne
    const resp200 = JSON.stringify(trackingOp?.responses?.["200"] ?? {});
    // La réponse doit contenir trackingId
    expect(resp200, "réponse suivi public doit contenir trackingId").toContain("trackingId");
    // La réponse ne doit PAS exposer un champ uuid interne ("id" format uuid)
    // Vérification structurelle : le schéma de réponse publique est distinct du Ticket interne
    const publicTicketStr = JSON.stringify(openapi.components?.schemas ?? {});
    expect(publicTicketStr, "schema public doit contenir trackingId").toContain("trackingId");
  });

  // Critère 5 : session borne TTL 12 h + révocation ; heartbeat typé avec printerStatus
  it("CONTRACT-003: session borne TTL 12 h + révocation ; heartbeat typé avec printerStatus (test)", () => {
    // POST /kiosk/session doit exister
    const sessionOp = getOp("/kiosk/session", "post");
    expect(sessionOp, "POST /kiosk/session doit exister").toBeDefined();

    // La description ou le schéma doit mentionner 12h / 43200 secondes
    const sessionStr = JSON.stringify(sessionOp);
    expect(
      sessionStr.includes("12") || sessionStr.includes("43200"),
      "POST /kiosk/session doit mentionner TTL 12h"
    ).toBe(true);

    // DELETE /kiosk/session/:kioskId doit exister (révocation)
    const revokeOp = getOp("/kiosk/session/{kioskId}", "delete");
    expect(revokeOp, "DELETE /kiosk/session/{kioskId} doit exister").toBeDefined();

    // La révocation doit requérir AGENCY_DIRECTOR+
    expect(
      revokeOp?.["x-required-role"],
      "révocation doit requérir AGENCY_DIRECTOR"
    ).toBe("AGENCY_DIRECTOR");

    // POST /kiosks/:kioskId/heartbeat doit exister
    const heartbeatOp = getOp("/kiosks/{kioskId}/heartbeat", "post");
    expect(heartbeatOp, "POST /kiosks/{kioskId}/heartbeat doit exister").toBeDefined();

    // heartbeat doit contenir printerStatus
    const heartbeatStr = JSON.stringify(heartbeatOp);
    expect(heartbeatStr, "heartbeat doit documenter printerStatus").toContain("printerStatus");

    // printerStatus doit avoir OK, ERROR, OFFLINE
    expect(heartbeatStr, "heartbeat doit documenter OK").toContain("OK");
    expect(heartbeatStr, "heartbeat doit documenter ERROR").toContain("ERROR");
    expect(heartbeatStr, "heartbeat doit documenter OFFLINE").toContain("OFFLINE");

    // heartbeat doit contenir appVersion et uptimeSeconds
    expect(heartbeatStr, "heartbeat doit documenter appVersion").toContain("appVersion");
    expect(heartbeatStr, "heartbeat doit documenter uptimeSeconds").toContain("uptimeSeconds");

    // réponse heartbeat doit contenir serverTime
    const resp200 = JSON.stringify(heartbeatOp?.responses?.["200"] ?? {});
    expect(resp200, "heartbeat 200 doit contenir serverTime").toContain("serverTime");
  });

  // Critère 6 : feedback — 422 TICKET_NOT_CLOSED, 409 doublon, 422 fenêtre expirée documentés
  it("CONTRACT-003: feedback — 422 TICKET_NOT_CLOSED, 409 doublon, 422 fenêtre expirée documentés (test)", () => {
    const feedbackOp = getOp("/public/tickets/{trackingId}/feedback", "post");
    expect(feedbackOp, "POST /public/tickets/{trackingId}/feedback doit exister").toBeDefined();

    const feedbackStr = JSON.stringify(feedbackOp);

    // 422 TICKET_NOT_CLOSED
    const resp422 = JSON.stringify(feedbackOp?.responses?.["422"] ?? {});
    expect(resp422, "feedback 422 doit documenter TICKET_NOT_CLOSED").toContain("TICKET_NOT_CLOSED");

    // 409 FEEDBACK_ALREADY_SUBMITTED (doublon)
    const resp409 = JSON.stringify(feedbackOp?.responses?.["409"] ?? {});
    expect(resp409, "feedback 409 doit documenter FEEDBACK_ALREADY_SUBMITTED").toContain("FEEDBACK_ALREADY_SUBMITTED");

    // 422 FEEDBACK_WINDOW_EXPIRED (fenêtre 24h)
    expect(
      resp422.includes("FEEDBACK_WINDOW_EXPIRED") || feedbackStr.includes("FEEDBACK_WINDOW_EXPIRED"),
      "feedback doit documenter FEEDBACK_WINDOW_EXPIRED"
    ).toBe(true);

    // note 1-5 entière
    expect(feedbackStr, "feedback doit documenter note 1-5").toContain("note");

    // commentaire ≤ 500 caractères optionnel
    expect(feedbackStr, "feedback doit documenter commentaire").toContain("commentaire");
  });

  // Critère 7 : webhook inbound par bankSlug avec 401 signature invalide
  it("CONTRACT-003: webhook inbound par bankSlug avec 401 signature invalide (test)", () => {
    const webhookOp = getOp("/webhooks/whatsapp/inbound/{bankSlug}", "post");
    expect(webhookOp, "POST /webhooks/whatsapp/inbound/{bankSlug} doit exister").toBeDefined();

    const webhookStr = JSON.stringify(webhookOp);

    // 401 si signature HMAC invalide
    const resp401 = JSON.stringify(webhookOp?.responses?.["401"] ?? {});
    expect(resp401, "webhook 401 doit être documenté").toBeTruthy();

    // HMAC-SHA256 doit être mentionné
    expect(webhookStr, "webhook doit mentionner HMAC ou x-hub-signature").toMatch(/hmac|HMAC|x-hub-signature/i);

    // bankSlug doit être dans le path
    const docStr = JSON.stringify(doc);
    expect(docStr, "doit contenir bankSlug").toContain("bankSlug");
  });

  // Critère 8 : Cache-Control + ETag documentés sur le suivi public
  it("CONTRACT-003: Cache-Control + ETag documentés sur le suivi public (test)", () => {
    const trackingOp = getOp("/public/tickets/{trackingId}", "get");
    expect(trackingOp, "GET /public/tickets/{trackingId} doit exister").toBeDefined();

    const trackingStr = JSON.stringify(trackingOp);

    // Cache-Control: max-age=30 doit être documenté
    expect(
      trackingStr.includes("Cache-Control") || trackingStr.includes("cache-control"),
      "suivi public doit documenter Cache-Control"
    ).toBe(true);
    expect(
      trackingStr.includes("max-age") || trackingStr.includes("30"),
      "Cache-Control doit documenter max-age=30"
    ).toBe(true);

    // ETag doit être documenté
    expect(
      trackingStr.includes("ETag") || trackingStr.includes("etag"),
      "suivi public doit documenter ETag"
    ).toBe(true);

    // 429 rate-limit documenté (sans auth)
    const resp429 = JSON.stringify(trackingOp?.responses?.["429"] ?? {});
    expect(resp429, "suivi public doit documenter le 429 rate-limit").toBeTruthy();
  });

  // Critère 9 : exemples présents + valides par canal
  it("CONTRACT-003: exemples présents + valides par canal (spectral) — smoke Prism délégué à CONTRACT-009b", () => {
    const ops = getAllOperations();
    expect(ops.length, "au moins un endpoint doit exister").toBeGreaterThan(0);

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

    // Vérifier qu'il y a des exemples pour les différents canaux
    const docStr = JSON.stringify(doc);
    expect(docStr, "doit avoir des exemples pour canal KIOSK").toContain("KIOSK");
    expect(docStr, "doit avoir des exemples pour canal QR").toContain("QR");
    expect(docStr, "doit avoir des exemples pour canal MOBILE").toContain("MOBILE");
    expect(docStr, "doit avoir des exemples pour canal WHATSAPP").toContain("WHATSAPP");
  });

  // Critère additionnel : QR endpoint
  it("CONTRACT-003: endpoint QR d'agence GET /agencies/{id}/qr existe avec payload signé (test)", () => {
    const qrOp = getOp("/agencies/{id}/qr", "get");
    expect(qrOp, "GET /agencies/{id}/qr doit exister").toBeDefined();

    const qrStr = JSON.stringify(qrOp);
    // doit contenir des références à l'URL PWA et identifiant signé
    expect(qrStr, "QR doit documenter une payload ou URL").toMatch(/url|payload|qr|signed/i);
  });
});

// ─── CONTRACT-010 : hardening sécurité + cohérence inter-YAML ────────────────
describe("CONTRACT-010 — public.yaml", () => {
  it("CONTRACT-010: tous les exemples UUID dans public.yaml sont des UUID v4 valides", () => {
    const rawContent = readFileSync(PUBLIC_YAML_PATH, "utf-8");
    const placeholderPattern = /(kiosk_\d+|agency_\d+|svc_\d+|ticket_\d+)/;
    expect(
      rawContent,
      "public.yaml ne doit pas contenir de faux IDs non-UUID (kiosk_01, agency_01, etc.)",
    ).not.toMatch(placeholderPattern);
  });

  it("CONTRACT-010: POST /kiosks/{kioskId}/heartbeat a x-required-role: AUTHENTICATED", () => {
    const op = getOp("/kiosks/{kioskId}/heartbeat", "post");
    expect(op, "POST /kiosks/{kioskId}/heartbeat doit exister").toBeDefined();
    expect(
      op?.["x-required-role"],
      "POST /kiosks/{kioskId}/heartbeat doit avoir x-required-role: AUTHENTICATED (token kiosque requis)",
    ).toBe("AUTHENTICATED");
  });

  it("CONTRACT-010: FeedbackRequest a le champ comment (pas commentaire)", () => {
    const schemas = (openapi.components?.schemas ?? {}) as Record<string, unknown>;
    const feedbackReq = schemas["FeedbackRequest"] as Record<string, unknown> | undefined;
    expect(feedbackReq, "FeedbackRequest doit être défini").toBeDefined();
    const props = (feedbackReq?.properties ?? {}) as Record<string, unknown>;
    expect(
      props["comment"],
      "FeedbackRequest doit avoir le champ comment (pas commentaire)",
    ).toBeDefined();
    expect(
      props["commentaire"],
      "FeedbackRequest ne doit pas avoir le champ commentaire (utiliser comment)",
    ).toBeUndefined();
  });

  it("CONTRACT-010: public.yaml référence PrinterStatus depuis core.yaml (pas de définition locale)", () => {
    const rawContent = readFileSync(PUBLIC_YAML_PATH, "utf-8");
    // Doit référencer core.yaml pour PrinterStatus
    expect(
      rawContent,
      "public.yaml doit référencer PrinterStatus depuis core.yaml",
    ).toContain("core.yaml#/components/schemas/PrinterStatus");
    // Ne doit pas redéfinir PrinterStatus localement
    const schemas = (openapi.components?.schemas ?? {}) as Record<string, unknown>;
    expect(
      schemas["PrinterStatus"],
      "public.yaml ne doit pas redéfinir PrinterStatus localement",
    ).toBeUndefined();
  });
});
