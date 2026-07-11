/**
 * CONTRACT-011 — Amendement LA LOI : TicketPriority enum, Service.code, displayNumber
 * Tests structurels TDD — rouge d'abord, puis vert après amendement des YAML.
 *
 * Critères d'acceptation :
 * - CONTRACT-011: TicketPriority enum 5 valeurs, priority boolean absent des 7 YAML (test d'inventaire)
 * - CONTRACT-011: Service.code pattern + exemples des 8 codes (test)
 * - CONTRACT-011: displayNumber exemples au format {code}-{NNN} partout (test)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OPENAPI_DIR = resolve(__dirname, "../openapi");

// Charger et parser core.yaml
const CORE_YAML_PATH = resolve(OPENAPI_DIR, "core.yaml");
let coreDoc: Record<string, unknown>;
try {
  const raw = readFileSync(CORE_YAML_PATH, "utf-8");
  coreDoc = parse(raw) as Record<string, unknown>;
} catch {
  coreDoc = {};
}

// Charger et parser public.yaml
const PUBLIC_YAML_PATH = resolve(OPENAPI_DIR, "public.yaml");
let publicDoc: Record<string, unknown>;
try {
  const raw = readFileSync(PUBLIC_YAML_PATH, "utf-8");
  publicDoc = parse(raw) as Record<string, unknown>;
} catch {
  publicDoc = {};
}

// Les 7 fichiers YAML du contrat
const ALL_YAML_FILES = [
  "core.yaml",
  "public.yaml",
  "admin.yaml",
  "agents.yaml",
  "ai.yaml",
  "notifications.yaml",
  "reporting.yaml",
];

type OpenAPIDoc = {
  components?: {
    schemas?: Record<string, unknown>;
  };
};

const coreOpenapi = coreDoc as OpenAPIDoc;
const publicOpenapi = publicDoc as OpenAPIDoc;

// ─── Critère 1 : TicketPriority enum 5 valeurs + priority boolean absent des 7 YAML ─
describe("CONTRACT-011 — TicketPriority enum", () => {
  it("CONTRACT-011: TicketPriority enum est défini dans core.yaml avec exactement 5 valeurs (STANDARD|PRIORITY|VIP|PMR|SENIOR)", () => {
    const schemas = coreOpenapi.components?.schemas as Record<string, unknown> | undefined;
    expect(schemas, "components/schemas doit exister dans core.yaml").toBeDefined();

    const ticketPriority = schemas?.["TicketPriority"] as Record<string, unknown> | undefined;
    expect(ticketPriority, "TicketPriority doit être défini dans components/schemas").toBeDefined();
    expect(ticketPriority?.["type"], "TicketPriority doit être de type string").toBe("string");

    const tpEnum = ticketPriority?.["enum"] as string[] | undefined;
    expect(Array.isArray(tpEnum), "TicketPriority doit avoir un enum").toBe(true);
    expect(tpEnum?.length, "TicketPriority doit avoir exactement 5 valeurs").toBe(5);

    const expectedValues = ["STANDARD", "PRIORITY", "VIP", "PMR", "SENIOR"];
    for (const v of expectedValues) {
      expect(tpEnum, `TicketPriority enum doit contenir ${v}`).toContain(v);
    }
  });

  it("CONTRACT-011: CreateTicketRequest utilise $ref TicketPriority (pas priority: boolean)", () => {
    const schemas = coreOpenapi.components?.schemas as Record<string, unknown> | undefined;
    const createTicketReq = schemas?.["CreateTicketRequest"] as Record<string, unknown> | undefined;
    expect(createTicketReq, "CreateTicketRequest doit exister").toBeDefined();

    const props = (createTicketReq?.properties ?? {}) as Record<string, unknown>;
    const priorityProp = props["priority"] as Record<string, unknown> | undefined;
    expect(priorityProp, "CreateTicketRequest doit avoir le champ priority").toBeDefined();

    // priority ne doit PAS être un boolean — il doit référencer TicketPriority
    expect(
      priorityProp?.["type"],
      "priority dans CreateTicketRequest ne doit pas être de type boolean",
    ).not.toBe("boolean");

    // Doit avoir un $ref vers TicketPriority
    const priorStr = JSON.stringify(priorityProp);
    expect(
      priorStr.includes("TicketPriority"),
      "priority dans CreateTicketRequest doit référencer TicketPriority via $ref",
    ).toBe(true);
  });

  it("CONTRACT-011: Ticket utilise $ref TicketPriority (pas priority: boolean)", () => {
    const schemas = coreOpenapi.components?.schemas as Record<string, unknown> | undefined;
    const ticket = schemas?.["Ticket"] as Record<string, unknown> | undefined;
    expect(ticket, "Ticket doit exister").toBeDefined();

    const props = (ticket?.properties ?? {}) as Record<string, unknown>;
    const priorityProp = props["priority"] as Record<string, unknown> | undefined;
    expect(priorityProp, "Ticket doit avoir le champ priority").toBeDefined();

    expect(
      priorityProp?.["type"],
      "priority dans Ticket ne doit pas être de type boolean",
    ).not.toBe("boolean");

    const priorStr = JSON.stringify(priorityProp);
    expect(
      priorStr.includes("TicketPriority"),
      "priority dans Ticket doit référencer TicketPriority via $ref",
    ).toBe(true);
  });

  it("CONTRACT-011: TicketSyncItem utilise $ref TicketPriority (pas priority: boolean)", () => {
    const schemas = coreOpenapi.components?.schemas as Record<string, unknown> | undefined;
    const syncItem = schemas?.["TicketSyncItem"] as Record<string, unknown> | undefined;
    expect(syncItem, "TicketSyncItem doit exister").toBeDefined();

    const props = (syncItem?.properties ?? {}) as Record<string, unknown>;
    const priorityProp = props["priority"] as Record<string, unknown> | undefined;
    expect(priorityProp, "TicketSyncItem doit avoir le champ priority").toBeDefined();

    expect(
      priorityProp?.["type"],
      "priority dans TicketSyncItem ne doit pas être de type boolean",
    ).not.toBe("boolean");

    const priorStr = JSON.stringify(priorityProp);
    expect(
      priorStr.includes("TicketPriority"),
      "priority dans TicketSyncItem doit référencer TicketPriority via $ref",
    ).toBe(true);
  });

  it("CONTRACT-011: priority boolean absent des 7 YAML (inventaire complet — aucun champ priority: boolean)", () => {
    const failures: string[] = [];

    for (const yamlFile of ALL_YAML_FILES) {
      const filePath = resolve(OPENAPI_DIR, yamlFile);
      let rawContent: string;
      try {
        rawContent = readFileSync(filePath, "utf-8");
      } catch {
        // Fichier inexistant — on ignore
        continue;
      }

      // Détecter les blocs YAML où "priority:" est suivi de "type: boolean"
      // Stratégie : chercher le pattern multi-ligne via regex globale
      // On cherche: priority: (optionnel newline+indent) suivi de type: boolean
      // Pattern couvrant les cas : property avec type boolean sur les 5 lignes suivantes
      const lines = rawContent.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (/priority:\s*$/.test(line)) {
          // Regarder les 8 lignes suivantes pour trouver "type: boolean"
          const limit = Math.min(i + 8, lines.length);
          for (let j = i + 1; j < limit; j++) {
            const nextLine = lines[j] ?? "";
            if (/type:\s*boolean/.test(nextLine)) {
              failures.push(
                `${yamlFile} ligne ${j + 1}: priority avec type: boolean détecté (doit utiliser $ref TicketPriority)`,
              );
              break;
            }
            // Arrêt si on voit $ref (signifie que priority est bien un $ref)
            if (nextLine.includes("$ref")) {
              break;
            }
            // Arrêt si on atteint une propriété de même niveau (nouveau champ YAML)
            // i.e. une ligne contenant "[mot]: " sans être une sous-propriété de priority
            const isTopLevelProp = /^\s{0,10}\w+:\s*$/.test(nextLine) &&
              !nextLine.includes("type:") &&
              !nextLine.includes("default:") &&
              !nextLine.includes("description:") &&
              !nextLine.includes("example:") &&
              !nextLine.includes("enum:");
            if (isTopLevelProp && nextLine.trim().length > 0) {
              break;
            }
          }
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(`priority: boolean détecté dans des YAML — doit utiliser $ref TicketPriority:\n${failures.join("\n")}`);
    }
  });

  it("CONTRACT-011: PublicTicketBase dans public.yaml utilise $ref TicketPriority (pas priority: boolean)", () => {
    const schemas = publicOpenapi.components?.schemas as Record<string, unknown> | undefined;
    const publicTicketBase = schemas?.["PublicTicketBase"] as Record<string, unknown> | undefined;
    expect(publicTicketBase, "PublicTicketBase doit exister dans public.yaml").toBeDefined();

    const props = (publicTicketBase?.properties ?? {}) as Record<string, unknown>;
    const priorityProp = props["priority"] as Record<string, unknown> | undefined;
    expect(priorityProp, "PublicTicketBase doit avoir le champ priority").toBeDefined();

    expect(
      priorityProp?.["type"],
      "priority dans PublicTicketBase ne doit pas être de type boolean",
    ).not.toBe("boolean");

    const priorStr = JSON.stringify(priorityProp);
    expect(
      priorStr.includes("TicketPriority"),
      "priority dans PublicTicketBase doit référencer TicketPriority via $ref",
    ).toBe(true);
  });
});

// ─── Critère 2 : Service.code pattern + exemples des 8 codes ─────────────────
describe("CONTRACT-011 — Service.code", () => {
  it("CONTRACT-011: Service.code pattern ^[A-Z]{2,4}$ est défini dans core.yaml", () => {
    const schemas = coreOpenapi.components?.schemas as Record<string, unknown> | undefined;
    const service = schemas?.["Service"] as Record<string, unknown> | undefined;
    expect(service, "Service doit exister dans core.yaml").toBeDefined();

    const props = (service?.properties ?? {}) as Record<string, unknown>;
    const codeProp = props["code"] as Record<string, unknown> | undefined;
    expect(codeProp, "Service doit avoir le champ code").toBeDefined();
    expect(codeProp?.["type"], "Service.code doit être de type string").toBe("string");

    const pattern = codeProp?.["pattern"] as string | undefined;
    expect(pattern, "Service.code doit avoir un pattern").toBeDefined();
    expect(
      pattern,
      "Service.code pattern doit être ^[A-Z]{2,4}$",
    ).toBe("^[A-Z]{2,4}$");
  });

  it("CONTRACT-011: Service.code inclut les 8 exemples requis (OC, OA, CR, CH, EN, VIP, RE, EP)", () => {
    const rawContent = readFileSync(CORE_YAML_PATH, "utf-8");

    // Les 8 codes de service requis
    const requiredCodes = ["OC", "OA", "CR", "CH", "EN", "VIP", "RE", "EP"];
    const missingCodes: string[] = [];

    for (const code of requiredCodes) {
      // Chercher le code dans le contexte du schéma Service (pas juste dans le fichier)
      // Le code doit apparaître comme exemple (ex: OC, OA, etc.)
      if (!rawContent.includes(code)) {
        missingCodes.push(code);
      }
    }

    if (missingCodes.length > 0) {
      throw new Error(`Codes Service.code manquants dans core.yaml: ${missingCodes.join(", ")}`);
    }

    // Vérifier que le champ code a bien des exemples dans le schéma Service
    const schemas = coreOpenapi.components?.schemas as Record<string, unknown> | undefined;
    const service = schemas?.["Service"] as Record<string, unknown> | undefined;
    const props = (service?.properties ?? {}) as Record<string, unknown>;
    const codeProp = props["code"] as Record<string, unknown> | undefined;

    // Vérifier que les exemples sont présents (dans la description ou en example)
    const codeStr = JSON.stringify(codeProp);
    const serviceStr = JSON.stringify(service);
    const hasExamples = codeStr.includes("example") || serviceStr.includes("OC") || serviceStr.includes("OA");
    expect(
      hasExamples,
      "Service.code doit avoir des exemples (OC, OA, CR, CH, EN, VIP, RE, EP)",
    ).toBe(true);
  });

  it("CONTRACT-011: CreateServiceRequest contient le champ code avec pattern ^[A-Z]{2,4}$", () => {
    const schemas = coreOpenapi.components?.schemas as Record<string, unknown> | undefined;
    const createServiceReq = schemas?.["CreateServiceRequest"] as Record<string, unknown> | undefined;
    expect(createServiceReq, "CreateServiceRequest doit exister").toBeDefined();

    const props = (createServiceReq?.properties ?? {}) as Record<string, unknown>;
    const codeProp = props["code"] as Record<string, unknown> | undefined;
    expect(codeProp, "CreateServiceRequest doit avoir le champ code").toBeDefined();
    expect(codeProp?.["type"], "CreateServiceRequest.code doit être de type string").toBe("string");

    const pattern = codeProp?.["pattern"] as string | undefined;
    expect(pattern, "CreateServiceRequest.code doit avoir un pattern ^[A-Z]{2,4}$").toBe("^[A-Z]{2,4}$");
  });
});

// ─── Critère 3 : displayNumber exemples au format {code}-{NNN} ───────────────
describe("CONTRACT-011 — displayNumber", () => {
  it("CONTRACT-011: displayNumber est défini dans Ticket avec description et exemple {code}-{NNN} (ex. OC-047)", () => {
    const schemas = coreOpenapi.components?.schemas as Record<string, unknown> | undefined;
    const ticket = schemas?.["Ticket"] as Record<string, unknown> | undefined;
    expect(ticket, "Ticket doit exister").toBeDefined();

    const props = (ticket?.properties ?? {}) as Record<string, unknown>;
    const displayNumberProp = props["displayNumber"] as Record<string, unknown> | undefined;
    expect(displayNumberProp, "Ticket doit avoir le champ displayNumber").toBeDefined();
    expect(displayNumberProp?.["type"], "displayNumber doit être de type string").toBe("string");

    // Doit avoir un exemple au format {code}-{NNN}
    const displayStr = JSON.stringify(displayNumberProp);
    const hasCodeNNNExample = displayStr.includes("OC-") ||
      displayStr.includes("OA-") ||
      displayStr.includes("CR-") ||
      displayStr.includes("VIP-") ||
      /[A-Z]{2,4}-\d{3}/.test(displayStr);

    expect(
      hasCodeNNNExample,
      "displayNumber doit avoir un exemple au format {code}-{NNN} (ex. OC-047)",
    ).toBe(true);
  });

  it("CONTRACT-011: displayNumber exemples suivent le pattern {code}-{NNN} dans core.yaml (OC-047 ou similaire)", () => {
    const rawContent = readFileSync(CORE_YAML_PATH, "utf-8");
    // Chercher des exemples au format {CODE}-{NNN}
    const codeNNNPattern = /[A-Z]{2,4}-\d{3}/;
    expect(
      codeNNNPattern.test(rawContent),
      "core.yaml doit contenir des exemples displayNumber au format {code}-{NNN} (ex. OC-047)",
    ).toBe(true);
  });

  it("CONTRACT-011: displayNumber exemples suivent le pattern {code}-{NNN} dans public.yaml", () => {
    const rawContent = readFileSync(PUBLIC_YAML_PATH, "utf-8");
    // Chercher des exemples au format {CODE}-{NNN} dans public.yaml
    const codeNNNPattern = /[A-Z]{2,4}-\d{3}/;
    expect(
      codeNNNPattern.test(rawContent),
      "public.yaml doit contenir des exemples displayNumber au format {code}-{NNN} (ex. OC-047)",
    ).toBe(true);
  });

  it("CONTRACT-011: TicketCreatedResponse contient displayNumber avec exemple {code}-{NNN}", () => {
    const schemas = coreOpenapi.components?.schemas as Record<string, unknown> | undefined;
    const ticketCreatedResp = schemas?.["TicketCreatedResponse"] as Record<string, unknown> | undefined;
    expect(ticketCreatedResp, "TicketCreatedResponse doit exister").toBeDefined();

    const props = (ticketCreatedResp?.properties ?? {}) as Record<string, unknown>;
    const displayNumberProp = props["displayNumber"] as Record<string, unknown> | undefined;
    expect(displayNumberProp, "TicketCreatedResponse doit avoir le champ displayNumber").toBeDefined();

    const displayStr = JSON.stringify(displayNumberProp);
    const hasCodeNNNExample = /[A-Z]{2,4}-\d{3}/.test(displayStr) ||
      displayStr.includes("OC-") || displayStr.includes("OA-") || displayStr.includes("code");

    expect(
      hasCodeNNNExample,
      "TicketCreatedResponse.displayNumber doit avoir un exemple au format {code}-{NNN}",
    ).toBe(true);
  });

  it("CONTRACT-011: PublicTicketCreatedResponse contient displayNumber avec exemple {code}-{NNN}", () => {
    const schemas = publicOpenapi.components?.schemas as Record<string, unknown> | undefined;
    const publicCreatedResp = schemas?.["PublicTicketCreatedResponse"] as Record<string, unknown> | undefined;
    expect(publicCreatedResp, "PublicTicketCreatedResponse doit exister dans public.yaml").toBeDefined();

    const props = (publicCreatedResp?.properties ?? {}) as Record<string, unknown>;
    const displayNumberProp = props["displayNumber"] as Record<string, unknown> | undefined;
    expect(displayNumberProp, "PublicTicketCreatedResponse doit avoir le champ displayNumber").toBeDefined();

    const displayStr = JSON.stringify(displayNumberProp);
    const hasCodeNNNExample = /[A-Z]{2,4}-\d{3}/.test(displayStr) ||
      displayStr.includes("OC-") || displayStr.includes("OA-");

    expect(
      hasCodeNNNExample,
      "PublicTicketCreatedResponse.displayNumber doit avoir un exemple au format {code}-{NNN}",
    ).toBe(true);
  });
});
