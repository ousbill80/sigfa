/**
 * Tests unitaires — moteur de seed de tenant paramétrable (`seedTenant`).
 *
 * Sans base de données : le moteur est exercé contre une QueryFn factice qui
 * capture les SQL émis. Garanties vérifiées :
 * - NON-RÉGRESSION des UUIDs déterministes historiques du tenant démo
 *   (`demo-service-…`, `demo-operation-…`, `demo-user-…`) — valeurs GELÉES.
 * - `appliedColors` calculées via `correctContrast` (@sigfa/schemas) ≥ 4.5:1.
 * - Idempotence structurelle : chaque INSERT porte un ON CONFLICT.
 * - Garde production (`NODE_ENV=production` → throw).
 * - Sélection des tenants (`resolveTenantSlugs`) : rétro-compat SEED_DEMO,
 *   slug inconnu → erreur explicite.
 *
 * @module
 */

import { describe, it, expect, afterEach } from "vitest";
import { contrastRatio, MIN_CONTRAST_RATIO } from "@sigfa/schemas";
import {
  seedTenant,
  buildAppliedTheme,
  tenantServiceId,
  tenantOperationId,
  tenantUserId,
  tenantUserEmail,
  DEFAULT_OPERATIONS,
  type QueryFn,
  type TenantSeedConfig,
} from "./tenant-seed.js";
import { resolveTenantSlugs, TENANT_SEED_CONFIGS } from "./index.js";
import { DEMO_TENANT, DEMO_AGENCY_1_ID } from "./tenants/demo.js";
import { PERSISTABLE_ROLES } from "./rbac-matrix.js";

/** QueryFn factice qui capture chaque SQL émis. */
function makeRecordingQuery(): { query: QueryFn; statements: string[] } {
  const statements: string[] = [];
  const query: QueryFn = async (sql: string) => {
    statements.push(sql);
    return { rows: [] };
  };
  return { query, statements };
}

/** Config de tenant minimale pour les tests du moteur. */
const MINIMAL_TENANT: TenantSeedConfig = {
  idNamespace: "testns",
  bankId: "a0000000-1111-4000-8000-000000000001",
  name: "Banque d'Essai",
  slug: "essai",
  userEmailDomain: "essai.sigfa-demo.ci",
  theme: {
    requestedColors: {
      primary: "#005e42",
      secondary: "#e8a000", // volontairement non conforme sur blanc → doit être corrigée
      background: "#ffffff",
    },
    welcomeMessages: { fr: "Bienvenue", en: "Welcome" },
    logoUrl: "/tenants/essai/logo.png",
  },
  agencies: [
    {
      id: "a0000001-1111-4000-8000-000000000001",
      name: "Agence d'Essai",
      city: "Abidjan",
      address: "Rue de l'Essai",
      phone: "+225 00 00 00 00 00",
      weeklySchedule: { monday: { start: "08:00", end: "15:45" } },
      counters: [{ id: "a0000002-1111-4000-8000-000000000001", number: 1, label: "Guichet 1" }],
      kiosks: [{ id: "a0000003-1111-4000-8000-000000000001", label: "Borne Essai" }],
    },
  ],
};

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

// ─────────────────────────────────────────────────────────────────────────────
// UUIDs déterministes — non-régression du tenant démo (valeurs gelées)
// ─────────────────────────────────────────────────────────────────────────────

