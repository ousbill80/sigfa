/**
 * CONTRACT-014 — Tests structurels (additif, non-breaking)
 * Chaque test est nommé "CONTRACT-014: <critère>".
 *
 * Couvre (décision PO — audit UX borne + dettes consignées) :
 *  1. Disponibilité des conseillers : PublicRelationshipManager gagne
 *     `available: boolean` (présence AUJOURD'HUI, dérivée serveur de la machine
 *     à états agents — JAMAIS d'horaire personnel = zéro PII préservé, D5).
 *  2. Session borne : KioskSessionResponse gagne `bankId` (uuid, donnée
 *     d'enseigne publique) pour éliminer NEXT_PUBLIC_BANK_ID côté borne.
 *  3. Exports de sous-chemins du package : `./events/*` exporté (le dist API
 *     importe `@sigfa/contracts/events/realtime.js` — exécutable sans hook
 *     de résolution) + export racine pointant vers un fichier réellement émis.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PUBLIC_YAML_PATH = resolve(__dirname, "../openapi/public.yaml");
const PKG_JSON_PATH = resolve(__dirname, "../package.json");

function loadYaml(path: string): Record<string, unknown> {
  try {
    return parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type OperationObject = {
  responses?: Record<string, unknown>;
  "x-tenant-scope"?: string;
  "x-required-role"?: string;
  security?: unknown;
};

type Doc = {
  paths?: Record<string, Record<string, OperationObject>>;
  components?: { schemas?: Record<string, unknown> };
};

const publicDoc = loadYaml(PUBLIC_YAML_PATH);
const publicPaths = ((publicDoc as Doc).paths ?? {}) as Record<
  string,
  Record<string, OperationObject>
>;
const publicSchemas = ((publicDoc as Doc).components?.schemas ?? {}) as Record<
  string,
  Record<string, unknown>
>;

const pkgJson = JSON.parse(readFileSync(PKG_JSON_PATH, "utf-8")) as {
  exports?: Record<string, unknown>;
};

// ─── 1. Disponibilité des conseillers (available: boolean) ────────────────────
describe("CONTRACT-014 — disponibilité des conseillers (available, zéro PII)", () => {
  const RM_PATH = "/public/agencies/{agencyId}/relationship-managers";

  it("CONTRACT-014: PublicRelationshipManager gagne available (boolean, required — dérivé serveur, toujours présent)", () => {
    const schema = publicSchemas["PublicRelationshipManager"];
    expect(schema, "PublicRelationshipManager doit être défini").toBeDefined();
    const props = (schema?.["properties"] ?? {}) as Record<string, Record<string, unknown>>;
    const required = (schema?.["required"] ?? []) as string[];

    expect(props["available"], "PublicRelationshipManager doit avoir available").toBeDefined();
    expect(props["available"]?.["type"], "available doit être boolean").toBe("boolean");
    expect(
      required.includes("available"),
      "available doit être required (dérivé serveur : toujours calculable, jamais absent — additif non-breaking en réponse)",
    ).toBe(true);
  });

  it("CONTRACT-014: available documente la dérivation temps réel (machine à états agents) et l'absence d'horaire personnel (zéro PII)", () => {
    const schema = publicSchemas["PublicRelationshipManager"];
    const props = (schema?.["properties"] ?? {}) as Record<string, Record<string, unknown>>;
    const desc = String(props["available"]?.["description"] ?? "");
    expect(desc, "available doit documenter la dérivation du statut temps réel").toMatch(
      /temps réel|machine à états/i,
    );
    expect(desc, "available doit documenter que l'horaire personnel n'est JAMAIS exposé (zéro PII)").toMatch(
      /horaire/i,
    );
    expect(desc, "available doit mentionner zéro PII").toMatch(/PII/i);
  });

  it("CONTRACT-014: la garde anti-PII est préservée — additionalProperties:false et EXACTEMENT {id, displayName, photoUrl?, available}", () => {
    const schema = publicSchemas["PublicRelationshipManager"];
    expect(
      schema?.["additionalProperties"],
      "PublicRelationshipManager doit garder additionalProperties:false",
    ).toBe(false);
    const props = (schema?.["properties"] ?? {}) as Record<string, unknown>;
    expect(Object.keys(props).sort(), "aucun autre champ ne doit apparaître (zéro PII, D5)").toEqual([
      "available",
      "displayName",
      "id",
      "photoUrl",
    ]);
  });

  it("CONTRACT-014: non-breaking — id/displayName restent required, photoUrl reste optionnel", () => {
    const schema = publicSchemas["PublicRelationshipManager"];
    const required = (schema?.["required"] ?? []) as string[];
    expect(required.includes("id"), "id doit RESTER required").toBe(true);
    expect(required.includes("displayName"), "displayName doit RESTER required").toBe(true);
    expect(required.includes("photoUrl"), "photoUrl doit RESTER optionnel").toBe(false);
  });

  it("CONTRACT-014: l'exemple 200 de la liste conseillers inclut available", () => {
    const op = publicPaths[RM_PATH]?.["get"];
    expect(op, `GET ${RM_PATH} doit exister`).toBeDefined();
    const opStr = JSON.stringify(op);
    expect(opStr, "l'exemple de réponse doit inclure available").toContain('"available"');
  });
});

// ─── 2. bankId dans la session borne ──────────────────────────────────────────
describe("CONTRACT-014 — bankId dans KioskSessionResponse (theming borne)", () => {
  it("CONTRACT-014: KioskSessionResponse gagne bankId (uuid, required — donnée d'enseigne publique)", () => {
    const schema = publicSchemas["KioskSessionResponse"];
    expect(schema, "KioskSessionResponse doit être défini").toBeDefined();
    const props = (schema?.["properties"] ?? {}) as Record<string, Record<string, unknown>>;
    const required = (schema?.["required"] ?? []) as string[];

    expect(props["bankId"], "KioskSessionResponse doit avoir bankId").toBeDefined();
    expect(props["bankId"]?.["type"]).toBe("string");
    expect(props["bankId"]?.["format"], "bankId doit être format uuid").toBe("uuid");
    expect(
      required.includes("bankId"),
      "bankId doit être required (le serveur connaît toujours la banque de la borne)",
    ).toBe(true);
  });

  it("CONTRACT-014: bankId documente son rôle (enseigne publique / theming, remplace NEXT_PUBLIC_BANK_ID)", () => {
    const schema = publicSchemas["KioskSessionResponse"];
    const props = (schema?.["properties"] ?? {}) as Record<string, Record<string, unknown>>;
    const desc = String(props["bankId"]?.["description"] ?? "");
    expect(desc, "bankId doit documenter la donnée d'enseigne publique (theming/logo)").toMatch(
      /enseigne|theming|logo/i,
    );
  });

  it("CONTRACT-014: non-breaking — accessToken/expiresIn/kioskId/agencyId restent required", () => {
    const schema = publicSchemas["KioskSessionResponse"];
    const required = (schema?.["required"] ?? []) as string[];
    for (const field of ["accessToken", "expiresIn", "kioskId", "agencyId"]) {
      expect(required.includes(field), `${field} doit RESTER required`).toBe(true);
    }
  });

  it("CONTRACT-014: l'exemple 201 de POST /kiosk/session inclut bankId", () => {
    const op = publicPaths["/kiosk/session"]?.["post"];
    expect(op, "POST /kiosk/session doit exister").toBeDefined();
    const opStr = JSON.stringify(op);
    expect(opStr, "l'exemple de réponse 201 doit inclure bankId").toContain('"bankId"');
  });
});

// ─── 3. Exports de sous-chemins du package ────────────────────────────────────
describe("CONTRACT-014 — exports de sous-chemins @sigfa/contracts", () => {
  it("CONTRACT-014: le package exporte ./events/* vers ./dist/events/* (dist API exécutable sans hook de résolution)", () => {
    const exportsMap = pkgJson.exports ?? {};
    const eventsExport = exportsMap["./events/*"];
    expect(
      eventsExport,
      "package.json doit exporter le sous-chemin ./events/* (importé par apps/api : @sigfa/contracts/events/realtime.js)",
    ).toBeDefined();
    const target =
      typeof eventsExport === "string"
        ? eventsExport
        : ((eventsExport as Record<string, string>)["default"] ?? "");
    expect(target, "./events/* doit pointer vers le build ./dist/events/*").toBe("./dist/events/*");
  });

  it("CONTRACT-014: l'export racine pointe vers un fichier réellement émis par tsc (dist/src/index.js, rootDir='.')", () => {
    const exportsMap = pkgJson.exports ?? {};
    const rootExport = exportsMap["."];
    expect(rootExport, "package.json doit exporter '.'").toBeDefined();
    const target =
      typeof rootExport === "string"
        ? rootExport
        : ((rootExport as Record<string, string>)["default"] ?? "");
    // tsc emploie rootDir:"." (include: src, events, generated/types) → l'entrée
    // est émise en dist/src/index.js, PAS en dist/index.js (dette corrigée).
    expect(target, "l'export racine doit cibler ./dist/src/index.js").toBe("./dist/src/index.js");
  });

  it("CONTRACT-014: le sous-chemin ./events/realtime.js correspond à une source du contrat (events/realtime.ts)", () => {
    const sourcePath = resolve(__dirname, "../events/realtime.ts");
    expect(
      readFileSync(sourcePath, "utf-8").length > 0,
      "events/realtime.ts doit exister (source du sous-chemin exporté)",
    ).toBe(true);
  });
});
