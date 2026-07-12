/**
 * CONTRACT-013 — Tests TDD : token d'affichage TV public + événement join:agency
 *
 * Contexte (couture Boucle 2 S2) : l'écran TV mural (/tv/:agencyId) doit rejoindre
 * la room socket d'une agence en LECTURE SEULE avec un token à privilèges MINIMAUX,
 * au lieu de réutiliser le JWT d'un agent.
 *
 * Critères d'acceptation :
 * - CONTRACT-013: POST /tv/session public (x-required-role NONE, scope agency), 9 codes,
 *   404 opaque anti-énumération, réponse role="DISPLAY" TTL 43200s
 * - CONTRACT-013: TvSessionRequest / TvSessionResponse au contrat public.yaml
 * - CONTRACT-013: joinAgencyEvent (join:agency, client→serveur) validé au contrat realtime
 * - CONTRACT-013: ALL_EVENTS = 11 événements (join:agency ajouté sans casser l'existant)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import {
  joinAgencyEvent,
  syncRequestEvent,
  ticketCalledEvent,
  syncStateEvent,
  queueUpdatedEvent,
  ALL_EVENTS,
  TV_SESSION_TTL_SECONDS,
  TV_DISPLAY_ROLE,
} from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PUBLIC_YAML_PATH = resolve(__dirname, "../openapi/public.yaml");
const raw = readFileSync(PUBLIC_YAML_PATH, "utf-8");
const doc = parse(raw) as Record<string, unknown>;

type OperationObject = {
  summary?: string;
  description?: string;
  tags?: string[];
  responses?: Record<string, unknown>;
  requestBody?: Record<string, unknown>;
  security?: unknown[];
  "x-tenant-scope"?: string;
  "x-required-role"?: string;
};

const paths = ((doc as { paths?: Record<string, Record<string, OperationObject>> })
  .paths ?? {}) as Record<string, Record<string, OperationObject>>;

function getOp(path: string, method: string): OperationObject | undefined {
  return paths[path]?.[method];
}

// ─── Critère 1 : constantes exportées ───────────────────────────────────────

describe("CONTRACT-013: constantes de session TV exportées", () => {
  it("CONTRACT-013: TV_SESSION_TTL_SECONDS vaut 43200 (12 h)", () => {
    expect(TV_SESSION_TTL_SECONDS).toBe(43200);
  });

  it("CONTRACT-013: TV_DISPLAY_ROLE vaut la constante 'DISPLAY'", () => {
    expect(TV_DISPLAY_ROLE).toBe("DISPLAY");
  });
});

// ─── Critère 2 : route POST /tv/session dans public.yaml ─────────────────────

describe("CONTRACT-013: POST /tv/session (token d'affichage TV public, lecture seule)", () => {
  it("CONTRACT-013: POST /tv/session existe", () => {
    const op = getOp("/tv/session", "post");
    expect(op, "POST /tv/session doit exister").toBeDefined();
  });

  it("CONTRACT-013: POST /tv/session est public (x-required-role NONE, security [])", () => {
    const op = getOp("/tv/session", "post");
    expect(op?.["x-required-role"], "x-required-role doit être NONE").toBe("NONE");
    expect(Array.isArray(op?.security), "security doit être un tableau vide (route publique)").toBe(
      true,
    );
    expect((op?.security ?? []).length, "security doit être vide (aucune auth)").toBe(0);
  });

  it("CONTRACT-013: POST /tv/session a x-tenant-scope agency", () => {
    const op = getOp("/tv/session", "post");
    expect(op?.["x-tenant-scope"], "x-tenant-scope doit être agency").toBe("agency");
  });

  it("CONTRACT-013: POST /tv/session documente les 9 codes de réponse", () => {
    const op = getOp("/tv/session", "post");
    const codes = Object.keys(op?.responses ?? {});
    for (const c of ["201", "400", "401", "403", "404", "409", "422", "429", "500"]) {
      expect(codes, `POST /tv/session doit documenter le code ${c}`).toContain(c);
    }
  });

  it("CONTRACT-013: POST /tv/session mentionne la lecture seule et le TTL 12 h (43200 s)", () => {
    const op = getOp("/tv/session", "post");
    const opStr = JSON.stringify(op);
    expect(
      opStr.includes("43200") || opStr.includes("12 h") || opStr.includes("12h"),
      "POST /tv/session doit mentionner le TTL 12 h / 43200 s",
    ).toBe(true);
    expect(opStr, "POST /tv/session doit mentionner la lecture seule").toMatch(
      /lecture seule|read-only|read only/i,
    );
  });

  it("CONTRACT-013: POST /tv/session documente le rate-limit", () => {
    const op = getOp("/tv/session", "post");
    const opStr = JSON.stringify(op).toLowerCase();
    expect(opStr, "POST /tv/session doit mentionner le rate-limit").toMatch(
      /rate.?limit|débit|429/i,
    );
  });

  it("CONTRACT-013: 404 de POST /tv/session est opaque (anti-énumération)", () => {
    const op = getOp("/tv/session", "post");
    const resp404 = JSON.stringify(op?.responses?.["404"] ?? {}).toLowerCase();
    expect(resp404, "le 404 doit être documenté").toBeTruthy();
    // Opaque : ne révèle pas l'existence/inexistence de l'agence de façon exploitable
    expect(resp404, "le 404 doit rester opaque (anti-énumération)").toMatch(
      /opaque|anti.?énumération|introuvable|not.?found/i,
    );
  });

  it("CONTRACT-013: 404 réutilise le schéma d'erreur partagé (core.yaml ErrorResponse)", () => {
    const op = getOp("/tv/session", "post");
    const resp404 = JSON.stringify(op?.responses?.["404"] ?? {});
    expect(resp404, "le 404 doit référencer core.yaml (errorSchema partagé)").toContain(
      "core.yaml",
    );
  });
});

// ─── Critère 3 : schémas TvSessionRequest / TvSessionResponse ────────────────

describe("CONTRACT-013: schémas TvSessionRequest / TvSessionResponse", () => {
  const schemas = ((doc as {
    components?: { schemas?: Record<string, Record<string, unknown>> };
  }).components?.schemas ?? {}) as Record<string, Record<string, unknown>>;

  it("CONTRACT-013: TvSessionRequest exige agencyId (uuid) et rien d'autre de requis", () => {
    const req = schemas["TvSessionRequest"];
    expect(req, "TvSessionRequest doit être défini").toBeDefined();
    const required = (req?.required ?? []) as string[];
    expect(required, "agencyId doit être requis").toContain("agencyId");
    const props = (req?.properties ?? {}) as Record<string, Record<string, unknown>>;
    expect(props["agencyId"]?.format, "agencyId doit être format uuid").toBe("uuid");
    // Aucun secret (données TV non-PII)
    expect(props["kioskSecret"], "TvSessionRequest ne doit exposer aucun secret").toBeUndefined();
    expect(props["password"], "TvSessionRequest ne doit exposer aucun secret").toBeUndefined();
  });

  it("CONTRACT-013: TvSessionResponse expose accessToken, expiresIn, agencyId, role", () => {
    const res = schemas["TvSessionResponse"];
    expect(res, "TvSessionResponse doit être défini").toBeDefined();
    const required = (res?.required ?? []) as string[];
    for (const field of ["accessToken", "expiresIn", "agencyId", "role"]) {
      expect(required, `TvSessionResponse doit requérir ${field}`).toContain(field);
    }
    const props = (res?.properties ?? {}) as Record<string, Record<string, unknown>>;
    expect(props["expiresIn"]?.type, "expiresIn doit être un integer").toBe("integer");
    expect(props["agencyId"]?.format, "agencyId doit être format uuid").toBe("uuid");
  });

  it("CONTRACT-013: TvSessionResponse.role est la constante 'DISPLAY'", () => {
    const res = schemas["TvSessionResponse"];
    const props = (res?.properties ?? {}) as Record<string, Record<string, unknown>>;
    const role = props["role"] ?? {};
    const roleEnum = (role["enum"] ?? []) as string[];
    const roleConst = role["const"];
    expect(
      roleConst === "DISPLAY" || roleEnum.includes("DISPLAY"),
      "role doit valoir la constante DISPLAY",
    ).toBe(true);
  });
});

// ─── Critère 4 : événement realtime join:agency ─────────────────────────────

describe("CONTRACT-013: joinAgencyEvent (join:agency, client→serveur)", () => {
  it("CONTRACT-013: joinAgencyEvent s'exporte avec name join:agency", () => {
    expect(joinAgencyEvent, "joinAgencyEvent doit exister").toBeDefined();
    expect(joinAgencyEvent.name).toBe("join:agency");
  });

  it("CONTRACT-013: join:agency est client→serveur (emitter client, consumer api-server)", () => {
    expect(joinAgencyEvent.emitter).toBe("client");
    expect(joinAgencyEvent.consumers).toContain("api-server");
  });

  it("CONTRACT-013: join:agency room agency:{agencyId}", () => {
    expect(joinAgencyEvent.room).toBe("agency:{agencyId}");
  });

  it("CONTRACT-013: join:agency valide un payload { agencyId: uuid }", () => {
    const ok = { agencyId: "550e8400-e29b-41d4-a716-446655440002" };
    expect(() => joinAgencyEvent.payloadSchema.parse(ok)).not.toThrow();
  });

  it("CONTRACT-013: join:agency rejette un agencyId non-uuid", () => {
    expect(() => joinAgencyEvent.payloadSchema.parse({ agencyId: "pas-un-uuid" })).toThrow();
  });

  it("CONTRACT-013: join:agency rejette un payload sans agencyId", () => {
    expect(() => joinAgencyEvent.payloadSchema.parse({})).toThrow();
  });

  it("CONTRACT-013: ALL_EVENTS contient 11 événements dont join:agency, sans casser l'existant", () => {
    expect(ALL_EVENTS).toHaveLength(11);
    const names = ALL_EVENTS.map((e) => e.name);
    expect(names).toContain("join:agency");
    // Non-régression : les événements existants restent présents
    for (const existing of [
      syncRequestEvent.name,
      ticketCalledEvent.name,
      syncStateEvent.name,
      queueUpdatedEvent.name,
    ]) {
      expect(names, `${existing} doit rester présent`).toContain(existing);
    }
  });
});