describe("SEED-TENANT: UUIDs déterministes — non-régression des IDs historiques du tenant démo", () => {
  it("tenantServiceId('demo', agence 1, 'OC') reproduit l'ID historique demo-service-…", () => {
    expect(tenantServiceId("demo", DEMO_AGENCY_1_ID, "OC")).toBe(
      "3859a163-3f99-4ae3-864a-907c6dcb69be"
    );
  });

  it("tenantOperationId('demo', agence 1, 'OCDEP') reproduit l'ID historique demo-operation-…", () => {
    expect(tenantOperationId("demo", DEMO_AGENCY_1_ID, "OCDEP")).toBe(
      "23ef7a3b-9285-4948-87de-3f71e1b01eda"
    );
  });

  it("tenantUserId('demo', 'AGENT') reproduit l'ID historique demo-user-AGENT", () => {
    expect(tenantUserId("demo", "AGENT")).toBe("0455d0f5-7361-4614-843d-9d49a092a270");
  });

  it("tenantUserEmail conserve le format historique demo.<rôle>@<domaine>", () => {
    expect(tenantUserEmail("BANK_ADMIN", "sigfa-demo.ci")).toBe(
      "demo.bank.admin@sigfa-demo.ci"
    );
  });

  it("des namespaces différents produisent des IDs différents (pas de collision inter-tenants)", () => {
    expect(tenantServiceId("bicici", DEMO_AGENCY_1_ID, "OC")).not.toBe(
      tenantServiceId("demo", DEMO_AGENCY_1_ID, "OC")
    );
    expect(tenantUserId("bicici", "AGENT")).not.toBe(tenantUserId("demo", "AGENT"));
  });

  it("les IDs générés ont un format UUID v4-like valide", () => {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(tenantServiceId("x", "y", "Z")).toMatch(uuidRe);
    expect(tenantOperationId("x", "y", "Z")).toMatch(uuidRe);
    expect(tenantUserId("x", "AGENT")).toMatch(uuidRe);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Thème : appliedColors calculées (contraste WCAG ≥ 4.5:1)
// ─────────────────────────────────────────────────────────────────────────────

describe("SEED-TENANT: buildAppliedTheme — appliedColors dérivées via correctContrast (@sigfa/schemas)", () => {
  it("une couleur non conforme sur le fond est corrigée à ≥ 4.5:1 MESURÉ", () => {
    const theme = buildAppliedTheme(MINIMAL_TENANT.theme);
    const applied = theme.appliedColors!;
    expect(contrastRatio(applied["primary"]!, applied["background"]!)).toBeGreaterThanOrEqual(
      MIN_CONTRAST_RATIO
    );
    expect(contrastRatio(applied["secondary"]!, applied["background"]!)).toBeGreaterThanOrEqual(
      MIN_CONTRAST_RATIO
    );
    // La secondary #e8a000 sur blanc est < 4.5:1 → elle DOIT avoir été modifiée
    expect(applied["secondary"]).not.toBe("#e8a000");
  });

  it("une couleur déjà conforme est conservée telle quelle (minuscule)", () => {
    const theme = buildAppliedTheme(MINIMAL_TENANT.theme);
    // #005e42 sur blanc est déjà ≥ 4.5:1
    expect(theme.appliedColors!["primary"]).toBe("#005e42");
  });

  it("requestedColors, welcomeMessages FR/EN et logoUrl sont conservés", () => {
    const theme = buildAppliedTheme(MINIMAL_TENANT.theme);
    expect(theme.requestedColors).toEqual({
      primary: "#005e42",
      secondary: "#e8a000",
      background: "#ffffff",
    });
    expect(theme.welcomeMessages).toEqual({ fr: "Bienvenue", en: "Welcome" });
    expect(theme.logoUrl).toBe("/tenants/essai/logo.png");
  });

  it("sans logoUrl, la clé logoUrl est absente du thème persisté", () => {
    const theme = buildAppliedTheme({
      requestedColors: MINIMAL_TENANT.theme.requestedColors,
      welcomeMessages: MINIMAL_TENANT.theme.welcomeMessages,
    });
    expect("logoUrl" in theme).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Moteur seedTenant : SQL émis, idempotence, garde production
// ─────────────────────────────────────────────────────────────────────────────

describe("SEED-TENANT: seedTenant — insertions idempotentes pilotées par la config", () => {
  it("chaque INSERT émis porte un ON CONFLICT … DO NOTHING (idempotence)", async () => {
    const { query, statements } = makeRecordingQuery();
    await seedTenant(query, MINIMAL_TENANT);
    const inserts = statements.filter((s) => /INSERT INTO/i.test(s));
    expect(inserts.length).toBeGreaterThan(0);
    for (const sql of inserts) {
      expect(sql, `INSERT sans ON CONFLICT : ${sql.slice(0, 120)}`).toMatch(
        /ON CONFLICT .* DO NOTHING/s
      );
    }
  });

  it("la banque est insérée avec son thème jsonb (appliedColors corrigées incluses)", async () => {
    const { query, statements } = makeRecordingQuery();
    await seedTenant(query, MINIMAL_TENANT);
    const bankInsert = statements.find((s) => /INSERT INTO banks/i.test(s));
    expect(bankInsert).toBeDefined();
    expect(bankInsert).toContain("'essai'");
    expect(bankInsert).toContain("::jsonb");
    expect(bankInsert).toContain('"appliedColors"');
    expect(bankInsert).toContain('"welcomeMessages"');
    expect(bankInsert).toContain("/tenants/essai/logo.png");
  });

  it("agences insérées avec ville/adresse/téléphone/fuseau/horaires de la config", async () => {
    const { query, statements } = makeRecordingQuery();
    await seedTenant(query, MINIMAL_TENANT);
    const agencyInserts = statements.filter((s) => /INSERT INTO agencies/i.test(s));
    expect(agencyInserts).toHaveLength(1);
    expect(agencyInserts[0]).toContain("Agence d''Essai");
    expect(agencyInserts[0]).toContain("Africa/Abidjan");
    expect(agencyInserts[0]).toContain('"monday"');
  });

  it("services + opérations par défaut seedés pour chaque agence de la config", async () => {
    const { query, statements } = makeRecordingQuery();
    await seedTenant(query, MINIMAL_TENANT);
    const serviceInserts = statements.filter((s) => /INSERT INTO services/i.test(s));
    const operationInserts = statements.filter((s) => /INSERT INTO operations/i.test(s));
    expect(serviceInserts).toHaveLength(8); // DEFAULT_SERVICES × 1 agence
    expect(operationInserts).toHaveLength(DEFAULT_OPERATIONS.length);
  });

  it("guichets et kiosques insérés uniquement là où la config en décrit", async () => {
    const { query, statements } = makeRecordingQuery();
    await seedTenant(query, MINIMAL_TENANT);
    expect(statements.filter((s) => /INSERT INTO counters/i.test(s))).toHaveLength(1);
    expect(statements.filter((s) => /INSERT INTO kiosks/i.test(s))).toHaveLength(1);
  });

  it("un utilisateur de test par rôle persistable (hors SUPER_ADMIN), emails sur le domaine de la config", async () => {
    const { query, statements } = makeRecordingQuery();
    await seedTenant(query, MINIMAL_TENANT);
    const userInserts = statements.filter((s) => /INSERT INTO users/i.test(s));
    expect(userInserts).toHaveLength(PERSISTABLE_ROLES.length - 1);
    for (const sql of userInserts) {
      expect(sql).toContain("@essai.sigfa-demo.ci");
      expect(sql).not.toContain("SUPER_ADMIN");
    }
  });

  it("sans config whatsapp, aucune insertion whatsapp_config/whatsapp_menu_mapping", async () => {
    const { query, statements } = makeRecordingQuery();
    await seedTenant(query, MINIMAL_TENANT);
    expect(statements.some((s) => /whatsapp/i.test(s))).toBe(false);
  });

  it("avec la config démo, la config WhatsApp historique est émise (numéro + mapping OC)", async () => {
    const { query, statements } = makeRecordingQuery();
    await seedTenant(query, DEMO_TENANT);
    const waConfig = statements.find((s) => /INSERT INTO whatsapp_config/i.test(s));
    const waMapping = statements.find((s) => /INSERT INTO whatsapp_menu_mapping/i.test(s));
    expect(waConfig).toContain("+2250700000000");
    expect(waMapping).toContain(tenantServiceId("demo", DEMO_AGENCY_1_ID, "OC"));
  });

  it("NODE_ENV=production → throw explicite (garde DB-009 conservée)", async () => {
    process.env.NODE_ENV = "production";
    const { query } = makeRecordingQuery();
    await expect(seedTenant(query, MINIMAL_TENANT)).rejects.toThrow(/production/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sélection des tenants (SEED_TENANTS / rétro-compat SEED_DEMO)
// ─────────────────────────────────────────────────────────────────────────────

describe("SEED-TENANT: resolveTenantSlugs — sélection par env, rétro-compat SEED_DEMO", () => {
  it("sans option, aucun tenant seedé", () => {
    expect(resolveTenantSlugs({})).toEqual([]);
  });

  it("seedDemo: true (rétro-compat SEED_DEMO=1) → tenant demo", () => {
    expect(resolveTenantSlugs({ seedDemo: true })).toEqual(["demo"]);
  });

  it("tenants: ['demo','bicici'] → les deux, dédupliqués avec seedDemo", () => {
    expect(resolveTenantSlugs({ tenants: ["demo", "bicici"], seedDemo: true })).toEqual([
      "demo",
      "bicici",
    ]);
  });

  it("slug inconnu → erreur explicite listant les tenants disponibles", () => {
    expect(() => resolveTenantSlugs({ tenants: ["inconnu"] })).toThrow(/inconnu/);
    expect(() => resolveTenantSlugs({ tenants: ["inconnu"] })).toThrow(/demo.*bicici|bicici.*demo/s);
  });

  it("le registre expose demo et bicici", () => {
    expect(Object.keys(TENANT_SEED_CONFIGS).sort()).toEqual(["bicici", "demo"]);
  });
});
