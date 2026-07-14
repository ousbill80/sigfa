/**
 * Tests unitaires — configs de tenants de seed (`demo`, `bicici`).
 *
 * Vérifie que les configs respectent le contrat produit :
 * - BICICI : slug/couleurs/logo valides, 16 agences réelles, welcomeMessages
 *   FR/EN UNIQUEMENT (décision PO 2026-07), horaires HH:MM, guichets + kiosque
 *   sur les 2 premières agences (même volume que le tenant démo).
 * - DEMO : non-régression stricte des UUIDs et données historiques (DB-003).
 * - Aucune collision d'IDs entre tenants.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { contrastRatio, MIN_CONTRAST_RATIO } from "@sigfa/schemas";
import { buildAppliedTheme } from "src/seed/tenant-seed.js";
import { BICICI_TENANT, BICICI_BANK_ID } from "./bicici.js";
import {
  DEMO_TENANT,
  DEMO_BANK_ID,
  DEMO_AGENCY_1_ID,
  DEMO_AGENCY_2_ID,
  DEMO_COUNTER_1_ID,
  DEMO_COUNTER_2_ID,
  DEMO_KIOSK_1_ID,
} from "./demo.js";
import { TENANT_SEED_CONFIGS } from "./index.js";

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ─────────────────────────────────────────────────────────────────────────────
// BICICI
// ─────────────────────────────────────────────────────────────────────────────

describe("SEED-TENANT: config BICICI — identité et branding", () => {
  it("slug 'bicici' valide (kebab-case) et nom 'BICICI'", () => {
    expect(BICICI_TENANT.slug).toBe("bicici");
    expect(BICICI_TENANT.slug).toMatch(SLUG_RE);
    expect(BICICI_TENANT.name).toBe("BICICI");
  });

  it("bankId UUID déterministe distinct du tenant démo", () => {
    expect(BICICI_TENANT.bankId).toBe(BICICI_BANK_ID);
    expect(BICICI_BANK_ID).toMatch(UUID_RE);
    expect(BICICI_BANK_ID).not.toBe(DEMO_BANK_ID);
  });

  it("couleurs hex valides — primary = vert BICICI #005e42, background blanc", () => {
    const { primary, secondary, background } = BICICI_TENANT.theme.requestedColors;
    expect(primary).toBe("#005e42");
    expect(background).toBe("#ffffff");
    for (const color of [primary, secondary, background]) {
      expect(color).toMatch(HEX_COLOR_RE);
    }
  });

  it("le thème appliqué (contraste corrigé) est ≥ 4.5:1 sur le fond", () => {
    const theme = buildAppliedTheme(BICICI_TENANT.theme);
    const applied = theme.appliedColors!;
    expect(contrastRatio(applied["primary"]!, applied["background"]!)).toBeGreaterThanOrEqual(
      MIN_CONTRAST_RATIO
    );
    expect(contrastRatio(applied["secondary"]!, applied["background"]!)).toBeGreaterThanOrEqual(
      MIN_CONTRAST_RATIO
    );
  });

  it("welcomeMessages FR/EN UNIQUEMENT (décision PO : pas d'autres langues)", () => {
    const messages = BICICI_TENANT.theme.welcomeMessages;
    expect(Object.keys(messages).sort()).toEqual(["en", "fr"]);
    expect(messages.fr).toBe("Bienvenue à la BICICI");
    expect(messages.en).toBe("Welcome to BICICI");
  });

  it("logoUrl est un chemin servable de config (jamais en dur dans les composants)", () => {
    expect(BICICI_TENANT.theme.logoUrl).toBe("/tenants/bicici/logo.png");
  });
});

describe("SEED-TENANT: config BICICI — réseau d'agences", () => {
  it("exactement 16 agences, IDs UUID déterministes uniques", () => {
    expect(BICICI_TENANT.agencies).toHaveLength(16);
    const ids = BICICI_TENANT.agencies.map((a) => a.id);
    expect(new Set(ids).size).toBe(16);
    for (const id of ids) {
      expect(id).toMatch(UUID_RE);
      expect(id.startsWith("b1c1c101-")).toBe(true);
    }
  });

  it("le siège Plateau porte adresse et téléphone officiels", () => {
    const siege = BICICI_TENANT.agencies[0]!;
    expect(siege.name).toBe("Agence Plateau Siège");
    expect(siege.address).toContain("Franchet d'Espérey");
    expect(siege.phone).toBe("+225 27 20 20 16 00");
  });

  it("villes : Abidjan sauf San Pedro, Bouaké et Daloa", () => {
    const cities = BICICI_TENANT.agencies.map((a) => a.city);
    expect(cities.filter((c) => c === "Abidjan")).toHaveLength(13);
    expect(cities).toContain("San Pedro");
    expect(cities).toContain("Bouaké");
    expect(cities).toContain("Daloa");
  });

  it("chaque agence a un horaire Lun–Ven 08:00–15:45 au format HH:MM", () => {
    for (const agency of BICICI_TENANT.agencies) {
      const schedule = agency.weeklySchedule!;
      for (const day of ["monday", "tuesday", "wednesday", "thursday", "friday"] as const) {
        const slot = schedule[day];
        expect(slot, `${agency.name} : ${day} manquant`).toBeDefined();
        expect(slot!.start).toMatch(HHMM_RE);
        expect(slot!.end).toMatch(HHMM_RE);
        expect(slot!.start).toBe("08:00");
        expect(slot!.end).toBe("15:45");
      }
      // Jamais d'ouverture le dimanche
      expect(schedule.sunday).toBeUndefined();
    }
  });

  it("les agences ouvertes le samedi le sont 07:15–13:00", () => {
    const saturdayAgencies = BICICI_TENANT.agencies.filter(
      (a) => a.weeklySchedule?.saturday !== undefined
    );
    expect(saturdayAgencies.length).toBeGreaterThanOrEqual(1);
    for (const agency of saturdayAgencies) {
      expect(agency.weeklySchedule!.saturday).toEqual({ start: "07:15", end: "13:00" });
    }
  });

  it("guichets + kiosque sur les 2 premières agences (même volume que le tenant démo)", () => {
    const [first, second, ...rest] = BICICI_TENANT.agencies;
    for (const agency of [first!, second!]) {
      expect(agency.counters, `${agency.name} sans guichets`).toHaveLength(2);
      expect(agency.kiosks, `${agency.name} sans kiosque`).toHaveLength(1);
    }
    for (const agency of rest) {
      expect(agency.counters).toBeUndefined();
      expect(agency.kiosks).toBeUndefined();
    }
    // Unicité des IDs guichets/kiosques
    const counterIds = [first!, second!].flatMap((a) => (a.counters ?? []).map((c) => c.id));
    const kioskIds = [first!, second!].flatMap((a) => (a.kiosks ?? []).map((k) => k.id));
    expect(new Set(counterIds).size).toBe(counterIds.length);
    expect(new Set(kioskIds).size).toBe(kioskIds.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEMO — non-régression stricte (DB-003/DB-009)
// ─────────────────────────────────────────────────────────────────────────────

describe("SEED-TENANT: config DEMO — non-régression des données historiques", () => {
  it("identité inchangée : bankId, nom, slug, domaine email", () => {
    expect(DEMO_TENANT.bankId).toBe("d0000000-1111-4000-8000-000000000001");
    expect(DEMO_TENANT.name).toBe("Banque de Démonstration SIGFA");
    expect(DEMO_TENANT.slug).toBe("demo-sigfa");
    expect(DEMO_TENANT.idNamespace).toBe("demo");
    expect(DEMO_TENANT.userEmailDomain).toBe("sigfa-demo.ci");
  });

  it("2 agences historiques avec leurs UUIDs exacts", () => {
    expect(DEMO_TENANT.agencies).toHaveLength(2);
    expect(DEMO_TENANT.agencies[0]!.id).toBe(DEMO_AGENCY_1_ID);
    expect(DEMO_TENANT.agencies[0]!.name).toBe("Agence Centre - Démo");
    expect(DEMO_TENANT.agencies[1]!.id).toBe(DEMO_AGENCY_2_ID);
    expect(DEMO_TENANT.agencies[1]!.name).toBe("Agence Plateau - Démo");
  });

  it("guichets et kiosque historiques (IDs exacts, agence 1 uniquement)", () => {
    const agency1 = DEMO_TENANT.agencies[0]!;
    expect(agency1.counters!.map((c) => c.id)).toEqual([DEMO_COUNTER_1_ID, DEMO_COUNTER_2_ID]);
    expect(agency1.kiosks!.map((k) => k.id)).toEqual([DEMO_KIOSK_1_ID]);
    expect(DEMO_TENANT.agencies[1]!.counters).toBeUndefined();
  });

  it("conseillers publics historiques (MODEL-DB-B) : Awa Koné (AGENT), Kouadio N'Guessan (MANAGER)", () => {
    expect(DEMO_TENANT.relationshipManagers!["AGENT"]!.displayName).toBe("Awa Koné");
    expect(DEMO_TENANT.relationshipManagers!["MANAGER"]!.displayName).toBe("Kouadio N'Guessan");
  });

  it("config WhatsApp historique (DB-NOTIF) : numéro, secret de démo, mot-clé '1' → OC agence 1", () => {
    const wa = DEMO_TENANT.whatsapp!;
    expect(wa.businessNumber).toBe("+2250700000000");
    expect(wa.webhookSecret).toBe("demo-whatsapp-webhook-secret");
    expect(wa.defaultAgencyId).toBe(DEMO_AGENCY_1_ID);
    expect(wa.menuMappings).toEqual([
      { keyword: "1", agencyId: DEMO_AGENCY_1_ID, serviceCode: "OC" },
    ]);
  });

  it("welcomeMessages FR/EN uniquement pour le tenant démo aussi", () => {
    expect(Object.keys(DEMO_TENANT.theme.welcomeMessages).sort()).toEqual(["en", "fr"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Registre et isolation inter-tenants
// ─────────────────────────────────────────────────────────────────────────────

describe("SEED-TENANT: registre des tenants — cohérence et isolation", () => {
  it("le registre mappe chaque slug vers la config du même slug", () => {
    for (const [slug, config] of Object.entries(TENANT_SEED_CONFIGS)) {
      expect(config.slug).toBe(slug === "demo" ? "demo-sigfa" : slug);
      expect(config.idNamespace.length).toBeGreaterThan(0);
    }
    expect(TENANT_SEED_CONFIGS["demo"]).toBe(DEMO_TENANT);
    expect(TENANT_SEED_CONFIGS["bicici"]).toBe(BICICI_TENANT);
  });

  it("aucune collision d'ID entre les tenants demo et bicici (banques, agences, guichets, kiosques)", () => {
    const collectIds = (config: typeof DEMO_TENANT): string[] => [
      config.bankId,
      ...config.agencies.flatMap((a) => [
        a.id,
        ...(a.counters ?? []).map((c) => c.id),
        ...(a.kiosks ?? []).map((k) => k.id),
      ]),
    ];
    const demoIds = collectIds(DEMO_TENANT);
    const biciciIds = collectIds(BICICI_TENANT);
    const all = [...demoIds, ...biciciIds];
    expect(new Set(all).size).toBe(all.length);
  });

  it("namespaces d'IDs déterministes distincts entre tenants", () => {
    expect(DEMO_TENANT.idNamespace).not.toBe(BICICI_TENANT.idNamespace);
    expect(DEMO_TENANT.userEmailDomain).not.toBe(BICICI_TENANT.userEmailDomain);
  });
});
